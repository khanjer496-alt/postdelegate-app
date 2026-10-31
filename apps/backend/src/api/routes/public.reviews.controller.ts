import { Controller, Get, Header, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ThrottlerRealIpGuard } from '@gitroom/nestjs-libraries/throttler/throttler.provider';
import { ReviewService } from '@gitroom/nestjs-libraries/database/prisma/reviews/review.service';

@ApiTags('Public')
@Controller('/public/reviews')
export class PublicReviewsController {
  constructor(private _reviewService: ReviewService) {}

  // No auth, read by the marketing site build. Only reviews a super admin
  // approved and the author agreed to publish, with no ids or emails.
  @UseGuards(ThrottlerRealIpGuard)
  @Throttle({ default: { limit: 60, ttl: 3600000 } })
  @Header('Cache-Control', 'public, max-age=60')
  @Get('/')
  getFeed() {
    return this._reviewService.getPublicFeed();
  }
}
