import { Injectable } from '@nestjs/common';
import { Activity, ActivityMethod } from 'nestjs-temporal-core';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { Integration } from '@prisma/client';
import { RefreshIntegrationService } from '@gitroom/nestjs-libraries/integrations/refresh.integration.service';

@Injectable()
@Activity()
export class IntegrationsActivity {
  constructor(
    private _integrationService: IntegrationService,
    private _refreshIntegrationService: RefreshIntegrationService
  ) {}

  @ActivityMethod()
  async getIntegrationsById(id: string, orgId: string) {
    return this._integrationService.getIntegrationById(orgId, id);
  }

  async refreshToken(integration: Integration) {
    const current = await this._integrationService.getIntegrationById(
      integration.organizationId,
      integration.id
    );
    if (!current || current.deletedAt) return false;
    const result = await this._refreshIntegrationService.refresh(current);
    const after = await this._integrationService.getIntegrationById(
      integration.organizationId,
      integration.id
    );
    return after && !after.deletedAt ? result : false;
  }
}
