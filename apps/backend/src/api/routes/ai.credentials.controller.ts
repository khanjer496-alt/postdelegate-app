import { Body, Controller, Delete, Get, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ThrottlerRealIpGuard } from '@gitroom/nestjs-libraries/throttler/throttler.provider';
import { Organization } from '@prisma/client';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { AiCredentialService } from '@gitroom/nestjs-libraries/database/prisma/ai-credentials/ai.credential.service';
import { AiCredentialDto } from '@gitroom/nestjs-libraries/dtos/ai-credentials/ai.credential.dto';
import { CheckPolicies } from '@gitroom/backend/services/auth/permissions/permissions.ability';
import {
  AuthorizationActions,
  Sections,
} from '@gitroom/backend/services/auth/permissions/permission.exception.class';

// Every save asks OpenAI whether the key works, so without a limit this
// endpoint would check stolen keys for anyone
const HOUR = 60 * 60 * 1000;

@ApiTags('AI Credentials')
@Controller('/ai-credentials')
export class AiCredentialsController {
  constructor(private _aiCredentialService: AiCredentialService) {}

  @Get('/')
  async getCredential(@GetOrgFromRequest() org: Organization) {
    return (await this._aiCredentialService.getCredential(org.id)) || {};
  }

  @UseGuards(ThrottlerRealIpGuard)
  @Throttle({ default: { limit: 10, ttl: HOUR } })
  @Post('/')
  @CheckPolicies([AuthorizationActions.Create, Sections.ADMIN])
  saveCredential(
    @GetOrgFromRequest() org: Organization,
    @Body() body: AiCredentialDto
  ) {
    return this._aiCredentialService.saveCredential(org.id, body);
  }

  @Delete('/')
  @CheckPolicies([AuthorizationActions.Create, Sections.ADMIN])
  async deleteCredential(@GetOrgFromRequest() org: Organization) {
    await this._aiCredentialService.deleteCredential(org.id);
    return { success: true };
  }
}
