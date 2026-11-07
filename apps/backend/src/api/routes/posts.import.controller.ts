import { Body, Controller, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Organization, User } from '@prisma/client';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { GetUserFromRequest } from '@gitroom/nestjs-libraries/user/user.from.request';
import { userActor } from '@gitroom/nestjs-libraries/database/prisma/approvals/approval.policy.service';
import { CheckPolicies } from '@gitroom/backend/services/auth/permissions/permissions.ability';
import {
  AuthorizationActions,
  Sections,
} from '@gitroom/backend/services/auth/permissions/permission.exception.class';
import { PostsImportService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.import.service';
import { ImportPostsDto } from '@gitroom/nestjs-libraries/dtos/posts/import.posts.dto';
import { PermissionsService } from '@gitroom/backend/services/auth/permissions/permissions.service';

// Bulk scheduling from a CSV file: every row goes through the same
// validation and creation as a post made in the composer
@ApiTags('Posts')
@Controller('/posts-import')
export class PostsImportController {
  constructor(
    private _importService: PostsImportService,
    private _permissionsService: PermissionsService
  ) {}

  @Post('/preview')
  preview(
    @GetOrgFromRequest() org: Organization,
    @Body() body: ImportPostsDto
  ) {
    return this._importService.preview(org.id, body);
  }

  @Post('/')
  @CheckPolicies([AuthorizationActions.Create, Sections.POSTS_PER_MONTH])
  async import(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
    @Body() body: ImportPostsDto
  ) {
    // the policy above checks the plan once, the import creates many posts
    const remaining = await this._permissionsService.remainingPostsThisMonth(
      org.id,
      org.createdAt
    );
    return this._importService.import(
      org.id,
      body,
      remaining,
      userActor(user, org as any)
    );
  }
}
