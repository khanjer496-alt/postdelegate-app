import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Organization, User } from '@prisma/client';
import { ThrottlerRealIpGuard } from '@gitroom/nestjs-libraries/throttler/throttler.provider';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { GetUserFromRequest } from '@gitroom/nestjs-libraries/user/user.from.request';
import { StudioService } from '@gitroom/nestjs-libraries/database/prisma/studio/studio.service';
import { StudioScheduleService } from '@gitroom/nestjs-libraries/database/prisma/studio/studio.schedule.service';
import { StudioAiService } from '@gitroom/nestjs-libraries/database/prisma/studio/studio.ai.service';
import {
  CreateStudioProjectDto,
  GetStudioProjectsDto,
  StudioTranscribeDto,
  UpdateStudioProjectDto,
} from '@gitroom/nestjs-libraries/dtos/studio/studio.project.dto';
import { StudioScheduleRendersDto } from '@gitroom/nestjs-libraries/dtos/studio/studio.schedule.dto';
import { streamUploadOptions } from '@gitroom/nestjs-libraries/upload/multer.stream.engine';
import { STUDIO_MUSIC_UPLOAD } from '@gitroom/nestjs-libraries/dtos/studio/studio.music.dto';
import { userActor } from '@gitroom/nestjs-libraries/database/prisma/approvals/approval.policy.service';
import {
  AuthorizationActions,
  Sections,
  SubscriptionException,
} from '@gitroom/backend/services/auth/permissions/permission.exception.class';
import { PermissionsService } from '@gitroom/backend/services/auth/permissions/permissions.service';
import { StudioAssetGuard } from '@gitroom/backend/services/auth/studio.asset.guard';

// Every transcription, script and voice spends the workspace's own OpenAI
// credit
const HOUR = 60 * 60 * 1000;

@ApiTags('Studio')
@Controller('/studio')
export class StudioController {
  constructor(
    private _studioService: StudioService,
    private _studioScheduleService: StudioScheduleService,
    private _permissionsService: PermissionsService,
    private _studioAiService: StudioAiService
  ) {}

  @Get('/templates')
  getTemplates() {
    return this._studioService.getTemplates();
  }

  // What the workspace's own AI can do in Studio (voices, video)
  @Get('/ai')
  getAi(@GetOrgFromRequest() org: Organization) {
    return this._studioAiService.getCapabilities(org.id);
  }

  @Get('/usage')
  getUsage(@GetOrgFromRequest() org: Organization) {
    return this._studioService.getUsage(org);
  }

  @Get('/projects')
  getProjects(
    @GetOrgFromRequest() org: Organization,
    @Query() query: GetStudioProjectsDto
  ) {
    return this._studioService.getProjects(org.id, !!query.api);
  }

  @Post('/projects')
  createProject(
    @GetOrgFromRequest() org: Organization,
    @Body() body: CreateStudioProjectDto
  ) {
    return this._studioService.createProject(org.id, body);
  }

  @Get('/projects/:id')
  getProject(@GetOrgFromRequest() org: Organization, @Param('id') id: string) {
    return this._studioService.getProject(org.id, id);
  }

  @Put('/projects/:id')
  updateProject(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body() body: UpdateStudioProjectDto
  ) {
    return this._studioService.updateProject(org.id, id, body);
  }

  @Delete('/projects/:id')
  deleteProject(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string
  ) {
    return this._studioService.deleteProject(org.id, id);
  }

  @UseGuards(ThrottlerRealIpGuard)
  @Throttle({ default: { limit: 30, ttl: HOUR } })
  @Post('/projects/:id/transcribe')
  transcribe(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body() body: StudioTranscribeDto
  ) {
    return this._studioService.transcribe(org.id, id, body);
  }

  // Music for the templates that take it: mp3, m4a or wav up to 30 MB,
  // stored for Studio only and never shown in the media library. The plan
  // and the room left are checked before anything is stored
  @UseGuards(ThrottlerRealIpGuard, StudioAssetGuard)
  @Throttle({ default: { limit: 60, ttl: HOUR } })
  @Post('/assets')
  @UseInterceptors(FileInterceptor('file', streamUploadOptions(STUDIO_MUSIC_UPLOAD)))
  uploadAsset(
    @GetOrgFromRequest() org: Organization,
    @UploadedFile() file: Express.Multer.File
  ) {
    if (!file) {
      throw new BadRequestException('No file provided');
    }
    return this._studioService.saveAsset(org.id, file);
  }

  @UseGuards(ThrottlerRealIpGuard)
  @Throttle({ default: { limit: 30, ttl: HOUR } })
  @Post('/projects/:id/ai-script')
  writeScript(@GetOrgFromRequest() org: Organization, @Param('id') id: string) {
    return this._studioAiService.writeScript(org.id, id);
  }

  @UseGuards(ThrottlerRealIpGuard)
  @Throttle({ default: { limit: 30, ttl: HOUR } })
  @Post('/projects/:id/voiceover')
  voiceover(@GetOrgFromRequest() org: Organization, @Param('id') id: string) {
    return this._studioAiService.voiceover(org.id, id);
  }

  @Post('/projects/:id/render')
  startRender(@GetOrgFromRequest() org: Organization, @Param('id') id: string) {
    return this._studioService.startRender(org, id);
  }

  @Get('/renders')
  getFinishedRenders(@GetOrgFromRequest() org: Organization) {
    return this._studioService.getFinishedRenders(org.id);
  }

  // Finished videos scheduled at once, with every check of the bulk video
  // upload: the plan check of POST /posts for a request never sent before
  // (sending one again gets its result), then the posts left this month
  @Post('/renders/schedule')
  async scheduleRenders(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
    @Body() body: StudioScheduleRendersDto
  ) {
    if (
      (await this._studioScheduleService.status(org.id, body)).status ===
      'none'
    ) {
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
    const remaining = await this._permissionsService.remainingPostsThisMonth(
      org.id,
      org.createdAt
    );
    return this._studioScheduleService.scheduleRenders(
      org.id,
      body,
      remaining,
      userActor(user, org as any)
    );
  }

  @Get('/renders/:id')
  getRender(@GetOrgFromRequest() org: Organization, @Param('id') id: string) {
    return this._studioService.getRender(org.id, id);
  }

  @Post('/renders/:id/cancel')
  cancelRender(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string
  ) {
    return this._studioService.cancelRender(org.id, id);
  }
}
