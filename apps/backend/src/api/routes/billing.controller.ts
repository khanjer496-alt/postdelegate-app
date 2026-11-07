import {
  Body,
  Controller,
  Get,
  HttpException,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { SubscriptionService } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { Organization, User } from '@prisma/client';
import { BillingSubscribeDto } from '@gitroom/nestjs-libraries/dtos/billing/billing.subscribe.dto';
import { AdminApplyCouponDto } from '@gitroom/nestjs-libraries/dtos/billing/admin.apply.coupon.dto';
import { ApiTags } from '@nestjs/swagger';
import { GetUserFromRequest } from '@gitroom/nestjs-libraries/user/user.from.request';
import { NotificationService } from '@gitroom/nestjs-libraries/database/prisma/notifications/notification.service';
import { Request } from 'express';
import { escape } from 'lodash';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { UsersService } from '@gitroom/nestjs-libraries/database/prisma/users/users.service';
import { PaymentService } from '@gitroom/nestjs-libraries/services/payment/payment.service';
import { BillingSyncDto } from '@gitroom/nestjs-libraries/dtos/billing/billing.sync.dto';
import { BillingExtraChannelsDto } from '@gitroom/nestjs-libraries/dtos/billing/billing.extra.channels.dto';
import { BillingCancelDto } from '@gitroom/nestjs-libraries/dtos/billing/billing.cancel.dto';
import { CheckPolicies } from '@gitroom/backend/services/auth/permissions/permissions.ability';
import {
  AuthorizationActions,
  Sections,
} from '@gitroom/backend/services/auth/permissions/permission.exception.class';

// Whether this checkout gets the free trial. Deliberately one-way: a request
// may decline the trial, but cannot grant one to an organisation that has
// already used its own - canStartTrial stays the authority.
// Strict on purpose: only a real boolean true declines the trial. This
// codebase has been bitten before by the string "false" being truthy, and a
// buyer silently losing their free trial to a stray string is the same bug.
export const allowTrialFor = (
  canStartTrial: boolean,
  body: { skipTrial?: unknown }
) => canStartTrial && body?.skipTrial !== true;

@ApiTags('Billing')
@Controller('/billing')
export class BillingController {
  constructor(
    private _subscriptionService: SubscriptionService,
    private _notificationService: NotificationService,
    private _usersService: UsersService,
    private _paymentService: PaymentService
  ) {}

  // Billing routes are the web platform; the org's own provider (or the web
  // default when it has none) handles the action.
  private provider(org: Organization) {
    return this._paymentService.getProviderForOrganization(org.id, 'web');
  }

  private async assertNoOtherSubscribedAccount(user: User) {
    const other = await this._usersService.getUserWithActiveSubscriptionByEmail(
      user.email,
      user.id
    );
    return !!other;
  }

  @Get('/check/:id')
  async checkId(
    @GetOrgFromRequest() org: Organization,
    @Param('id') body: string
  ) {
    return {
      status: await (await this.provider(org)).checkSubscription(org.id, body),
    };
  }

  @Get('/check-discount')
  async checkDiscount(@GetOrgFromRequest() org: Organization) {
    return {
      offerCoupon: !(await (await this.provider(org)).checkDiscount(org))
        ? false
        : AuthService.signTypedJWT('billing-discount', { discount: true }),
    };
  }

  @Post('/apply-discount')
  @CheckPolicies([AuthorizationActions.Create, Sections.ADMIN])
  async applyDiscount(@GetOrgFromRequest() org: Organization) {
    return {
      applied: !!(await (await this.provider(org)).applyDiscount(org)),
    };
  }

  @Post('/finish-trial')
  @CheckPolicies([AuthorizationActions.Create, Sections.ADMIN])
  async finishTrial(@GetOrgFromRequest() org: Organization) {
    const provider = await this.provider(org);
    try {
      const action = await provider.finishTrial(org);
      if (action.requiresAction) {
        return { finish: false, ...action };
      }
      return { finish: true };
    } catch (err) {
      console.error('finishTrial failed', err);
      // never the provider's error, it can carry payment details
      return {
        finish: false,
        reason:
          'We could not start your plan. Check your payment method in the billing portal and try again.',
      };
    }
  }

  @Get('/is-trial-finished')
  async isTrialFinished(@GetOrgFromRequest() org: Organization) {
    return {
      finished: !org.isTrailing,
    };
  }

  @Post('/embedded')
  @CheckPolicies([AuthorizationActions.Create, Sections.ADMIN])
  async embedded(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
    @Body() body: BillingSubscribeDto,
    // read beside the DTO, never on it: the DTO is spread into Stripe
    // metadata, which only accepts strings
    @Body('skipTrial') skipTrial: unknown,
    @Req() req: Request
  ) {
    if (await this.assertNoOtherSubscribedAccount(user)) {
      return { blocked: true };
    }

    const uniqueId = req?.cookies?.track;
    return (await this.provider(org)).embedded(
      uniqueId,
      org.id,
      user.id,
      body,
      allowTrialFor(await this._usersService.canStartTrial(org), { skipTrial })
    );
  }

  @Post('/subscribe')
  @CheckPolicies([AuthorizationActions.Create, Sections.ADMIN])
  async subscribe(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
    @Body() body: BillingSubscribeDto,
    // read beside the DTO, never on it: the DTO is spread into Stripe
    // metadata, which only accepts strings
    @Body('skipTrial') skipTrial: unknown,
    @Req() req: Request
  ) {
    if (await this.assertNoOtherSubscribedAccount(user)) {
      return { blocked: true };
    }

    const uniqueId = req?.cookies?.track;
    return (await this.provider(org)).subscribe(
      uniqueId,
      org.id,
      user.id,
      body,
      allowTrialFor(await this._usersService.canStartTrial(org), { skipTrial })
    );
  }

  @Post('/start-trial')
  @CheckPolicies([AuthorizationActions.Create, Sections.ADMIN])
  async startTrial(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
    @Body() body: BillingSubscribeDto,
    // read beside the DTO, never on it: the DTO is spread into Stripe
    // metadata, which only accepts strings
    @Body('skipTrial') skipTrial: unknown,
    @Req() req: Request
  ) {
    if (await this.assertNoOtherSubscribedAccount(user)) {
      return { blocked: true };
    }
    if (!(await this._usersService.canStartTrial(org))) {
      return { trialUsed: true };
    }

    const uniqueId = req?.cookies?.track;
    return (await this.provider(org)).startTrial(
      uniqueId,
      org.id,
      user.id,
      body
    );
  }

  @Post('/sync')
  @CheckPolicies([AuthorizationActions.Create, Sections.ADMIN])
  async sync(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
    @Body() body: BillingSyncDto
  ) {
    if (await this.assertNoOtherSubscribedAccount(user)) {
      return { blocked: true };
    }
    await this._paymentService.assertCanUseProvider(org.id, body.provider);

    try {
      return await this._paymentService.syncSubscription(body.provider, org.id);
    } catch (e) {
      if (e instanceof HttpException) {
        throw e;
      }
      throw new HttpException((e as Error)?.message || 'Sync failed', 400);
    }
  }

  @Get('/portal')
  @CheckPolicies([AuthorizationActions.Create, Sections.ADMIN])
  async modifyPayment(@GetOrgFromRequest() org: Organization) {
    const { url } = await (await this.provider(org)).portalLink(org.id);
    return {
      portal: url,
    };
  }

  @Get('/add-payment-method')
  @CheckPolicies([AuthorizationActions.Create, Sections.ADMIN])
  async addPaymentMethod(@GetOrgFromRequest() org: Organization) {
    const { url } = await (
      await this.provider(org)
    ).addPaymentMethodLink(org.id);
    return {
      portal: url,
    };
  }

  @Get('/invoices')
  @CheckPolicies([AuthorizationActions.Create, Sections.ADMIN])
  async getInvoices(@GetOrgFromRequest() org: Organization) {
    return (await this.provider(org)).getInvoices(org.id);
  }

  @Get('/renewal')
  async getRenewal(@GetOrgFromRequest() org: Organization) {
    return (await this.provider(org)).getRenewalDate(org.id);
  }

  @Get('/')
  getCurrentBilling(@GetOrgFromRequest() org: Organization) {
    return this._paymentService.getSubscription(org.id);
  }

  @Post('/cancel')
  @CheckPolicies([AuthorizationActions.Create, Sections.ADMIN])
  async cancel(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
    @Body() body: BillingCancelDto
  ) {
    const result = await (
      await this.provider(org)
    ).setToCancel(org.id, body.intent);

    // only when this request actually set it to cancel (an explicit cancel,
    // or the old toggle going that way), never on a reactivation
    if (result.action === 'cancel' && result.cancel_at) {
      await this._notificationService.sendEmail(
        process.env.EMAIL_FROM_ADDRESS,
        'Subscription Cancelled',
        `Organization ${escape(
          org.name
        )} has cancelled their subscription because: ${escape(
          body.feedback || ''
        )}`,
        user.email
      );
    }

    return result;
  }

  @Post('/prorate')
  @CheckPolicies([AuthorizationActions.Create, Sections.ADMIN])
  async prorate(
    @GetOrgFromRequest() org: Organization,
    @Body() body: BillingSubscribeDto
  ) {
    return (await this.provider(org)).prorate(org.id, body);
  }

  @Get('/extra-channels')
  @CheckPolicies([AuthorizationActions.Create, Sections.ADMIN])
  async getExtraChannels(@GetOrgFromRequest() org: Organization) {
    return (await this.provider(org)).getExtraChannels(org.id);
  }

  @Post('/extra-channels')
  @CheckPolicies([AuthorizationActions.Create, Sections.ADMIN])
  async setExtraChannels(
    @GetOrgFromRequest() org: Organization,
    @Body() body: BillingExtraChannelsDto
  ) {
    return (await this.provider(org)).setExtraChannels(
      org.id,
      body.extraChannels
    );
  }

  @Get('/charges')
  async getCharges(
    @GetUserFromRequest() user: User,
    @GetOrgFromRequest() org: Organization
  ) {
    if (!user.isSuperAdmin) {
      throw new HttpException('Unauthorized', 400);
    }

    return (await this.provider(org)).getCharges(org.id);
  }

  @Post('/refund-charges')
  async refundCharges(
    @GetUserFromRequest() user: User,
    @GetOrgFromRequest() org: Organization,
    @Body() body: { chargeIds: string[] }
  ) {
    if (!user.isSuperAdmin) {
      throw new HttpException('Unauthorized', 400);
    }

    return (await this.provider(org)).refundCharges(org.id, body.chargeIds);
  }

  @Post('/cancel-subscription')
  async cancelSubscription(
    @GetUserFromRequest() user: User,
    @GetOrgFromRequest() org: Organization
  ) {
    if (!user.isSuperAdmin) {
      throw new HttpException('Unauthorized', 400);
    }

    return (await this.provider(org)).cancelSubscription(org.id);
  }

  @Get('/coupon-info')
  async couponInfo(
    @GetUserFromRequest() user: User,
    @GetOrgFromRequest() org: Organization
  ) {
    if (!user.isSuperAdmin) {
      throw new HttpException('Unauthorized', 400);
    }

    return (await this.provider(org)).getCouponInfo(org.id);
  }

  @Post('/apply-coupon')
  async applyCoupon(
    @GetUserFromRequest() user: User,
    @GetOrgFromRequest() org: Organization,
    @Body() body: AdminApplyCouponDto
  ) {
    if (!user.isSuperAdmin) {
      throw new HttpException('Unauthorized', 400);
    }

    return (await this.provider(org)).applyCoupon(org.id, body);
  }

  @Post('/cancel-coupon')
  async cancelCoupon(
    @GetUserFromRequest() user: User,
    @GetOrgFromRequest() org: Organization
  ) {
    if (!user.isSuperAdmin) {
      throw new HttpException('Unauthorized', 400);
    }

    return (await this.provider(org)).cancelCoupon(org.id);
  }

  @Post('/add-subscription')
  async addSubscription(
    @Body() body: { subscription: string },
    @GetUserFromRequest() user: User,
    @GetOrgFromRequest() org: Organization
  ) {
    if (!user.isSuperAdmin) {
      throw new Error('Unauthorized');
    }

    const { added, reason } = await this._subscriptionService.addSubscription(
      org.id,
      body.subscription,
      this._paymentService.getDefaultProviderName('web')
    );
    if (!added) {
      throw new HttpException(reason || 'The plan was not added', 400);
    }
    return { added };
  }
}
