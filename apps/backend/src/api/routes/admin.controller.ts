import {
  Body,
  Controller,
  Get,
  HttpException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { GetUserFromRequest } from '@gitroom/nestjs-libraries/user/user.from.request';
import { User } from '@prisma/client';
import { ApiTags } from '@nestjs/swagger';
import { ErrorsService } from '@gitroom/nestjs-libraries/database/prisma/errors/errors.service';
import { AdminStatsService } from '@gitroom/nestjs-libraries/database/prisma/admin-stats/admin-stats.service';
import { AffiliateService } from '@gitroom/nestjs-libraries/database/prisma/affiliates/affiliate.service';
import { MarkAffiliatePaidDto } from '@gitroom/nestjs-libraries/dtos/affiliates/mark.affiliate.paid.dto';
import { ReviewService } from '@gitroom/nestjs-libraries/database/prisma/reviews/review.service';
import { UpdateReviewStatusDto } from '@gitroom/nestjs-libraries/dtos/reviews/update.review.status.dto';
import dayjs from 'dayjs';

@ApiTags('Admin')
@Controller('/admin')
export class AdminController {
  constructor(
    private _errorsService: ErrorsService,
    private _adminStatsService: AdminStatsService,
    private _affiliateService: AffiliateService,
    private _reviewService: ReviewService
  ) {}

  private assertSuperAdmin(user: User) {
    if (!user?.isSuperAdmin) {
      throw new HttpException('Unauthorized', 400);
    }
  }

  @Get('/errors')
  async listErrors(
    @GetUserFromRequest() user: User,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('platform') platform?: string,
    @Query('email') email?: string,
    @Query('unknownFirst') unknownFirst?: string
  ) {
    this.assertSuperAdmin(user);
    return this._errorsService.listErrors({
      page: page ? parseInt(page, 10) : 0,
      limit: limit ? parseInt(limit, 10) : 20,
      platform: platform || undefined,
      email: email || undefined,
      unknownFirst: unknownFirst === 'true' || unknownFirst === '1',
    });
  }

  @Get('/errors/platforms')
  async listPlatforms(@GetUserFromRequest() user: User) {
    this.assertSuperAdmin(user);
    return this._errorsService.listPlatforms();
  }

  @Get('/stats')
  async getStats(
    @GetUserFromRequest() user: User,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('unknownOnly') unknownOnly?: string
  ) {
    this.assertSuperAdmin(user);

    const fromDate = from ? dayjs(from) : dayjs().subtract(30, 'day');
    const toDate = to ? dayjs(to) : dayjs();

    return this._adminStatsService.getStats({
      from: fromDate.startOf('day').toDate(),
      to: toDate.endOf('day').toDate(),
      unknownOnly: unknownOnly === 'true' || unknownOnly === '1',
    });
  }

  // Sign-ups, trials and revenue for the owner, same range as /stats
  @Get('/stats/growth')
  async getGrowthStats(
    @GetUserFromRequest() user: User,
    @Query('from') from?: string,
    @Query('to') to?: string
  ) {
    this.assertSuperAdmin(user);

    const fromDate = from ? dayjs(from) : dayjs().subtract(30, 'day');
    const toDate = to ? dayjs(to) : dayjs();

    return this._adminStatsService.getGrowth({
      from: fromDate.startOf('day').toDate(),
      to: toDate.endOf('day').toDate(),
    });
  }

  // Visitors and Google search of the marketing site, same range as /stats
  @Get('/stats/website')
  async getWebsiteStats(
    @GetUserFromRequest() user: User,
    @Query('from') from?: string,
    @Query('to') to?: string
  ) {
    this.assertSuperAdmin(user);

    const fromDate = from ? dayjs(from) : dayjs().subtract(30, 'day');
    const toDate = to ? dayjs(to) : dayjs();
    // Search Console keeps 16 months; anything wider is a mistyped date
    if (
      !fromDate.isValid() ||
      !toDate.isValid() ||
      fromDate.isAfter(toDate) ||
      toDate.diff(fromDate, 'day') > 500
    ) {
      throw new HttpException('Invalid date range', 400);
    }

    return this._adminStatsService.getWebsite({
      from: fromDate.startOf('day').toDate(),
      to: toDate.endOf('day').toDate(),
    });
  }

  @Get('/affiliates/payouts')
  async listAffiliatePayouts(@GetUserFromRequest() user: User) {
    this.assertSuperAdmin(user);
    return this._affiliateService.listPayouts();
  }

  @Post('/affiliates/payouts/:affiliateId/paid')
  async markAffiliatePaid(
    @GetUserFromRequest() user: User,
    @Param('affiliateId') affiliateId: string,
    @Body() body: MarkAffiliatePaidDto
  ) {
    this.assertSuperAdmin(user);
    return this._affiliateService.markPaid(
      affiliateId,
      body.expectedAmountCents,
      body.reference
    );
  }

  @Get('/reviews')
  async listReviews(
    @GetUserFromRequest() user: User,
    @Query('status') status?: string
  ) {
    this.assertSuperAdmin(user);
    return this._reviewService.listForAdmin(status || undefined);
  }

  // Approved and consented reviews only, the shape of the site feed
  @Get('/reviews/export')
  async exportReviews(@GetUserFromRequest() user: User) {
    this.assertSuperAdmin(user);
    return this._reviewService.exportApproved();
  }

  @Post('/reviews/:id/status')
  async setReviewStatus(
    @GetUserFromRequest() user: User,
    @Param('id') id: string,
    @Body() body: UpdateReviewStatusDto
  ) {
    this.assertSuperAdmin(user);
    return this._reviewService.setStatus(id, body.status);
  }
}
