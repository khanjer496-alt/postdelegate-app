import { Controller, Get, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Organization, User } from '@prisma/client';
import { GetUserFromRequest } from '@gitroom/nestjs-libraries/user/user.from.request';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { ActivationService } from '@gitroom/nestjs-libraries/database/prisma/activation/activation.service';

@ApiTags('Activation')
@Controller('/activation')
export class ActivationController {
  constructor(private _activationService: ActivationService) {}

  @Get('/checklist')
  getChecklist(
    @GetUserFromRequest() user: User,
    @GetOrgFromRequest() organization: Organization
  ) {
    return this._activationService.getChecklist(user.id, organization.id);
  }

  @Post('/checklist/dismiss')
  dismissChecklist(
    @GetUserFromRequest() user: User,
    @GetOrgFromRequest() organization: Organization
  ) {
    return this._activationService.dismissChecklist(user.id, organization.id);
  }

  @Get('/attention')
  getNeedsAttention(@GetOrgFromRequest() organization: Organization) {
    return this._activationService.getNeedsAttention(organization.id);
  }
}
