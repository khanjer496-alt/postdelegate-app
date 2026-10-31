import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { Organization, User } from '@prisma/client';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { GetUserFromRequest } from '@gitroom/nestjs-libraries/user/user.from.request';
import { ApiTags } from '@nestjs/swagger';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { AnalyticsService } from '@gitroom/nestjs-libraries/database/prisma/analytics/analytics.service';
import { AnalyticsOverviewDto } from '@gitroom/nestjs-libraries/dtos/analytics/analytics.overview.dto';
import { AnalyticsReportService } from '@gitroom/nestjs-libraries/database/prisma/analytics/analytics.report.service';
import {
  AnalyticsHistoryDto,
  AnalyticsTopPostsDto,
} from '@gitroom/nestjs-libraries/dtos/analytics/analytics.history.dto';
import {
  AnalyticsReportDataDto,
  AnalyticsReportSettingsDto,
} from '@gitroom/nestjs-libraries/dtos/analytics/analytics.report.dto';
import { CheckPolicies } from '@gitroom/backend/services/auth/permissions/permissions.ability';
import {
  AuthorizationActions,
  Sections,
} from '@gitroom/backend/services/auth/permissions/permission.exception.class';

@ApiTags('Analytics')
@Controller('/analytics')
export class AnalyticsController {
  constructor(
    private _integrationService: IntegrationService,
    private _postsService: PostsService,
    private _analyticsService: AnalyticsService,
    private _analyticsReportService: AnalyticsReportService
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

  // the history routes below are declared before /:integration too

  @Get('/trends')
  async getTrends(
    @GetOrgFromRequest() org: Organization,
    @Query() query: AnalyticsHistoryDto
  ) {
    return this._analyticsService.getTrends(
      org.id,
      query.days,
      query.integration
    );
  }

  @Get('/top-posts')
  async getTopPosts(
    @GetOrgFromRequest() org: Organization,
    @Query() query: AnalyticsTopPostsDto
  ) {
    return this._analyticsService.getTopPosts(org.id, query.days, query);
  }

  @Get('/best-times')
  async getBestTimes(
    @GetOrgFromRequest() org: Organization,
    @Query() query: AnalyticsHistoryDto
  ) {
    return this._analyticsService.getBestTimes(
      org.id,
      query.days,
      query.timezone
    );
  }

  @Get('/insights')
  async getInsights(
    @GetOrgFromRequest() org: Organization,
    @Query() query: AnalyticsHistoryDto
  ) {
    return this._analyticsService.getInsights(org.id, query.days);
  }

  @Get('/export/top-posts')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="top-posts.csv"')
  @Header('Cache-Control', 'no-store')
  async exportTopPosts(
    @GetOrgFromRequest() org: Organization,
    @Query() query: AnalyticsTopPostsDto
  ) {
    return this._analyticsService.exportTopPostsCsv(org.id, query.days, query);
  }

  @Get('/export/daily')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="daily-metrics.csv"')
  @Header('Cache-Control', 'no-store')
  async exportDaily(
    @GetOrgFromRequest() org: Organization,
    @Query() query: AnalyticsTopPostsDto
  ) {
    return this._analyticsService.exportDailyCsv(
      org.id,
      query.days,
      query.integrations
    );
  }

  @Get('/reports/settings')
  @CheckPolicies([AuthorizationActions.Create, Sections.ADMIN])
  async getReportSettings(@GetOrgFromRequest() org: Organization) {
    return this._analyticsReportService.getSettings(org.id);
  }

  @Put('/reports/settings')
  @CheckPolicies(
    [AuthorizationActions.Create, Sections.ADMIN],
    [AuthorizationActions.Create, Sections.ANALYTICS_REPORTS]
  )
  async updateReportSettings(
    @GetOrgFromRequest() org: Organization,
    @Body() body: AnalyticsReportSettingsDto
  ) {
    return this._analyticsReportService.updateSettings(org.id, body);
  }

  // a sample report to the member asking, never to anyone else
  @Post('/reports/test')
  @CheckPolicies(
    [AuthorizationActions.Create, Sections.ADMIN],
    [AuthorizationActions.Create, Sections.ANALYTICS_REPORTS]
  )
  async sendTestReport(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User
  ) {
    return this._analyticsReportService.sendTest(org.id, user.email);
  }

  // the data of the white-label report page, printed to PDF by the browser
  @Get('/reports/data')
  @CheckPolicies([AuthorizationActions.Read, Sections.ANALYTICS_REPORTS])
  async getReportData(
    @GetOrgFromRequest() org: Organization,
    @Query() query: AnalyticsReportDataDto
  ) {
    return this._analyticsReportService.getReportDataForRange(
      org.id,
      query.from,
      query.to,
      query.timezone
    );
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
