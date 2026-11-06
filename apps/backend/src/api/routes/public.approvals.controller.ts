import { Body, Controller, Get, Header, Param, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ThrottlerRealIpGuard } from '@gitroom/nestjs-libraries/throttler/throttler.provider';
import { ApprovalsService } from '@gitroom/nestjs-libraries/database/prisma/approvals/approvals.service';
import { ClientApprovalDto } from '@gitroom/nestjs-libraries/dtos/approvals/approvals.dto';

const MINUTE = 60 * 1000;

// No account: a client opens the link the team shared and approves or asks
// for changes. The token is the only credential, so both routes are limited
// per client address.
@ApiTags('Public')
@Controller('/public/approvals')
export class PublicApprovalsController {
  constructor(private _approvalsService: ApprovalsService) {}

  @UseGuards(ThrottlerRealIpGuard)
  @Throttle({ default: { limit: 60, ttl: MINUTE } })
  @Header('Cache-Control', 'no-store')
  @Header('Referrer-Policy', 'no-referrer')
  @Get('/:token')
  getLink(@Param('token') token: string) {
    return this._approvalsService.getPublicLink(token);
  }

  @UseGuards(ThrottlerRealIpGuard)
  @Throttle({ default: { limit: 20, ttl: 10 * MINUTE } })
  @Header('Cache-Control', 'no-store')
  @Post('/:token')
  act(@Param('token') token: string, @Body() body: ClientApprovalDto) {
    return this._approvalsService.actOnPublicLink(token, body);
  }
}
