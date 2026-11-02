import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { Integration } from '@prisma/client';
import { IntegrationManager } from '@gitroom/nestjs-libraries/integrations/integration.manager';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import {
  AuthTokenDetails,
  SocialProvider,
} from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import { TemporalService } from 'nestjs-temporal-core';

@Injectable()
export class RefreshIntegrationService {
  constructor(
    private _integrationManager: IntegrationManager,
    @Inject(forwardRef(() => IntegrationService))
    private _integrationService: IntegrationService,
    private _temporalService: TemporalService
  ) {}
  // `soft`: a failed refresh only returns false, the channel is not flagged
  // for reconnect and nobody is notified (read-mostly views like Analytics >
  // Views, where a network that briefly fails must not block publishing)
  async refresh(
    integration: Integration,
    cause = '',
    soft = false
  ): Promise<false | AuthTokenDetails> {
    const current = await this._integrationService.getActiveIntegrationById(integration.organizationId, integration.id);
    if (!current || current.token !== integration.token) return false;
    const socialProvider = this._integrationManager.getSocialIntegration(
      integration.providerIdentifier
    );

    const refresh = await this.refreshProcess(
      integration,
      socialProvider,
      cause,
      soft
    ).catch((err) => {
      if (soft) return false as const;
      throw err;
    });

    if (!refresh) {
      return false as const;
    }

    const updated = await this._integrationService.persistRefreshedAuthorization(integration, refresh);
    if (!updated.count) return false;

    return refresh;
  }

  public async setBetweenSteps(integration: Integration, cause = '') {
    const current = await this._integrationService.getActiveIntegrationById(integration.organizationId, integration.id);
    if (!current || current.token !== integration.token) return;
    const changed = await this._integrationService.setBetweenRefreshSteps(integration.id, integration.token);
    if (!changed.count) return;
    const after = await this._integrationService.getIntegrationById(integration.organizationId, integration.id);
    if (!after || after.deletedAt || after.token !== integration.token) return;
    await this._integrationService.informAboutRefreshError(
      integration.organizationId,
      integration,
      cause
    );
  }

  public async startRefreshWorkflow(orgId: string, id: string, integration: SocialProvider) {
    if (!integration.refreshCron) {
      return false;
    }

    return this._temporalService.client
      .getRawClient()
      ?.workflow.start(`refreshTokenWorkflow`, {
        workflowId: `refresh_${id}`,
        args: [{integrationId: id, organizationId: orgId}],
        taskQueue: 'main',
        workflowIdConflictPolicy: 'TERMINATE_EXISTING',
      });
  }

  private async refreshProcess(
    integration: Integration,
    socialProvider: SocialProvider,
    cause = '',
    soft = false
  ): Promise<AuthTokenDetails | false> {
    let refreshError: any = undefined;
    const refresh: false | AuthTokenDetails = await socialProvider
      .refreshToken(integration.refreshToken)
      .catch((err) => {
        refreshError = err;
        return false as const;
      });

    if ((!refresh || !refresh.accessToken) && soft) {
      return false;
    }

    if (!refresh || !refresh.accessToken) {
      const current = await this._integrationService.getActiveIntegrationById(integration.organizationId, integration.id);
      if (!current || current.token !== integration.token) return false;
      // also logged when the provider returned no access token without
      // throwing, which otherwise left no trace (no error details, they can
      // carry provider token payloads)
      console.error(
        `Could not refresh ${integration.providerIdentifier} integration ${integration.id}${
          refreshError ? '' : ': no access token returned'
        }`
      );

      // informAboutRefreshError (with the failure cause) already notifies
      // the user, and refreshNeeded sets the same flag disconnectChannel
      // would — calling disconnectChannel here sent a second, cause-less
      // copy of the same email for every failed refresh.
      const changed = await this._integrationService.refreshNeeded(
        integration.organizationId,
        integration.id,
        integration.token
      );
      if (!changed.count) return false;
      const after = await this._integrationService.getActiveIntegrationById(integration.organizationId, integration.id);
      if (!after || after.token !== integration.token) return false;

      await this._integrationService.informAboutRefreshError(
        integration.organizationId,
        integration,
        socialProvider.refreshErrorMessage?.(refreshError) || cause
      );

      return false;
    }

    if (
      !socialProvider.reConnect ||
      integration.rootInternalId === integration.internalId
    ) {
      return refresh;
    }

    let reConnect;
    try {
      reConnect = await socialProvider.reConnect(
        integration.rootInternalId,
        integration.internalId,
        refresh.accessToken
      );
    } catch (err: any) {
      console.error(
        `Could not reconnect ${integration.providerIdentifier} integration ${integration.id} after a successful token refresh`
      );
      throw err;
    }

    return {
      ...refresh,
      ...reConnect,
    };
  }
}
