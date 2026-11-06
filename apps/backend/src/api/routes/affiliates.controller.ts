import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { User } from '@prisma/client';
import { GetUserFromRequest } from '@gitroom/nestjs-libraries/user/user.from.request';
import { AffiliateService } from '@gitroom/nestjs-libraries/database/prisma/affiliates/affiliate.service';
import { SetAffiliateCodeDto } from '@gitroom/nestjs-libraries/dtos/affiliates/set.affiliate.code.dto';
import { AffiliatePayoutDto } from '@gitroom/nestjs-libraries/dtos/affiliates/affiliate.payout.dto';

@ApiTags('Affiliates')
@Controller('/affiliates')
export class AffiliatesController {
  constructor(private _affiliateService: AffiliateService) {}

  @Get('/')
  getOverview(@GetUserFromRequest() user: User) {
    return this._affiliateService.getOverview(user.id);
  }

  @Post('/code')
  setCode(@GetUserFromRequest() user: User, @Body() body: SetAffiliateCodeDto) {
    return this._affiliateService.setCustomCode(user.id, body.code);
  }

  @Post('/payout')
  setPayout(
    @GetUserFromRequest() user: User,
    @Body() body: AffiliatePayoutDto
  ) {
    return this._affiliateService.updatePayoutEmail(user.id, body.payoutEmail);
  }
}
