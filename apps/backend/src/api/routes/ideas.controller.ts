import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Organization, User } from '@prisma/client';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { GetUserFromRequest } from '@gitroom/nestjs-libraries/user/user.from.request';
import { IdeasService } from '@gitroom/nestjs-libraries/database/prisma/ideas/ideas.service';
import {
  CreateIdeaDto,
  UpdateIdeaDto,
} from '@gitroom/nestjs-libraries/dtos/ideas/idea.dto';

@ApiTags('Ideas')
@Controller('/ideas')
export class IdeasController {
  constructor(private _ideasService: IdeasService) {}

  @Get('/')
  getIdeas(@GetOrgFromRequest() org: Organization) {
    return this._ideasService.getIdeas(org.id);
  }

  @Post('/')
  createIdea(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
    @Body() body: CreateIdeaDto
  ) {
    return this._ideasService.createIdea(org.id, user.id, body);
  }

  @Put('/:id')
  updateIdea(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body() body: UpdateIdeaDto
  ) {
    return this._ideasService.updateIdea(org.id, id, body);
  }

  @Delete('/:id')
  deleteIdea(@GetOrgFromRequest() org: Organization, @Param('id') id: string) {
    return this._ideasService.deleteIdea(org.id, id);
  }
}
