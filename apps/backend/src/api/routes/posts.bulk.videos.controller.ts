import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Organization, User } from '@prisma/client';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { GetUserFromRequest } from '@gitroom/nestjs-libraries/user/user.from.request';
import { userActor } from '@gitroom/nestjs-libraries/database/prisma/approvals/approval.policy.service';
import {
  AuthorizationActions,
  Sections,
  SubscriptionException,
} from '@gitroom/backend/services/auth/permissions/permission.exception.class';
import { PostsBulkVideosService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.bulk.videos.service';
import { BulkVideoPostsDto } from '@gitroom/nestjs-libraries/dtos/posts/bulk.videos.dto';
import { PermissionsService } from '@gitroom/backend/services/auth/permissions/permissions.service';

// Bulk scheduling of uploaded videos: one post a video, spread over the time
// slots of the channels, every post checked like one made in the composer
@ApiTags('Posts')
@Controller('/posts-bulk-videos')
export class PostsBulkVideosController {
  constructor(
    private _bulkVideosService: PostsBulkVideosService,
    private _permissionsService: PermissionsService
  ) {}

  @Get('/channels')
  channels(@GetOrgFromRequest() org: Organization) {
    return this._bulkVideosService.channels(org.id);
  }

  @Post('/preview')
  async preview(
    @GetOrgFromRequest() org: Organization,
    @Body() body: BulkVideoPostsDto
  ) {
    const remaining = await this._permissionsService.remainingPostsThisMonth(
      org.id,
      org.createdAt
    );
    return this._bulkVideosService.preview(org.id, body, remaining);
  }

  // where a request that timed out stands, without the plan checks
  @Post('/status')
  status(
    @GetOrgFromRequest() org: Organization,
    @Body() body: BulkVideoPostsDto
  ) {
    return this._bulkVideosService.status(org.id, body);
  }

  // the same, by the key the first status call returned
  @Get('/status/:key')
  statusOf(@GetOrgFromRequest() org: Organization, @Param('key') key: string) {
    return this._bulkVideosService.statusOf(org.id, key);
  }

  @Post('/')
  async create(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
    @Body() body: BulkVideoPostsDto
  ) {
    // The plan check of @CheckPolicies([Create, POSTS_PER_MONTH]), only for a
    // request never sent before: sending a running or finished one again
    // gets its 409 or its result, even once its own posts used up the month
    if ((await this._bulkVideosService.status(org.id, body)).status === 'none') {
      const ability = await this._permissionsService.check(
        org.id,
        org.createdAt,
        (org as any).users[0].role,
        [[AuthorizationActions.Create, Sections.POSTS_PER_MONTH]]
      );
      if (!ability.can(AuthorizationActions.Create, Sections.POSTS_PER_MONTH)) {
        throw new SubscriptionException({
          action: AuthorizationActions.Create,
          section: Sections.POSTS_PER_MONTH,
        });
      }
    }
    // the check above is for the plan once, this creates many posts
    const remaining = await this._permissionsService.remainingPostsThisMonth(
      org.id,
      org.createdAt
    );
    return this._bulkVideosService.create(
      org.id,
      body,
      remaining,
      userActor(user, org as any)
    );
  }
}
