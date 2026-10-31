import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Organization, User } from '@prisma/client';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { GetUserFromRequest } from '@gitroom/nestjs-libraries/user/user.from.request';
import { WeeklySummaryService } from '@gitroom/nestjs-libraries/database/prisma/weekly-summary/weekly.summary.service';
import { WeeklySummaryDto } from '@gitroom/nestjs-libraries/dtos/weekly-summary/weekly.summary.dto';

// The Monday summary email of the current workspace, for the current user
@ApiTags('User')
@Controller('/weekly-summary')
export class WeeklySummaryController {
  constructor(private _weeklySummaryService: WeeklySummaryService) {}

  @Get('/')
  getPreference(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User
  ) {
    return this._weeklySummaryService.getPreference(org.id, user.id);
  }

  @Put('/')
  setPreference(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
    @Body() body: WeeklySummaryDto
  ) {
    return this._weeklySummaryService.setPreference(
      org.id,
      user.id,
      body.enabled
    );
  }
}
