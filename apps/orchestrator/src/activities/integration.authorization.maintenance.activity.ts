import { Injectable } from '@nestjs/common';
import { Activity, ActivityMethod } from 'nestjs-temporal-core';
import { IntegrationAuthorizationLifecycleService } from '@gitroom/nestjs-libraries/integrations/integration.authorization.lifecycle.service';

@Injectable()
@Activity()
export class IntegrationAuthorizationMaintenanceActivity {
  constructor(private _lifecycle: IntegrationAuthorizationLifecycleService) {}

  @ActivityMethod()
  async processIntegrationDataDeletionV1(
    organizationId: string,
    integrationId: string
  ): Promise<{ completed: number }> {
    if (process.env.INTEGRATION_AUTHORIZATION_LIFECYCLE_ENABLED !== 'true') {
      return { completed: 0 };
    }
    try {
      const result = await this._lifecycle.processDeletion(organizationId, integrationId);
      // Provider responses and errors may contain credentials. Temporal only
      // receives completion counts and the local identifiers supplied as args.
      return { completed: result.status === 'complete' ? 1 : 0 };
    } catch {
      throw new Error('Integration data deletion is temporarily unavailable.');
    }
  }

  @ActivityMethod()
  async checkIntegrationAuthorizationsPageV1(cursor?: string): Promise<{
    enabled: number;
    cursor?: string;
    checked: number;
    pending: number;
  }> {
    if (process.env.INTEGRATION_AUTHORIZATION_LIFECYCLE_ENABLED !== 'true') {
      return { enabled: 0, checked: 0, pending: 0 };
    }
    try {
      const page = await this._lifecycle.checkAuthorizationsPage(cursor);
      if (
        !Number.isSafeInteger(page.checked) || page.checked < 0 ||
        !Number.isSafeInteger(page.pending) || page.pending < 0 ||
        (page.cursor !== undefined && typeof page.cursor !== 'string')
      ) {
        throw new Error('Invalid maintenance page.');
      }
      return {
        enabled: 1,
        ...(page.cursor ? { cursor: page.cursor } : {}),
        checked: page.checked,
        pending: page.pending,
      };
    } catch {
      throw new Error('Integration authorization maintenance is temporarily unavailable.');
    }
  }
}
