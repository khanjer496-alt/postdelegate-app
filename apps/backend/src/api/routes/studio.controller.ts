import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Organization } from '@prisma/client';
import { ThrottlerRealIpGuard } from '@gitroom/nestjs-libraries/throttler/throttler.provider';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { StudioService } from '@gitroom/nestjs-libraries/database/prisma/studio/studio.service';
import {
  CreateStudioProjectDto,
  StudioTranscribeDto,
  UpdateStudioProjectDto,
} from '@gitroom/nestjs-libraries/dtos/studio/studio.project.dto';

// Every transcription spends the workspace's own OpenAI credit
const HOUR = 60 * 60 * 1000;

@ApiTags('Studio')
@Controller('/studio')
export class StudioController {
  constructor(private _studioService: StudioService) {}

  @Get('/templates')
  getTemplates() {
    return this._studioService.getTemplates();
  }

  @Get('/usage')
  getUsage(@GetOrgFromRequest() org: Organization) {
    return this._studioService.getUsage(org);
  }

  @Get('/projects')
  getProjects(@GetOrgFromRequest() org: Organization) {
    return this._studioService.getProjects(org.id);
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

  @Post('/projects/:id/render')
  startRender(@GetOrgFromRequest() org: Organization, @Param('id') id: string) {
    return this._studioService.startRender(org, id);
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
