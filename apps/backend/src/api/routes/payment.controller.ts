import {
  Controller,
  HttpException,
  HttpStatus,
  Param,
  Post,
  RawBodyRequest,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PaymentService } from '@gitroom/nestjs-libraries/services/payment/payment.service';

@ApiTags('Payment')
@Controller('/payment')
export class PaymentController {
  constructor(private readonly _paymentService: PaymentService) {}

  @Post('/:provider')
  async webhook(
    @Param('provider') provider: string,
    @Req() req: RawBodyRequest<Request>
  ) {
    let result: any;
    try {
      result = await this._paymentService.webhook(
        provider,
        req.rawBody,
        // @ts-ignore
        req.headers
      );
    } catch (e) {
      if (e instanceof HttpException) {
        throw e;
      }
      throw new HttpException(e, 500);
    }

    // The event could not be stored (see SubscriptionWriteResult): a non-2xx
    // answer makes the provider send it again instead of losing it, like
    // StripeController
    if (result?.retry) {
      throw new HttpException(
        'The event could not be processed, please retry',
        HttpStatus.SERVICE_UNAVAILABLE
      );
    }

    return result;
  }
}
