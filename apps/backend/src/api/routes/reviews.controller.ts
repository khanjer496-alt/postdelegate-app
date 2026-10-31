import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Organization, User } from '@prisma/client';
import { GetUserFromRequest } from '@gitroom/nestjs-libraries/user/user.from.request';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { ReviewService } from '@gitroom/nestjs-libraries/database/prisma/reviews/review.service';
import { CreateReviewDto } from '@gitroom/nestjs-libraries/dtos/reviews/create.review.dto';

@ApiTags('Reviews')
@Controller('/reviews')
export class ReviewsController {
  constructor(private _reviewService: ReviewService) {}

  @Get('/prompt')
  async getPrompt(
    @GetUserFromRequest() user: User,
    @GetOrgFromRequest() organization: Organization
  ) {
    return {
      eligible: await this._reviewService.isEligible(user, organization.id),
    };
  }

  @Post('/prompt/shown')
  markShown(@GetUserFromRequest() user: User) {
    return this._reviewService.markShown(user.id);
  }

  @Post('/prompt/dismiss')
  dismiss(@GetUserFromRequest() user: User) {
    return this._reviewService.dismiss(user.id);
  }

  @Get('/mine')
  getMine(@GetUserFromRequest() user: User) {
    return this._reviewService.getMine(user.id);
  }

  @Post('/')
  submit(
    @GetUserFromRequest() user: User,
    @GetOrgFromRequest() organization: Organization,
    @Body() body: CreateReviewDto
  ) {
    return this._reviewService.submit(user.id, organization.id, body);
  }
}
