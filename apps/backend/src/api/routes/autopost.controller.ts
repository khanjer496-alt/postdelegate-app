import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { Organization } from '@prisma/client';
import { ApiTags } from '@nestjs/swagger';
import { CheckPolicies } from '@gitroom/backend/services/auth/permissions/permissions.ability';
import { AutopostService } from '@gitroom/nestjs-libraries/database/prisma/autopost/autopost.service';
import { AutopostDto } from '@gitroom/nestjs-libraries/dtos/autopost/autopost.dto';
import {
  AuthorizationActions,
  Sections,
  SubscriptionException,
} from '@gitroom/backend/services/auth/permissions/permission.exception.class';
import { PermissionsService } from '@gitroom/backend/services/auth/permissions/permissions.service';
import { OnlyURL } from '@gitroom/nestjs-libraries/dtos/webhooks/webhooks.dto';

@ApiTags('Autopost')
@Controller('/autopost')
export class AutopostController {
  constructor(
    private _autopostsService: AutopostService,
    private _permissionsService: PermissionsService
  ) {}

  @Get('/')
  async getAutoposts(@GetOrgFromRequest() org: Organization) {
    return this._autopostsService.getAutoposts(org.id);
  }

  // AutoPost is a plan feature: turning one on needs the plan, turning one
  // off never does (a downgraded workspace can always stop its feeds)
  private async assertCanTurnOn(
    org: Organization,
    active: boolean,
    // the active switch has no policy decorator, so it also checks the AI key
    sections: Sections[] = [Sections.AUTO_POST]
  ) {
    if (!active) {
      return;
    }
    for (const section of sections) {
      if (
        !(await this._permissionsService.allows(org.id, org.createdAt, section))
      ) {
        throw new SubscriptionException({
          section,
          action: AuthorizationActions.Create,
        });
      }
    }
  }

  @Post('/')
  @CheckPolicies(
    [AuthorizationActions.Create, Sections.WEBHOOKS],
    [AuthorizationActions.Create, Sections.AI]
  )
  async createAutopost(
    @GetOrgFromRequest() org: Organization,
    @Body() body: AutopostDto
  ) {
    await this.assertCanTurnOn(org, body.active);
    return this._autopostsService.createAutopost(org.id, body);
  }

  @Put('/:id')
  @CheckPolicies([AuthorizationActions.Create, Sections.AI])
  async updateAutopost(
    @GetOrgFromRequest() org: Organization,
    @Body() body: AutopostDto,
    @Param('id') id: string
  ) {
    await this.assertCanTurnOn(org, body.active);
    return this._autopostsService.createAutopost(org.id, body, id);
  }

  @Delete('/:id')
  async deleteAutopost(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string
  ) {
    return this._autopostsService.deleteAutopost(org.id, id);
  }

  // turning off is never gated, not even by the AI key
  @Post('/:id/active')
  async changeActive(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body('active') active: boolean
  ) {
    await this.assertCanTurnOn(org, active, [Sections.AUTO_POST, Sections.AI]);
    return this._autopostsService.changeActive(org.id, id, active);
  }

  @Post('/send')
  async sendWebhook(@Query() query: OnlyURL) {
    return this._autopostsService.loadXML(query.url);
  }
}
