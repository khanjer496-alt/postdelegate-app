import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Organization } from '@prisma/client';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { ClippingService } from '@gitroom/nestjs-libraries/database/prisma/clipping/clipping.service';
import { ClippingDto } from '@gitroom/nestjs-libraries/dtos/clipping/clipping.dto';
import { CheckPolicies } from '@gitroom/backend/services/auth/permissions/permissions.ability';
import {
  AuthorizationActions,
  Sections,
} from '@gitroom/backend/services/auth/permissions/permission.exception.class';

@ApiTags('Clipping')
@Controller('/clipping')
export class ClippingController {
  constructor(private _clippingService: ClippingService) {}

  @Post('/')
  @CheckPolicies([AuthorizationActions.Create, Sections.AI])
  startClipping(
    @GetOrgFromRequest() org: Organization,
    @Body() body: ClippingDto
  ) {
    return this._clippingService.startClipping(org, body);
  }

  @Get('/')
  getClippings(
    @GetOrgFromRequest() org: Organization,
    @Query('page') page: number
  ) {
    return this._clippingService.getClippings(org.id, page);
  }

  @Get('/:id')
  getClipping(@GetOrgFromRequest() org: Organization, @Param('id') id: string) {
    return this._clippingService.getClipping(org.id, id);
  }
}
