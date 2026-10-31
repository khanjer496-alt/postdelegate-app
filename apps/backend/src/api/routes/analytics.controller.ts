import { Controller, Get, Param, Query } from '@nestjs/common';
import { Organization } from '@prisma/client';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { ApiTags } from '@nestjs/swagger';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { AnalyticsService } from '@gitroom/nestjs-libraries/database/prisma/analytics/analytics.service';
import { AnalyticsOverviewDto } from '@gitroom/nestjs-libraries/dtos/analytics/analytics.overview.dto';

@ApiTags('Analytics')
@Controller('/analytics')
export class AnalyticsController {
  constructor(
    private _integrationService: IntegrationService,
    private _postsService: PostsService,
    private _analyticsService: AnalyticsService
  ) {}

  // declared before /:integration so "overview" is not read as a channel id
  @Get('/overview')
  async getOverview(
    @GetOrgFromRequest() org: Organization,
    @Query() query: AnalyticsOverviewDto
  ) {
    return this._analyticsService.getOverview(
      org.id,
      query.days,
      query.timezone
    );
  }

  @Get('/overview/engagement')
  async getOverviewEngagement(
    @GetOrgFromRequest() org: Organization,
    @Query() query: AnalyticsOverviewDto
  ) {
    return this._analyticsService.getEngagement(org, query.days);
  }

  @Get('/:integration')
  async getIntegration(
    @GetOrgFromRequest() org: Organization,
    @Param('integration') integration: string,
    @Query('date') date: string
  ) {
    return this._integrationService.checkAnalytics(org, integration, date);
  }

  @Get('/post/:postId')
  async getPostAnalytics(
    @GetOrgFromRequest() org: Organization,
    @Param('postId') postId: string,
    @Query('date') date: string
  ) {
    return this._postsService.checkPostAnalytics(org.id, postId, +date);
  }

  // read-only: the channel view loads this after /:integration, which already
  // refreshed an expired token, so a failure here never refreshes or
  // disconnects the channel
  @Get('/:integration/recent-posts')
  async getRecentPosts(
    @GetOrgFromRequest() org: Organization,
    @Param('integration') integration: string
  ) {
    return this._integrationService.recentPosts(org, integration, false);
  }
}
