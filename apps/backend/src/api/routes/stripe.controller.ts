import {
  Controller,
  HttpException,
  HttpStatus,
  Post,
  RawBodyRequest,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PaymentService } from '@gitroom/nestjs-libraries/services/payment/payment.service';

@ApiTags('Stripe')
@Controller('/stripe')
export class StripeController {
  constructor(private readonly _paymentService: PaymentService) {}

  @Post('/')
  async stripe(@Req() req: RawBodyRequest<Request>) {
    const result = await this._paymentService.webhook(
      'stripe',
      req.rawBody,
      // @ts-ignore
      req.headers
    );

    // The event could not be applied (a database or Stripe error, see
    // SubscriptionWriteResult): a non-2xx answer makes Stripe send it again,
    // instead of losing it. Skipped events (unknown customer, lifetime plan)
    // still answer 2xx
    if (result?.retry) {
      throw new HttpException(
        'The event could not be processed, please retry',
        HttpStatus.SERVICE_UNAVAILABLE
      );
    }

    return result;
  }
}
