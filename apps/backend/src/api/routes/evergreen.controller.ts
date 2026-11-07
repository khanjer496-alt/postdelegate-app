import { Body, Controller, Delete, Get, Param, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Organization } from '@prisma/client';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { PostsEvergreenService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.evergreen.service';
import { EvergreenDto } from '@gitroom/nestjs-libraries/dtos/posts/evergreen.dto';

// Evergreen settings of a post group, on top of its repeat interval
@ApiTags('Posts')
@Controller('/evergreen')
export class EvergreenController {
  constructor(private _evergreenService: PostsEvergreenService) {}

  @Get('/:group')
  getEvergreen(
    @GetOrgFromRequest() org: Organization,
    @Param('group') group: string
  ) {
    return this._evergreenService.getEvergreen(org.id, group);
  }

  @Put('/:group')
  updateEvergreen(
    @GetOrgFromRequest() org: Organization,
    @Param('group') group: string,
    @Body() body: EvergreenDto
  ) {
    return this._evergreenService.updateEvergreen(org.id, group, body);
  }

  @Delete('/:group')
  stopEvergreen(
    @GetOrgFromRequest() org: Organization,
    @Param('group') group: string
  ) {
    return this._evergreenService.stopEvergreen(org.id, group);
  }
}
