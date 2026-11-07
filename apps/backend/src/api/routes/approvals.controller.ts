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
import { ApiTags } from '@nestjs/swagger';
import { Organization, User } from '@prisma/client';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { GetUserFromRequest } from '@gitroom/nestjs-libraries/user/user.from.request';
import { CheckPolicies } from '@gitroom/backend/services/auth/permissions/permissions.ability';
import {
  AuthorizationActions,
  Sections,
} from '@gitroom/backend/services/auth/permissions/permission.exception.class';
import { ApprovalsService } from '@gitroom/nestjs-libraries/database/prisma/approvals/approvals.service';
import { userActor } from '@gitroom/nestjs-libraries/database/prisma/approvals/approval.policy.service';
import {
  ActivityListDto,
  ApprovalCommentDto,
  CreateApprovalLinkDto,
  RequestChangesDto,
  ReviewQueueDto,
  UpdateApprovalSettingsDto,
} from '@gitroom/nestjs-libraries/dtos/approvals/approvals.dto';

@ApiTags('Approvals')
@Controller('/approvals')
export class ApprovalsController {
  constructor(private _approvalsService: ApprovalsService) {}

  @Get('/settings')
  getSettings(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User
  ) {
    return this._approvalsService.getSettings(org.id, userActor(user, org as any));
  }

  @Put('/settings')
  @CheckPolicies([AuthorizationActions.Create, Sections.ADMIN])
  updateSettings(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
    @Body() body: UpdateApprovalSettingsDto
  ) {
    return this._approvalsService.updateSettings(
      org.id,
      userActor(user, org as any),
      body
    );
  }

  @Get('/review')
  getReviewQueue(
    @GetOrgFromRequest() org: Organization,
    @Query() query: ReviewQueueDto
  ) {
    return this._approvalsService.getReviewQueue(org.id, query.source);
  }

  @Get('/review/count')
  getReviewCount(@GetOrgFromRequest() org: Organization) {
    return this._approvalsService.getReviewCount(org.id);
  }

  @Post('/posts/:id/submit')
  submit(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
    @Param('id') id: string
  ) {
    return this._approvalsService.submit(org.id, id, userActor(user, org as any));
  }

  @Post('/posts/:id/approve')
  approve(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
    @Param('id') id: string,
    @Body() body: ApprovalCommentDto
  ) {
    return this._approvalsService.approve(
      org.id,
      id,
      userActor(user, org as any),
      body.comment
    );
  }

  @Post('/posts/:id/request-changes')
  requestChanges(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
    @Param('id') id: string,
    @Body() body: RequestChangesDto
  ) {
    return this._approvalsService.requestChanges(
      org.id,
      id,
      userActor(user, org as any),
      body.comment
    );
  }

  @Post('/posts/:id/reject')
  reject(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
    @Param('id') id: string,
    @Body() body: ApprovalCommentDto
  ) {
    return this._approvalsService.reject(
      org.id,
      id,
      userActor(user, org as any),
      body.comment
    );
  }

  @Get('/posts/:id/history')
  getPostHistory(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Query() query: ActivityListDto
  ) {
    return this._approvalsService.getPostHistory(org.id, id, query.page);
  }

  @Get('/activity')
  getActivity(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
    @Query() query: ActivityListDto
  ) {
    return this._approvalsService.getActivity(
      org.id,
      userActor(user, org as any),
      query.page
    );
  }

  @Get('/links')
  listLinks(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User
  ) {
    return this._approvalsService.listLinks(org.id, userActor(user, org as any));
  }

  @Post('/links')
  createLink(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
    @Body() body: CreateApprovalLinkDto
  ) {
    return this._approvalsService.createLink(
      org.id,
      userActor(user, org as any),
      body
    );
  }

  @Delete('/links/:id')
  revokeLink(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
    @Param('id') id: string
  ) {
    return this._approvalsService.revokeLink(
      org.id,
      userActor(user, org as any),
      id
    );
  }
}
