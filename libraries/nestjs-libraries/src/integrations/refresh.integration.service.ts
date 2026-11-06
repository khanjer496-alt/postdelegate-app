import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { Integration } from '@prisma/client';
import { IntegrationManager } from '@gitroom/nestjs-libraries/integrations/integration.manager';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import {
  AuthTokenDetails,
  SocialProvider,
} from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import { TemporalService } from 'nestjs-temporal-core';
import { timer } from '@gitroom/helpers/utils/timer';

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

    if (refresh.stored) {
      return refresh.tokens;
    }

    const updated = await this._integrationService.persistRefreshedAuthorization(integration, refresh.tokens);
    if (!updated.count) return false;

    return refresh.tokens;
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
    // `stored`: another flow refreshed this channel first and its tokens are
    // already in the database, so refresh() must not try to write them again -
    // its write is pinned to the token we started from, which no longer
    // matches, and the refresh would come back as a failure
  ): Promise<{ tokens: AuthTokenDetails; stored?: true } | false> {
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
      // Two flows can refresh the same channel at once (two posts, a post and
      // analytics). A provider that replaces the refresh token on every refresh
      // rejects the second one while the first is still storing its tokens:
      // wait for them and reuse them instead of flagging the channel.
      for (let attempt = 0; attempt < 3; attempt++) {
        const stored = await this._integrationService.getIntegrationById(
          integration.organizationId,
          integration.id
        );
        if (
          !stored ||
          stored.refreshNeeded ||
          stored.inBetweenSteps ||
          stored.deletedAt ||
          // getIntegrationById does not filter this one, and every other read
          // in this file goes through getActiveIntegrationById, which does
          stored.disabled
        ) {
          break;
        }
        if (
          stored.internalId === integration.internalId &&
          stored.providerIdentifier === integration.providerIdentifier &&
          stored.refreshToken &&
          stored.refreshToken !== integration.refreshToken &&
          stored.token !== integration.token &&
          stored.tokenExpiration &&
          stored.tokenExpiration.getTime() > Date.now()
        ) {
          return {
            stored: true,
            tokens: {
              id: stored.internalId,
              name: stored.name,
              username: stored.profile || '',
              picture: stored.picture || '',
              accessToken: stored.token,
              refreshToken: stored.refreshToken,
              expiresIn: Math.floor(
                (stored.tokenExpiration.getTime() - Date.now()) / 1000
              ),
            },
          };
        }
        if (attempt < 2) {
          await timer(1000 * (attempt + 1));
        }
      }
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
      // A channel that is already flagged keeps failing on every later
      // refresh attempt (e.g. hourly analytics polling of an expired token),
      // so only the attempt that flagged it notifies - refreshNeeded counts
      // only the update that actually flipped the flag, and only while the
      // token still matches the one we tried to refresh.
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
      return { tokens: refresh };
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
      tokens: {
        ...refresh,
        ...reConnect,
      },
    };
  }
}
