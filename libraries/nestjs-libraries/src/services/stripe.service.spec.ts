const mockStripe = {
  prices: { list: jest.fn(), create: jest.fn() },
  products: { list: jest.fn(), create: jest.fn() },
  subscriptions: {
    list: jest.fn(),
    cancel: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    retrieve: jest.fn(),
  },
  promotionCodes: { list: jest.fn() },
  customers: { retrieve: jest.fn(), update: jest.fn() },
  paymentMethods: { list: jest.fn() },
  billingPortal: { sessions: { create: jest.fn() } },
  invoicePayments: { list: jest.fn() },
  invoices: {
    retrieve: jest.fn(),
    voidInvoice: jest.fn(),
    createPreview: jest.fn(),
  },
  coupons: { create: jest.fn() },
  charges: { retrieve: jest.fn(), list: jest.fn() },
};

jest.mock('stripe', () => ({
  __esModule: true,
  default: jest.fn(() => mockStripe),
}));
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service',
  () => ({ SubscriptionService: class {} })
);
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service',
  () => ({ OrganizationService: class {} })
);
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/users/users.service',
  () => ({ UsersService: class {} })
);
jest.mock('@gitroom/nestjs-libraries/track/track.service', () => ({
  TrackService: class {},
}));
jest.mock('@gitroom/helpers/auth/auth.service', () => ({ AuthService: {} }));
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/notifications/notification.service',
  () => ({ NotificationService: class {} })
);

import {
  extraChannelsOf,
  planItemOf,
  planProductIds,
  resolveExtraChannelPrice,
  resolveTierPrice,
  StripeService,
  trialEndsSoonDetails,
} from '@gitroom/nestjs-libraries/services/stripe.service';

describe('resolveTierPrice', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  it('uses the price found by lookup key when the amount matches', async () => {
    mockStripe.prices.list.mockResolvedValueOnce({
      data: [{ id: 'price_starter_month', unit_amount: 1900 }],
    });

    const price = await resolveTierPrice(
      mockStripe as any,
      'STANDARD',
      'MONTHLY'
    );

    expect(price.id).toBe('price_starter_month');
    expect(mockStripe.prices.list).toHaveBeenCalledWith({
      lookup_keys: ['postdelegate_starter_month'],
      active: true,
    });
    expect(mockStripe.products.list).not.toHaveBeenCalled();
    expect(mockStripe.prices.create).not.toHaveBeenCalled();
  });

  it('builds the yearly lookup key and amount', async () => {
    mockStripe.prices.list.mockResolvedValueOnce({
      data: [{ id: 'price_ultimate_year', unit_amount: 75600 }],
    });

    const price = await resolveTierPrice(
      mockStripe as any,
      'ULTIMATE',
      'YEARLY'
    );

    expect(price.id).toBe('price_ultimate_year');
    expect(mockStripe.prices.list.mock.calls[0][0].lookup_keys).toEqual([
      'postdelegate_ultimate_year',
    ]);
  });

  it('falls back to the name based lookup when the amount does not match', async () => {
    mockStripe.prices.list
      .mockResolvedValueOnce({
        data: [{ id: 'price_wrong', unit_amount: 2900 }],
      })
      .mockResolvedValueOnce({
        data: [
          {
            id: 'price_by_name',
            unit_amount: 1900,
            recurring: { interval: 'month' },
          },
        ],
      });
    mockStripe.products.list.mockResolvedValueOnce({
      data: [{ id: 'prod_1', name: 'standard' }],
    });

    const price = await resolveTierPrice(
      mockStripe as any,
      'STANDARD',
      'MONTHLY'
    );

    expect(price.id).toBe('price_by_name');
    expect(console.warn).toHaveBeenCalled();
    expect(mockStripe.prices.create).not.toHaveBeenCalled();
  });

  it('creates the product and price when nothing exists', async () => {
    mockStripe.prices.list
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: [] });
    mockStripe.products.list.mockResolvedValueOnce({ data: [] });
    mockStripe.products.create.mockResolvedValueOnce({ id: 'prod_new' });
    mockStripe.prices.create.mockResolvedValueOnce({ id: 'price_new' });

    const price = await resolveTierPrice(mockStripe as any, 'TEAM', 'YEARLY');

    expect(price.id).toBe('price_new');
    expect(mockStripe.products.create).toHaveBeenCalledWith({
      active: true,
      name: 'TEAM',
    });
    expect(mockStripe.prices.create).toHaveBeenCalledWith(
      expect.objectContaining({
        product: 'prod_new',
        unit_amount: 27600,
        recurring: { interval: 'year' },
      })
    );
  });
});

describe('StripeService failed payments', () => {
  const subscriptionService = {
    createOrUpdateSubscription: jest.fn(),
    deleteSubscription: jest.fn(),
  };
  const organizationService = {
    getOrgByCustomerId: jest.fn().mockResolvedValue({ allowTrial: false }),
  };
  const service = new StripeService(
    subscriptionService as any,
    organizationService as any,
    {} as any,
    {} as any
  );

  const event = (status: string, id = 'sub_1') =>
    ({
      type: 'customer.subscription.updated',
      data: {
        object: {
          id,
          status,
          customer: 'cus_1',
          cancel_at: null,
          metadata: {
            service: 'gitroom',
            billing: 'STANDARD',
            period: 'MONTHLY',
            uniqueId: 'u1',
          },
        },
      },
    } as any);

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    mockStripe.subscriptions.list.mockResolvedValue({ data: [] });
  });

  it.each(['unpaid', 'canceled', 'incomplete_expired'])(
    'drops the paid tier when a subscription becomes %s',
    async (status) => {
      await service.processWebhook(event(status));

      expect(subscriptionService.deleteSubscription).toHaveBeenCalledWith(
        'cus_1',
        'stripe'
      );
      expect(
        subscriptionService.createOrUpdateSubscription
      ).not.toHaveBeenCalled();
    }
  );

  it('keeps the tier while Stripe retries a past_due renewal', async () => {
    await service.processWebhook(event('past_due'));

    expect(subscriptionService.deleteSubscription).not.toHaveBeenCalled();
    expect(subscriptionService.createOrUpdateSubscription).toHaveBeenCalled();
  });

  it('does not treat an unpaid sibling as a survivor', async () => {
    mockStripe.subscriptions.list.mockResolvedValue({
      data: [
        { id: 'sub_1', status: 'unpaid', metadata: {} },
        { id: 'sub_other', status: 'unpaid', metadata: {} },
      ],
    });

    await service.processWebhook(event('unpaid'));

    expect(subscriptionService.deleteSubscription).toHaveBeenCalled();
  });

  it('keeps an active survivor instead of downgrading', async () => {
    mockStripe.subscriptions.list.mockResolvedValue({
      data: [
        { id: 'sub_1', status: 'unpaid', metadata: {} },
        {
          id: 'sub_2',
          status: 'active',
          cancel_at: null,
          metadata: {
            billing: 'PRO',
            period: 'MONTHLY',
            uniqueId: 'u2',
          },
        },
      ],
    });

    await service.processWebhook(event('unpaid'));

    expect(subscriptionService.deleteSubscription).not.toHaveBeenCalled();
    expect(subscriptionService.createOrUpdateSubscription).toHaveBeenCalledWith(
      'stripe',
      false,
      'u2',
      'cus_1',
      expect.any(Number),
      'PRO',
      'MONTHLY',
      null
    );
  });
});

describe('createBillingPortalLink', () => {
  const service = new StripeService({} as any, {} as any, {} as any, {} as any);
  const original = process.env.STRIPE_PORTAL_CONFIGURATION;
  afterEach(() => {
    if (original === undefined) {
      delete process.env.STRIPE_PORTAL_CONFIGURATION;
    } else {
      process.env.STRIPE_PORTAL_CONFIGURATION = original;
    }
  });

  it('only passes a configuration when one is set', async () => {
    delete process.env.STRIPE_PORTAL_CONFIGURATION;
    await service.createBillingPortalLink('cus_1');
    expect(
      mockStripe.billingPortal.sessions.create.mock.calls[0][0]
    ).not.toHaveProperty('configuration');

    process.env.STRIPE_PORTAL_CONFIGURATION = 'bpc_123';
    await service.createBillingPortalLink('cus_1');
    expect(
      mockStripe.billingPortal.sessions.create.mock.calls[1][0].configuration
    ).toBe('bpc_123');
  });
});

describe('applyDiscount', () => {
  const service = new StripeService({} as any, {} as any, {} as any, {} as any);
  const original = process.env.STRIPE_DISCOUNT_ID;
  beforeEach(() => {
    process.env.STRIPE_DISCOUNT_ID = 'coupon_save';
    mockStripe.subscriptions.update.mockReset();
    mockStripe.charges.list.mockResolvedValue({ data: [{ amount: 7900 }] });
  });
  afterEach(() => {
    if (original === undefined) {
      delete process.env.STRIPE_DISCOUNT_ID;
    } else {
      process.env.STRIPE_DISCOUNT_ID = original;
    }
  });

  const subscription = (interval: string, discounts: any[] = []) => ({
    data: [
      {
        id: 'sub_1',
        status: 'active',
        discounts,
        items: { data: [{ price: { recurring: { interval } } }] },
      },
    ],
  });

  it('applies the coupon to an eligible monthly subscription', async () => {
    mockStripe.subscriptions.list.mockResolvedValue(subscription('month'));
    expect(await service.applyDiscount({ paymentId: 'cus_1' } as any)).toBe(
      true
    );
    expect(mockStripe.subscriptions.update).toHaveBeenCalledTimes(1);
  });

  it('refuses a yearly subscription', async () => {
    mockStripe.subscriptions.list.mockResolvedValue(subscription('year'));
    expect(await service.applyDiscount({ paymentId: 'cus_1' } as any)).toBe(
      false
    );
    expect(mockStripe.subscriptions.update).not.toHaveBeenCalled();
  });

  it('refuses a subscription that already has a discount', async () => {
    mockStripe.subscriptions.list.mockResolvedValue(
      subscription('month', [{ id: 'di_1' }])
    );
    expect(await service.applyDiscount({ paymentId: 'cus_1' } as any)).toBe(
      false
    );
    expect(mockStripe.subscriptions.update).not.toHaveBeenCalled();
  });
});

describe('StripeService affiliate events', () => {
  const affiliateService = {
    recordInvoicePayment: jest.fn(),
    reverseCommission: jest.fn(),
  };
  const service = new StripeService(
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    affiliateService as any
  );

  const invoiceEvent = (over: Record<string, unknown> = {}) =>
    ({
      type: 'invoice.payment_succeeded',
      data: {
        object: {
          id: 'in_1',
          customer: 'cus_1',
          amount_paid: 2900,
          total: 2900,
          total_taxes: [{ amount: 400, tax_behavior: 'exclusive' }],
          currency: 'usd',
          created: 1790000000,
          status_transitions: { paid_at: 1790000100 },
          metadata: {},
          ...over,
        },
      },
    } as any);

  beforeEach(() => {
    jest.resetAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('records the commission of a paid invoice without needing gitroom metadata', async () => {
    await service.processWebhook(invoiceEvent());

    expect(affiliateService.recordInvoicePayment).toHaveBeenCalledWith({
      invoiceId: 'in_1',
      customerId: 'cus_1',
      amountPaidCents: 2900,
      totalCents: 2900,
      taxCents: 400,
      currency: 'usd',
      paidAt: new Date(1790000100 * 1000),
    });
  });

  it('reads the customer from an expanded object and falls back to the creation date', async () => {
    await service.processWebhook(
      invoiceEvent({
        customer: { id: 'cus_9' },
        status_transitions: { paid_at: null },
        total_taxes: null,
      })
    );

    expect(affiliateService.recordInvoicePayment).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: 'cus_9',
        taxCents: 0,
        paidAt: new Date(1790000000 * 1000),
      })
    );
  });

  it('does not fail the webhook when the commission cannot be recorded', async () => {
    affiliateService.recordInvoicePayment.mockRejectedValue(new Error('db'));

    await expect(service.processWebhook(invoiceEvent())).resolves.toEqual({
      ok: true,
    });
    expect(console.error).toHaveBeenCalledWith(
      'affiliate_commission_failed',
      { stripe_invoice_id: 'in_1' },
      expect.any(Error)
    );
  });

  it('reverses the commission on charge.refunded although the charge has no service metadata', async () => {
    mockStripe.invoicePayments.list.mockResolvedValue({
      data: [{ invoice: 'in_1' }],
    });

    await service.processWebhook({
      type: 'charge.refunded',
      data: {
        object: {
          id: 'ch_1',
          payment_intent: 'pi_1',
          amount: 2900,
          amount_refunded: 1450,
          metadata: {},
        },
      },
    } as any);

    expect(mockStripe.invoicePayments.list).toHaveBeenCalledWith({
      payment: { type: 'payment_intent', payment_intent: 'pi_1' },
      limit: 1,
    });
    expect(affiliateService.reverseCommission).toHaveBeenCalledWith({
      invoiceId: 'in_1',
      reversedCents: 1450,
      chargedCents: 2900,
    });
  });

  it('uses the invoice that older API versions put on the charge', async () => {
    await service.processWebhook({
      type: 'charge.refunded',
      data: {
        object: {
          id: 'ch_1',
          invoice: 'in_old',
          amount: 1000,
          amount_refunded: 1000,
        },
      },
    } as any);

    expect(mockStripe.invoicePayments.list).not.toHaveBeenCalled();
    expect(affiliateService.reverseCommission).toHaveBeenCalledWith({
      invoiceId: 'in_old',
      reversedCents: 1000,
      chargedCents: 1000,
    });
  });

  it('ignores refunds of charges that belong to no invoice', async () => {
    mockStripe.invoicePayments.list.mockResolvedValue({ data: [] });

    await expect(
      service.processWebhook({
        type: 'charge.refunded',
        data: {
          object: {
            id: 'ch_1',
            payment_intent: 'pi_1',
            amount: 1000,
            amount_refunded: 1000,
          },
        },
      } as any)
    ).resolves.toEqual({ ok: true });
    expect(affiliateService.reverseCommission).not.toHaveBeenCalled();
  });

  it('reverses the disputed share on charge.dispute.created', async () => {
    mockStripe.charges.retrieve.mockResolvedValue({
      id: 'ch_1',
      payment_intent: 'pi_1',
      amount: 2900,
    });
    mockStripe.invoicePayments.list.mockResolvedValue({
      data: [{ invoice: { id: 'in_1' } }],
    });

    await service.processWebhook({
      type: 'charge.dispute.created',
      data: { object: { id: 'dp_1', charge: 'ch_1', amount: 2900 } },
    } as any);

    expect(mockStripe.charges.retrieve).toHaveBeenCalledWith('ch_1');
    expect(affiliateService.reverseCommission).toHaveBeenCalledWith({
      invoiceId: 'in_1',
      reversedCents: 2900,
      chargedCents: 2900,
    });
  });

  it('does not fail the webhook when a refund cannot be processed', async () => {
    mockStripe.invoicePayments.list.mockRejectedValue(new Error('stripe'));

    await expect(
      service.processWebhook({
        type: 'charge.refunded',
        data: {
          object: {
            id: 'ch_1',
            payment_intent: 'pi_1',
            amount: 1,
            amount_refunded: 1,
          },
        },
      } as any)
    ).resolves.toEqual({ ok: true });
  });

  it('still ignores other events that carry no gitroom metadata', async () => {
    await service.processWebhook({
      type: 'customer.subscription.updated',
      data: { object: { id: 'sub_1', metadata: {} } },
    } as any);
    await service.processWebhook({
      type: 'charge.succeeded',
      data: { object: { id: 'ch_1', metadata: {} } },
    } as any);

    expect(affiliateService.recordInvoicePayment).not.toHaveBeenCalled();
    expect(affiliateService.reverseCommission).not.toHaveBeenCalled();
    expect(mockStripe.invoicePayments.list).not.toHaveBeenCalled();
  });
});

describe('StripeService cardless trial', () => {
  const subscriptionService = {
    createOrUpdateSubscription: jest.fn(),
    deleteSubscription: jest.fn(),
  };
  const organizationService = {
    getOrgById: jest.fn(),
    getOrgByCustomerId: jest.fn(),
  };
  const userService = {
    getUserById: jest.fn().mockResolvedValue({ email: 'a@b.com' }),
  };
  const trackService = { track: jest.fn() };
  const notificationService = {
    inAppNotification: jest.fn(),
    sendEmailsToOrgAdmins: jest.fn(),
  };
  const service = new StripeService(
    subscriptionService as any,
    organizationService as any,
    userService as any,
    trackService as any,
    {} as any,
    notificationService as any
  );

  const cardless = {
    trial_settings: { end_behavior: { missing_payment_method: 'cancel' } },
  };
  // subscriptions.retrieve returns the subscription of the latest event
  let latest: any;
  const subscriptionEvent = (type: string, object: any) => {
    latest = {
      id: 'sub_1',
      customer: 'cus_1',
      cancel_at: null,
      metadata: {
        service: 'gitroom',
        billing: 'STANDARD',
        period: 'MONTHLY',
        uniqueId: 'u1',
      },
      ...object,
    };
    return { type, data: { object: latest } } as any;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    mockStripe.subscriptions.list.mockResolvedValue({ data: [] });
    mockStripe.paymentMethods.list.mockResolvedValue({ data: [] });
    mockStripe.promotionCodes.list.mockResolvedValue({ data: [] });
    mockStripe.subscriptions.retrieve.mockImplementation(async () => latest);
    mockStripe.customers.retrieve.mockResolvedValue({
      invoice_settings: { default_payment_method: null },
    });
    organizationService.getOrgByCustomerId.mockResolvedValue({
      id: 'org_1',
      allowTrial: true,
    });
  });

  it('starts the trial without a card and cancels it when no card was added', async () => {
    organizationService.getOrgById.mockResolvedValue({
      id: 'org_1',
      paymentId: 'cus_1',
    });
    mockStripe.prices.list.mockResolvedValueOnce({
      data: [{ id: 'price_team_month', unit_amount: 2900 }],
    });

    const result = await service.startTrial('cookie', 'org_1', 'user_1', {
      billing: 'TEAM',
      period: 'MONTHLY',
    } as any);

    expect(result).toEqual({ id: expect.any(String) });
    expect(mockStripe.subscriptions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        customer: 'cus_1',
        items: [{ price: 'price_team_month', quantity: 1 }],
        trial_period_days: 7,
        trial_settings: {
          end_behavior: { missing_payment_method: 'cancel' },
        },
        metadata: expect.objectContaining({
          service: 'gitroom',
          billing: 'TEAM',
          period: 'MONTHLY',
          uniqueId: result.id,
          ud: 'cookie',
        }),
      })
    );
  });

  it('does not start a second subscription', async () => {
    organizationService.getOrgById.mockResolvedValue({
      id: 'org_1',
      paymentId: 'cus_1',
    });
    mockStripe.subscriptions.list.mockResolvedValue({
      data: [{ id: 'sub_live', status: 'trialing' }],
    });

    expect(
      await service.startTrial('cookie', 'org_1', 'user_1', {
        billing: 'TEAM',
        period: 'MONTHLY',
      } as any)
    ).toEqual({ subscribed: true });
    expect(mockStripe.subscriptions.create).not.toHaveBeenCalled();
  });

  it('records a trial that has no card', async () => {
    await service.processWebhook(
      subscriptionEvent('customer.subscription.created', {
        status: 'trialing',
        trial_end: 1793664000,
        ...cardless,
      })
    );

    expect(notificationService.inAppNotification).toHaveBeenCalledWith(
      'org_1',
      'Your free trial has started',
      expect.stringContaining('no credit card needed')
    );

    expect(subscriptionService.createOrUpdateSubscription).toHaveBeenCalledWith(
      'stripe',
      true,
      'u1',
      'cus_1',
      expect.any(Number),
      'STANDARD',
      'MONTHLY',
      null
    );
  });

  it.each([
    ['without the pixel cookies (no analytics consent)', {}, false],
    ['with the pixel cookies', { fbc: 'fb.1.1', fbp: 'fb.1.2' }, true],
  ])('sends the StartTrial pixel event only %s', async (_, cookies, sent) => {
    userService.getUserById.mockResolvedValue({ email: 'a@b.com' });
    trackService.track.mockResolvedValue(undefined);
    const event = subscriptionEvent('customer.subscription.created', {
      status: 'trialing',
      trial_end: 1793664000,
      ...cardless,
    });
    event.data.object.metadata = {
      ...event.data.object.metadata,
      userId: 'user_1',
      ...cookies,
    };
    await service.processWebhook(event);
    await new Promise((resolve) => setImmediate(resolve));

    expect(trackService.track).toHaveBeenCalledTimes(sent ? 1 : 0);
  });

  it('still rejects a card trial that has no card', async () => {
    await service.processWebhook(
      subscriptionEvent('customer.subscription.created', {
        status: 'trialing',
      })
    );

    expect(
      subscriptionService.createOrUpdateSubscription
    ).not.toHaveBeenCalled();
  });

  it('reminds the workspace to add a card before the trial ends', async () => {
    await service.processWebhook(
      subscriptionEvent('customer.subscription.trial_will_end', {
        status: 'trialing',
        trial_end: 1793664000,
        ...cardless,
      })
    );

    expect(notificationService.inAppNotification).toHaveBeenCalledWith(
      'org_1',
      'Your free trial ends soon',
      expect.stringContaining('Add a card')
    );
  });

  it('emails the reminder only to the workspace admins', async () => {
    await service.processWebhook(
      subscriptionEvent('customer.subscription.trial_will_end', {
        status: 'trialing',
        trial_end: 1793664000,
        ...cardless,
      })
    );

    expect(notificationService.inAppNotification).toHaveBeenCalledWith(
      'org_1',
      'Your free trial ends soon',
      expect.any(String)
    );
    expect(notificationService.sendEmailsToOrgAdmins).toHaveBeenCalledWith(
      'org_1',
      'Your free trial ends soon',
      expect.stringContaining('Add a card')
    );
  });

  it('adds what a card keeps and the plan prices to the reminder email only', async () => {
    await service.processWebhook(
      subscriptionEvent('customer.subscription.trial_will_end', {
        status: 'trialing',
        trial_end: 1793664000,
        ...cardless,
      })
    );

    const [, , email] = notificationService.sendEmailsToOrgAdmins.mock.calls[0];
    expect(email).toContain('What a card keeps going');
    expect(email).toContain('<strong>Starter</strong> at $19 a month');
    const [, , inApp] = notificationService.inAppNotification.mock.calls[0];
    expect(inApp).not.toContain('What a card keeps going');
  });

  it('drops the list price from the reminder when a discount applies', async () => {
    await service.processWebhook(
      subscriptionEvent('customer.subscription.trial_will_end', {
        status: 'trialing',
        trial_end: 1793664000,
        ...cardless,
        discounts: ['di_1'],
      })
    );

    const [, , email] = notificationService.sendEmailsToOrgAdmins.mock.calls[0];
    expect(email).not.toContain('at $19 a month');
    expect(email).toContain('plan has a discount');
  });

  describe('auto-apply promotion', () => {
    const autoApply = {
      id: 'promo_1',
      code: 'LAUNCH',
      metadata: {},
      promotion: {
        coupon: { id: 'coupon_1', metadata: { autoapply: 'true' } },
      },
      expires_at: null,
      max_redemptions: null,
      times_redeemed: 0,
    };
    const monthly = (interval: string) => ({
      items: { data: [{ price: { recurring: { interval } } }] },
    });

    beforeEach(() => {
      mockStripe.promotionCodes.list.mockResolvedValue({ data: [autoApply] });
    });

    it('is added to a monthly trial when it is about to convert', async () => {
      await service.processWebhook(
        subscriptionEvent('customer.subscription.trial_will_end', {
          status: 'trialing',
          trial_end: 1793664000,
          discounts: [],
          ...monthly('month'),
          ...cardless,
        })
      );

      expect(mockStripe.subscriptions.update).toHaveBeenCalledWith('sub_1', {
        discounts: [{ promotion_code: 'promo_1' }],
      });
    });

    it('is not added again by a late retry after the trial converted', async () => {
      const event = subscriptionEvent('customer.subscription.trial_will_end', {
        status: 'trialing',
        trial_end: 1793664000,
        discounts: [],
        ...monthly('month'),
        ...cardless,
      });
      mockStripe.subscriptions.retrieve.mockResolvedValue({
        ...latest,
        status: 'active',
        discounts: ['di_1'],
      });

      await service.processWebhook(event);

      expect(mockStripe.subscriptions.update).not.toHaveBeenCalled();
    });

    it('is not added to a yearly trial', async () => {
      await service.processWebhook(
        subscriptionEvent('customer.subscription.trial_will_end', {
          status: 'trialing',
          trial_end: 1793664000,
          discounts: [],
          ...monthly('year'),
          ...cardless,
        })
      );

      expect(mockStripe.subscriptions.update).not.toHaveBeenCalled();
    });

    it('is not stacked on a trial that already has a discount', async () => {
      await service.processWebhook(
        subscriptionEvent('customer.subscription.trial_will_end', {
          status: 'trialing',
          trial_end: 1793664000,
          discounts: ['di_1'],
          ...monthly('month'),
          ...cardless,
        })
      );

      expect(mockStripe.subscriptions.update).not.toHaveBeenCalled();
    });

    it('still sends the reminder when the discount cannot be added', async () => {
      jest.spyOn(console, 'error').mockImplementation(() => undefined);
      mockStripe.subscriptions.update.mockRejectedValueOnce(
        new Error('restricted')
      );

      await service.processWebhook(
        subscriptionEvent('customer.subscription.trial_will_end', {
          status: 'trialing',
          trial_end: 1793664000,
          discounts: [],
          ...monthly('month'),
          ...cardless,
        })
      );

      expect(notificationService.sendEmailsToOrgAdmins).toHaveBeenCalled();
    });

    it('is added before a trial is ended early', async () => {
      mockStripe.customers.retrieve.mockResolvedValue({
        invoice_settings: { default_payment_method: 'pm_1' },
      });
      mockStripe.subscriptions.list.mockResolvedValue({
        data: [
          {
            id: 'sub_1',
            status: 'trialing',
            customer: 'cus_1',
            discounts: [],
            ...monthly('month'),
            ...cardless,
          },
        ],
      });
      mockStripe.subscriptions.retrieve.mockResolvedValue({
        latest_invoice: null,
      });

      await service.finishTrial({ paymentId: 'cus_1' } as any);

      expect(mockStripe.subscriptions.update.mock.calls[0]).toEqual([
        'sub_1',
        { discounts: [{ promotion_code: 'promo_1' }] },
      ]);
      expect(mockStripe.subscriptions.update.mock.calls[1]).toEqual([
        'sub_1',
        { trial_end: 'now' },
      ]);
    });

    it('is dropped when switching to yearly, keeping other discounts', async () => {
      const subscriptionService2 = {
        getSubscription: jest.fn().mockResolvedValue({ id: 'local' }),
      };
      const switching = new StripeService(
        subscriptionService2 as any,
        {
          getOrgById: jest
            .fn()
            .mockResolvedValue({ id: 'org_1', paymentId: 'cus_1' }),
        } as any,
        userService as any,
        trackService as any,
        {} as any,
        notificationService as any
      );
      mockStripe.prices.list.mockResolvedValueOnce({
        data: [{ id: 'price_team_year', unit_amount: 27600 }],
      });
      mockStripe.subscriptions.list.mockResolvedValue({
        data: [
          {
            id: 'sub_1',
            status: 'active',
            items: { data: [{ id: 'si_1' }] },
          },
        ],
      });
      mockStripe.subscriptions.retrieve.mockImplementation(
        async (id: string, params: any) =>
          params?.expand?.includes('discounts.promotion_code.promotion.coupon')
            ? {
                discounts: [
                  { id: 'di_auto', promotion_code: autoApply },
                  {
                    id: 'di_other',
                    promotion_code: {
                      ...autoApply,
                      id: 'promo_2',
                      metadata: {},
                      promotion: { coupon: { id: 'coupon_2', metadata: {} } },
                    },
                  },
                ],
              }
            : { latest_invoice: null }
      );

      await switching.subscribe(
        'cookie',
        'org_1',
        'user_1',
        {
          billing: 'TEAM',
          period: 'YEARLY',
        } as any,
        false
      );

      expect(mockStripe.subscriptions.update).toHaveBeenCalledWith(
        'sub_1',
        expect.objectContaining({ discounts: [{ discount: 'di_other' }] })
      );
    });
  });

  it('tells a trial with a card when it will be charged, not to add a card', async () => {
    mockStripe.customers.retrieve.mockResolvedValue({
      invoice_settings: { default_payment_method: 'pm_1' },
    });

    await service.processWebhook(
      subscriptionEvent('customer.subscription.trial_will_end', {
        status: 'trialing',
        trial_end: 1793664000,
        ...cardless,
      })
    );

    const [, subject, email] =
      notificationService.sendEmailsToOrgAdmins.mock.calls[0];
    expect(subject).toBe('Your free trial ends soon');
    expect(email).toContain('the card on file will then be charged');
    expect(email).toContain('Starter');
    expect(email).not.toContain('What a card keeps going');
    expect(notificationService.inAppNotification).toHaveBeenCalledTimes(1);
  });

  it('does not tell a trial with a card that is set to cancel it will be charged', async () => {
    mockStripe.customers.retrieve.mockResolvedValue({
      invoice_settings: { default_payment_method: 'pm_1' },
    });

    await service.processWebhook(
      subscriptionEvent('customer.subscription.trial_will_end', {
        status: 'trialing',
        trial_end: 1793664000,
        cancel_at_period_end: true,
        ...cardless,
      })
    );

    expect(notificationService.sendEmailsToOrgAdmins).not.toHaveBeenCalled();
  });

  it('does not remind a trial that is set to cancel', async () => {
    await service.processWebhook(
      subscriptionEvent('customer.subscription.trial_will_end', {
        status: 'trialing',
        trial_end: 1793664000,
        cancel_at_period_end: true,
        ...cardless,
      })
    );

    expect(notificationService.inAppNotification).not.toHaveBeenCalled();
    expect(notificationService.sendEmailsToOrgAdmins).not.toHaveBeenCalled();
  });

  it('never fails the webhook when the reminder cannot be sent', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    notificationService.inAppNotification.mockRejectedValueOnce(
      new Error('email down')
    );

    expect(
      await service.processWebhook(
        subscriptionEvent('customer.subscription.trial_will_end', {
          status: 'trialing',
          trial_end: 1793664000,
          ...cardless,
        })
      )
    ).toEqual({ ok: true });
  });

  it('moves the workspace to FREE and tells it when the trial ended without a card', async () => {
    await service.processWebhook(
      subscriptionEvent('customer.subscription.deleted', {
        status: 'canceled',
        trial_end: 1793664000,
        ended_at: 1793664000,
        ...cardless,
      })
    );

    expect(subscriptionService.deleteSubscription).toHaveBeenCalledWith(
      'cus_1',
      'stripe'
    );
    expect(notificationService.inAppNotification).toHaveBeenCalledWith(
      'org_1',
      'Your free trial has ended',
      expect.any(String)
    );
  });

  it('does not send the trial ended notice for a subscription canceled before the trial ended', async () => {
    await service.processWebhook(
      subscriptionEvent('customer.subscription.deleted', {
        status: 'canceled',
        trial_end: 1793664000,
        ended_at: 1793000000,
        ...cardless,
      })
    );

    expect(subscriptionService.deleteSubscription).toHaveBeenCalled();
    expect(notificationService.inAppNotification).not.toHaveBeenCalled();
    expect(notificationService.sendEmailsToOrgAdmins).not.toHaveBeenCalled();
  });

  it('does not send the trial ended notice when a converted subscription is canceled later', async () => {
    await service.processWebhook(
      subscriptionEvent('customer.subscription.deleted', {
        status: 'canceled',
        trial_end: 1793664000,
        ended_at: 1793664000 + 90 * 86400,
        ...cardless,
      })
    );

    expect(subscriptionService.deleteSubscription).toHaveBeenCalled();
    expect(notificationService.inAppNotification).not.toHaveBeenCalled();
    expect(notificationService.sendEmailsToOrgAdmins).not.toHaveBeenCalled();
  });

  it('does not run the card check on a paid subscription', async () => {
    await service.processWebhook(
      subscriptionEvent('customer.subscription.updated', { status: 'active' })
    );

    expect(mockStripe.paymentMethods.list).not.toHaveBeenCalled();
    expect(subscriptionService.createOrUpdateSubscription).toHaveBeenCalled();
  });

  it('does not end a trial early before a card was added', async () => {
    mockStripe.subscriptions.list.mockResolvedValue({
      data: [
        { id: 'sub_1', status: 'trialing', customer: 'cus_1', ...cardless },
      ],
    });

    await expect(
      service.finishTrial({ paymentId: 'cus_1' } as any)
    ).rejects.toThrow();
    expect(mockStripe.subscriptions.update).not.toHaveBeenCalled();
  });

  it('asks for a card while the trial has none', async () => {
    organizationService.getOrgById.mockResolvedValue({ paymentId: 'cus_1' });
    mockStripe.subscriptions.list.mockResolvedValue({
      data: [
        {
          id: 'sub_1',
          status: 'trialing',
          customer: 'cus_1',
          trial_end: 1793664000,
          ...cardless,
        },
      ],
    });

    expect(await service.getRenewalDate('org_1')).toEqual({
      renewsAt: 1793664000,
      trialing: true,
      needsPaymentMethod: true,
    });
  });
});

describe('isTrialing', () => {
  const organizationService = { getOrgById: jest.fn() };
  const service = new StripeService(
    {} as any,
    organizationService as any,
    {} as any,
    {} as any
  );

  beforeEach(() => {
    jest.resetAllMocks();
    organizationService.getOrgById.mockResolvedValue({
      id: 'org_1',
      paymentId: 'cus_1',
    });
  });

  const live = (...statuses: string[]) =>
    mockStripe.subscriptions.list.mockResolvedValue({
      data: statuses.map((status, i) => ({ id: `sub_${i}`, status })),
    });

  it('is a trial only while Stripe has the subscription trialing', async () => {
    live('trialing');
    expect(await service.isTrialing('org_1')).toBe(true);
  });

  it.each([['past_due'], ['active'], ['unpaid']])(
    'is not a trial when the subscription is %s',
    async (status) => {
      live(status);
      expect(await service.isTrialing('org_1')).toBe(false);
    }
  );

  it('is not a trial without a Stripe customer', async () => {
    organizationService.getOrgById.mockResolvedValue({
      id: 'org_1',
      paymentId: 'user_1',
    });
    expect(await service.isTrialing('org_1')).toBe(false);
    expect(mockStripe.subscriptions.list).not.toHaveBeenCalled();
  });
});

describe('trialEndsSoonDetails', () => {
  it('shows the plan of the trial and every paid plan from the pricing', () => {
    const html = trialEndsSoonDetails(
      'STANDARD',
      'MONTHLY',
      false,
      'https://app.test'
    );
    expect(html).toContain('<strong>Starter</strong> at $19 a month');
    for (const plan of ['Starter', 'Team', 'Pro', 'Ultimate']) {
      expect(html).toContain(plan);
    }
    expect(html).not.toContain('FREE');
    expect(html).toContain('https://app.test/billing');
    expect(html).toContain('publishing stops when the trial ends');
    expect(html).not.toMatch(/postiz|open source/i);
  });

  it('uses the yearly price of a yearly trial', () => {
    expect(trialEndsSoonDetails('PRO', 'YEARLY', false)).toContain(
      '<strong>Pro</strong> at $372 a year'
    );
  });

  it('says a discount applies instead of the list price', () => {
    const html = trialEndsSoonDetails('STANDARD', 'MONTHLY', true);
    expect(html).not.toContain('at $19 a month');
    expect(html).toContain('<strong>Starter</strong> plan has a discount');
  });

  it('leaves out the plan line when the plan is unknown', () => {
    const html = trialEndsSoonDetails(undefined, undefined, false);
    expect(html).not.toContain('Your plan is');
    expect(html).toContain('What a card keeps going');
  });
});

describe('extra channels', () => {
  const extraItem = (quantity: number, interval = 'month') => ({
    id: 'si_extra',
    quantity,
    price: {
      id: `price_extra_${interval}`,
      lookup_key: `postdelegate_extra_channel_${interval}`,
      recurring: { interval },
    },
  });
  const planItem = (interval = 'month') => ({
    id: 'si_plan',
    quantity: 1,
    price: {
      id: `price_ultimate_${interval}`,
      lookup_key: `postdelegate_ultimate_${interval}`,
      recurring: { interval },
    },
  });
  const stripeSubscription = (over: Record<string, any> = {}) => ({
    id: 'sub_1',
    status: 'active',
    customer: 'cus_1',
    cancel_at: null,
    latest_invoice: { id: 'in_last' },
    metadata: {
      service: 'gitroom',
      billing: 'ULTIMATE',
      period: 'MONTHLY',
      uniqueId: 'u1',
    },
    items: { data: [planItem()] },
    ...over,
  });

  const subscriptionService = {
    createOrUpdateSubscription: jest.fn(),
    deleteSubscription: jest.fn(),
    getSubscription: jest.fn(),
    getSubscriptionByOrganizationId: jest.fn(),
    getActiveChannelsCount: jest.fn(),
  };
  const organizationService = {
    getOrgById: jest.fn(),
    getOrgByCustomerId: jest.fn(),
  };
  const service = new StripeService(
    subscriptionService as any,
    organizationService as any,
    {} as any,
    {} as any
  );

  beforeEach(() => {
    jest.resetAllMocks();
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    organizationService.getOrgById.mockResolvedValue({
      id: 'org_1',
      paymentId: 'cus_1',
    });
    organizationService.getOrgByCustomerId.mockResolvedValue({
      allowTrial: false,
    });
    subscriptionService.getSubscriptionByOrganizationId.mockResolvedValue({
      provider: 'stripe',
      subscriptionTier: 'ULTIMATE',
      period: 'MONTHLY',
      isLifetime: false,
    });
    subscriptionService.getSubscription.mockResolvedValue({ id: 'local' });
    subscriptionService.getActiveChannelsCount.mockResolvedValue(80);
    mockStripe.subscriptions.retrieve.mockResolvedValue({
      latest_invoice: null,
    });
  });

  const live = (subscription: any) =>
    mockStripe.subscriptions.list.mockResolvedValue({ data: [subscription] });
  const extraPrice = (interval = 'month', unit_amount = 100) =>
    mockStripe.prices.list.mockResolvedValueOnce({
      data: [
        { id: `price_extra_${interval}`, unit_amount, recurring: { interval } },
      ],
    });

  describe('reading the subscription', () => {
    it('counts the quantity of the extra channel item, 0 without it', () => {
      expect(
        extraChannelsOf(
          stripeSubscription({
            items: { data: [planItem(), extraItem(25)] },
          }) as any
        )
      ).toBe(25);
      expect(extraChannelsOf(stripeSubscription() as any)).toBe(0);
      expect(extraChannelsOf({ items: undefined } as any)).toBe(0);
      expect(extraChannelsOf(undefined)).toBe(0);
    });

    it('finds the plan item wherever the extra channel item is', () => {
      expect(
        planItemOf({ items: { data: [extraItem(3), planItem()] } } as any)?.id
      ).toBe('si_plan');
    });
  });

  describe('resolveExtraChannelPrice', () => {
    it('uses the lookup key of the period and checks the amount', async () => {
      extraPrice('year', 960);

      const price = await resolveExtraChannelPrice(
        mockStripe as any,
        'ULTIMATE',
        'YEARLY'
      );

      expect(price?.id).toBe('price_extra_year');
      expect(mockStripe.prices.list).toHaveBeenCalledWith({
        lookup_keys: ['postdelegate_extra_channel_year'],
        active: true,
      });
    });

    it('never creates a price, a wrong amount or no price means none', async () => {
      extraPrice('month', 200);
      expect(
        await resolveExtraChannelPrice(mockStripe as any, 'ULTIMATE', 'MONTHLY')
      ).toBeNull();

      mockStripe.prices.list.mockResolvedValueOnce({ data: [] });
      expect(
        await resolveExtraChannelPrice(mockStripe as any, 'ULTIMATE', 'MONTHLY')
      ).toBeNull();

      expect(mockStripe.prices.create).not.toHaveBeenCalled();
      expect(mockStripe.products.create).not.toHaveBeenCalled();
    });

    it('has no price on a tier without extra channels', async () => {
      expect(
        await resolveExtraChannelPrice(mockStripe as any, 'PRO', 'MONTHLY')
      ).toBeNull();
      expect(mockStripe.prices.list).not.toHaveBeenCalled();
    });
  });

  describe('webhook sync', () => {
    const updated = (object: any) =>
      ({ type: 'customer.subscription.updated', data: { object } } as any);

    it('stores 100 + the extra channels of an Ultimate subscription', async () => {
      mockStripe.subscriptions.retrieve.mockResolvedValue(
        stripeSubscription({ items: { data: [planItem(), extraItem(25)] } })
      );
      await service.processWebhook(
        updated(
          stripeSubscription({ items: { data: [planItem(), extraItem(25)] } })
        )
      );

      expect(mockStripe.subscriptions.retrieve).toHaveBeenCalledWith('sub_1');

      expect(
        subscriptionService.createOrUpdateSubscription
      ).toHaveBeenCalledWith(
        'stripe',
        false,
        'u1',
        'cus_1',
        125,
        'ULTIMATE',
        'MONTHLY',
        null
      );
    });

    it('counts the extra channels on the subscription as it is now, not a late or replayed event', async () => {
      // the event still shows 25, they were lowered to 5 since
      mockStripe.subscriptions.retrieve.mockResolvedValue(
        stripeSubscription({ items: { data: [planItem(), extraItem(5)] } })
      );
      await service.processWebhook(
        updated(
          stripeSubscription({ items: { data: [planItem(), extraItem(25)] } })
        )
      );

      expect(
        subscriptionService.createOrUpdateSubscription.mock.calls[0][4]
      ).toBe(105);
    });

    it('stores the tier, period, status and cancel date of the re-read subscription', async () => {
      mockStripe.subscriptions.retrieve.mockResolvedValue(
        stripeSubscription({
          status: 'past_due',
          cancel_at: 1900000000,
          metadata: {
            service: 'gitroom',
            billing: 'ULTIMATE',
            period: 'YEARLY',
            uniqueId: 'u1',
          },
          items: { data: [planItem('year'), extraItem(2, 'year')] },
        })
      );
      await service.processWebhook(updated(stripeSubscription()));

      expect(
        subscriptionService.createOrUpdateSubscription
      ).toHaveBeenCalledWith(
        'stripe',
        true,
        'u1',
        'cus_1',
        102,
        'ULTIMATE',
        'YEARLY',
        1900000000
      );
    });

    it('drops the plan when the re-read subscription has ended since the event', async () => {
      mockStripe.subscriptions.retrieve.mockResolvedValue(
        stripeSubscription({ status: 'canceled' })
      );
      mockStripe.subscriptions.list.mockResolvedValue({ data: [] });
      await service.processWebhook(updated(stripeSubscription()));

      expect(
        subscriptionService.createOrUpdateSubscription
      ).not.toHaveBeenCalled();
      expect(subscriptionService.deleteSubscription).toHaveBeenCalledWith(
        'cus_1',
        'stripe'
      );
    });

    it('keeps the event count when the subscription cannot be read, never failing the webhook', async () => {
      jest.spyOn(console, 'error').mockImplementation(() => undefined);
      mockStripe.subscriptions.retrieve.mockRejectedValue(new Error('down'));
      await service.processWebhook(
        updated(
          stripeSubscription({ items: { data: [planItem(), extraItem(25)] } })
        )
      );

      expect(
        subscriptionService.createOrUpdateSubscription.mock.calls[0][4]
      ).toBe(125);
    });

    it('keeps 100 for an Ultimate subscription without the item', async () => {
      await service.processWebhook(updated(stripeSubscription()));

      expect(
        subscriptionService.createOrUpdateSubscription.mock.calls[0][4]
      ).toBe(100);
    });

    it('ignores an extra channel item left on a tier without extra channels', async () => {
      await service.processWebhook(
        updated(
          stripeSubscription({
            metadata: {
              service: 'gitroom',
              billing: 'PRO',
              period: 'MONTHLY',
              uniqueId: 'u1',
            },
            items: { data: [planItem(), extraItem(25)] },
          })
        )
      );

      expect(mockStripe.subscriptions.retrieve).not.toHaveBeenCalled();
      expect(
        subscriptionService.createOrUpdateSubscription.mock.calls[0][4]
      ).toBe(30);
    });
  });

  describe('getExtraChannels', () => {
    it('shows the quantity, the price and the channels in use', async () => {
      live(stripeSubscription({ items: { data: [planItem(), extraItem(7)] } }));
      extraPrice();

      expect(await service.getExtraChannels('org_1')).toEqual({
        available: true,
        trialing: false,
        extraChannels: 7,
        includedChannels: 100,
        activeChannels: 80,
        unitPrice: 1,
        period: 'MONTHLY',
        max: 900,
      });
    });

    it('is not offered before the Stripe price exists', async () => {
      live(stripeSubscription());
      mockStripe.prices.list.mockResolvedValueOnce({ data: [] });

      expect(await service.getExtraChannels('org_1')).toEqual({
        available: false,
      });
    });

    it.each([
      { provider: 'stripe', subscriptionTier: 'PRO', isLifetime: false },
      { provider: 'stripe', subscriptionTier: 'ULTIMATE', isLifetime: true },
      {
        provider: 'revenuecat',
        subscriptionTier: 'ULTIMATE',
        isLifetime: false,
      },
    ])('is not offered for %o', async (current) => {
      subscriptionService.getSubscriptionByOrganizationId.mockResolvedValue({
        ...current,
        period: 'MONTHLY',
      });

      expect(await service.getExtraChannels('org_1')).toEqual({
        available: false,
      });
      expect(mockStripe.subscriptions.list).not.toHaveBeenCalled();
    });
  });

  describe('setExtraChannels', () => {
    it('adds the item with proration, charging before the change applies', async () => {
      live(stripeSubscription());
      extraPrice();
      mockStripe.subscriptions.update.mockResolvedValue(
        stripeSubscription({ items: { data: [planItem(), extraItem(10)] } })
      );

      expect(await service.setExtraChannels('org_1', 10)).toEqual({
        extraChannels: 10,
        requiresAction: false,
      });

      expect(mockStripe.subscriptions.update).toHaveBeenCalledWith(
        'sub_1',
        {
          proration_behavior: 'always_invoice',
          payment_behavior: 'pending_if_incomplete',
          items: [{ price: 'price_extra_month', quantity: 10 }],
        },
        { idempotencyKey: 'extra-channels-sub_1-in_last-0-10' }
      );
      expect(
        subscriptionService.createOrUpdateSubscription
      ).toHaveBeenCalledWith(
        'stripe',
        false,
        'u1',
        'cus_1',
        110,
        'ULTIMATE',
        'MONTHLY',
        null
      );
    });

    it('changes the quantity of the existing item, a decrease is credited', async () => {
      live(
        stripeSubscription({ items: { data: [planItem(), extraItem(30)] } })
      );
      mockStripe.subscriptions.update.mockResolvedValue(
        stripeSubscription({ items: { data: [planItem(), extraItem(20)] } })
      );

      await service.setExtraChannels('org_1', 20);

      expect(mockStripe.prices.list).not.toHaveBeenCalled();
      expect(mockStripe.subscriptions.update).toHaveBeenCalledWith(
        'sub_1',
        {
          proration_behavior: 'always_invoice',
          items: [{ id: 'si_extra', quantity: 20 }],
        },
        { idempotencyKey: 'extra-channels-sub_1-in_last-30-20' }
      );
      expect(
        subscriptionService.createOrUpdateSubscription.mock.calls[0][4]
      ).toBe(120);
    });

    it('removes the item at 0', async () => {
      live(stripeSubscription({ items: { data: [planItem(), extraItem(5)] } }));
      mockStripe.subscriptions.update.mockResolvedValue(stripeSubscription());

      await service.setExtraChannels('org_1', 0);

      expect(mockStripe.subscriptions.update.mock.calls[0][1].items).toEqual([
        { id: 'si_extra', deleted: true },
      ]);
      expect(
        subscriptionService.createOrUpdateSubscription.mock.calls[0][4]
      ).toBe(100);
    });

    it('is idempotent: the same quantity only re-syncs the limit', async () => {
      live(stripeSubscription({ items: { data: [planItem(), extraItem(5)] } }));

      expect(await service.setExtraChannels('org_1', 5)).toEqual({
        extraChannels: 5,
        requiresAction: false,
      });

      expect(mockStripe.subscriptions.update).not.toHaveBeenCalled();
      expect(
        subscriptionService.createOrUpdateSubscription.mock.calls[0][4]
      ).toBe(105);
    });

    it('blocks going below the channels in use', async () => {
      subscriptionService.getActiveChannelsCount.mockResolvedValue(112);
      live(
        stripeSubscription({ items: { data: [planItem(), extraItem(20)] } })
      );

      await expect(service.setExtraChannels('org_1', 10)).rejects.toThrow(
        'You have 112 active channels, so you need at least 12 extra channels. Disconnect or disable 2 channels first, then lower your extra channels.'
      );
      expect(mockStripe.subscriptions.update).not.toHaveBeenCalled();
    });

    it('allows going down to exactly the channels in use', async () => {
      subscriptionService.getActiveChannelsCount.mockResolvedValue(112);
      live(
        stripeSubscription({ items: { data: [planItem(), extraItem(20)] } })
      );
      mockStripe.subscriptions.update.mockResolvedValue(
        stripeSubscription({ items: { data: [planItem(), extraItem(12)] } })
      );

      await service.setExtraChannels('org_1', 12);

      expect(mockStripe.subscriptions.update).toHaveBeenCalled();
    });

    it('is only for Ultimate', async () => {
      subscriptionService.getSubscriptionByOrganizationId.mockResolvedValue({
        provider: 'stripe',
        subscriptionTier: 'PRO',
        period: 'MONTHLY',
        isLifetime: false,
      });

      await expect(service.setExtraChannels('org_1', 5)).rejects.toThrow(
        'Extra channels are only available on the Ultimate plan.'
      );
      expect(mockStripe.subscriptions.update).not.toHaveBeenCalled();
    });

    it('waits for the trial to end', async () => {
      live(stripeSubscription({ status: 'trialing' }));

      await expect(service.setExtraChannels('org_1', 5)).rejects.toThrow(
        'Extra channels can be added once your trial ends'
      );
      expect(mockStripe.subscriptions.update).not.toHaveBeenCalled();
    });

    it('needs an active subscription', async () => {
      live(stripeSubscription({ status: 'past_due' }));

      await expect(service.setExtraChannels('org_1', 5)).rejects.toThrow(
        'No active subscription found.'
      );
    });

    it('is not sold before the Stripe price exists', async () => {
      live(stripeSubscription());
      mockStripe.prices.list.mockResolvedValueOnce({ data: [] });

      await expect(service.setExtraChannels('org_1', 5)).rejects.toThrow(
        'Extra channels are not available right now'
      );
      expect(mockStripe.subscriptions.update).not.toHaveBeenCalled();
    });

    it('leaves the limit to the webhook while 3D Secure is pending', async () => {
      live(stripeSubscription());
      extraPrice();
      mockStripe.subscriptions.update.mockResolvedValue(
        stripeSubscription({ pending_update: { expires_at: 1 } })
      );
      mockStripe.subscriptions.retrieve.mockResolvedValue({
        latest_invoice: { id: 'in_new' },
      });
      mockStripe.invoices.retrieve.mockResolvedValue({
        id: 'in_new',
        status: 'open',
        payments: {
          data: [
            {
              payment: {
                payment_intent: {
                  status: 'requires_action',
                  client_secret: 'pi_secret',
                },
              },
            },
          ],
        },
      });

      expect(await service.setExtraChannels('org_1', 10)).toEqual({
        extraChannels: 0,
        pending: true,
        requiresAction: true,
        clientSecret: 'pi_secret',
      });
      expect(
        subscriptionService.createOrUpdateSubscription
      ).not.toHaveBeenCalled();
    });

    it('finishes a change that still waits for its payment instead of adding another', async () => {
      live(
        stripeSubscription({
          pending_update: {
            expires_at: 1,
            subscription_items: [extraItem(20)],
          },
        })
      );

      expect(await service.setExtraChannels('org_1', 20)).toEqual({
        extraChannels: 0,
        pending: true,
        requiresAction: false,
      });
      expect(mockStripe.subscriptions.update).not.toHaveBeenCalled();
    });

    it('prices the extra channels on the interval the plan is billed on', async () => {
      live(
        stripeSubscription({
          // metadata says monthly, the plan item is yearly
          items: { data: [planItem('year')] },
        })
      );
      extraPrice('year', 960);
      mockStripe.subscriptions.update.mockResolvedValue(
        stripeSubscription({
          items: { data: [planItem('year'), extraItem(4, 'year')] },
        })
      );

      await service.setExtraChannels('org_1', 4);

      expect(mockStripe.prices.list).toHaveBeenCalledWith({
        lookup_keys: ['postdelegate_extra_channel_year'],
        active: true,
      });
      expect(mockStripe.subscriptions.update.mock.calls[0][1].items).toEqual([
        { price: 'price_extra_year', quantity: 4 },
      ]);
    });

    const declinedInvoice = () =>
      mockStripe.invoices.retrieve.mockResolvedValue({
        id: 'in_new',
        status: 'open',
        payments: {
          data: [
            {
              payment: {
                payment_intent: { status: 'requires_payment_method' },
              },
            },
          ],
        },
      });

    it('voids the invoice of a declined card so a retry can run, and says so', async () => {
      live(stripeSubscription());
      extraPrice();
      mockStripe.subscriptions.update.mockResolvedValue(
        stripeSubscription({ pending_update: { expires_at: 1 } })
      );
      mockStripe.subscriptions.retrieve.mockResolvedValue({
        pending_update: { expires_at: 1 },
        latest_invoice: { id: 'in_new', status: 'open' },
      });
      declinedInvoice();

      await expect(service.setExtraChannels('org_1', 10)).rejects.toThrow(
        'We could not charge your card'
      );
      expect(mockStripe.invoices.voidInvoice).toHaveBeenCalledWith('in_new');
      expect(
        subscriptionService.createOrUpdateSubscription
      ).not.toHaveBeenCalled();
    });

    it('retries a declined change with a new key once its invoice is voided', async () => {
      live(
        stripeSubscription({
          pending_update: {
            expires_at: 1,
            subscription_items: [extraItem(10)],
          },
        })
      );
      mockStripe.subscriptions.retrieve
        // getRequiredActionFromSubscription
        .mockResolvedValueOnce({ latest_invoice: { id: 'in_new' } })
        // voidDeclinedInvoice
        .mockResolvedValueOnce({
          pending_update: { expires_at: 1 },
          latest_invoice: { id: 'in_new', status: 'open' },
        })
        // the subscription after the void, the pending update is gone
        .mockResolvedValueOnce(
          stripeSubscription({ latest_invoice: { id: 'in_new' } })
        );
      declinedInvoice();
      extraPrice();
      mockStripe.subscriptions.update.mockResolvedValue(
        stripeSubscription({ items: { data: [planItem(), extraItem(10)] } })
      );

      expect(await service.setExtraChannels('org_1', 10)).toEqual({
        extraChannels: 10,
        requiresAction: false,
      });
      expect(mockStripe.invoices.voidInvoice).toHaveBeenCalledWith('in_new');
      expect(mockStripe.subscriptions.update.mock.calls[0][2]).toEqual({
        idempotencyKey: 'extra-channels-sub_1-in_new-0-10',
      });
    });

    it('does not void an invoice that only waits for 3D Secure for the same quantity', async () => {
      live(
        stripeSubscription({
          pending_update: {
            expires_at: 1,
            subscription_items: [extraItem(10)],
          },
        })
      );
      mockStripe.subscriptions.retrieve.mockResolvedValue({
        latest_invoice: { id: 'in_new' },
      });
      mockStripe.invoices.retrieve.mockResolvedValue({
        id: 'in_new',
        status: 'open',
        payments: {
          data: [
            {
              payment: {
                payment_intent: {
                  status: 'requires_action',
                  client_secret: 'pi_secret',
                },
              },
            },
          ],
        },
      });

      expect(await service.setExtraChannels('org_1', 10)).toEqual(
        expect.objectContaining({ requiresAction: true })
      );
      expect(mockStripe.invoices.voidInvoice).not.toHaveBeenCalled();
      expect(mockStripe.subscriptions.update).not.toHaveBeenCalled();
    });
  });

  describe('a pending 3D Secure step for another quantity', () => {
    const pendingFor = (quantity: number) =>
      stripeSubscription({
        pending_update: {
          expires_at: 1,
          subscription_items: [extraItem(quantity)],
        },
      });
    const waitingFor3ds = () =>
      mockStripe.invoices.retrieve.mockResolvedValue({
        id: 'in_3ds',
        status: 'open',
        payments: {
          data: [
            {
              payment: {
                payment_intent: {
                  status: 'requires_action',
                  client_secret: 'pi_secret',
                },
              },
            },
          ],
        },
      });

    it('voids the old step and starts fresh', async () => {
      live(pendingFor(10));
      mockStripe.subscriptions.retrieve
        // voidPendingInvoice
        .mockResolvedValueOnce({
          pending_update: { expires_at: 1 },
          latest_invoice: { id: 'in_3ds', status: 'open' },
        })
        // after the void
        .mockResolvedValueOnce(
          stripeSubscription({ latest_invoice: { id: 'in_3ds' } })
        );
      waitingFor3ds();
      extraPrice();
      mockStripe.subscriptions.update.mockResolvedValue(
        stripeSubscription({ items: { data: [planItem(), extraItem(4)] } })
      );

      expect(await service.setExtraChannels('org_1', 4)).toEqual({
        extraChannels: 4,
        requiresAction: false,
      });
      expect(mockStripe.invoices.voidInvoice).toHaveBeenCalledWith('in_3ds');
      expect(mockStripe.subscriptions.update.mock.calls[0][1].items).toEqual([
        { price: 'price_extra_month', quantity: 4 },
      ]);
    });

    it('asks to finish the pending payment when it cannot be voided', async () => {
      live(pendingFor(10));
      mockStripe.subscriptions.retrieve.mockResolvedValue({
        pending_update: { expires_at: 1 },
        latest_invoice: { id: 'in_3ds', status: 'open' },
      });
      mockStripe.invoices.retrieve.mockResolvedValue({
        id: 'in_3ds',
        status: 'open',
        payments: {
          data: [{ payment: { payment_intent: { status: 'processing' } } }],
        },
      });

      await expect(service.setExtraChannels('org_1', 4)).rejects.toThrow(
        'Finish the pending payment for 10 extra channels first, then change the number again.'
      );
      expect(mockStripe.invoices.voidInvoice).not.toHaveBeenCalled();
      expect(mockStripe.subscriptions.update).not.toHaveBeenCalled();
    });
  });

  describe('cancel', () => {
    beforeEach(() => {
      subscriptionService['updateCancelAt'] = jest.fn();
      mockStripe.subscriptions.update.mockResolvedValue({
        cancel_at: 1900000000,
      });
    });

    it('cancels at the period end when the open invoice belongs to a pending extra channels update', async () => {
      live(
        stripeSubscription({
          pending_update: { expires_at: 1 },
          latest_invoice: { id: 'in_new', status: 'open' },
        })
      );

      const result = await service.setToCancel('org_1');

      expect(mockStripe.subscriptions.cancel).not.toHaveBeenCalled();
      expect(subscriptionService.deleteSubscription).not.toHaveBeenCalled();
      expect(mockStripe.subscriptions.update).toHaveBeenCalledWith(
        'sub_1',
        expect.objectContaining({ cancel_at_period_end: true })
      );
      expect(result.cancel_at).toEqual(new Date(1900000000 * 1000));
    });

    it('still cancels right away after a failed renewal', async () => {
      live(
        stripeSubscription({
          latest_invoice: { id: 'in_renewal', status: 'open' },
        })
      );

      await service.setToCancel('org_1');

      expect(mockStripe.subscriptions.cancel).toHaveBeenCalledWith('sub_1');
      expect(subscriptionService.deleteSubscription).toHaveBeenCalledWith(
        'cus_1',
        'stripe'
      );
    });
  });

  describe('admin coupons', () => {
    it('finds the plan products from the plan lookup keys', async () => {
      mockStripe.prices.list.mockResolvedValueOnce({
        data: [
          { id: 'p1', product: 'prod_starter' },
          { id: 'p2', product: 'prod_starter' },
          { id: 'p3', product: { id: 'prod_ultimate' } },
        ],
      });

      expect(await planProductIds(mockStripe as any)).toEqual([
        'prod_starter',
        'prod_ultimate',
      ]);
      expect(mockStripe.prices.list.mock.calls[0][0].lookup_keys).toEqual([
        'postdelegate_starter_month',
        'postdelegate_starter_year',
        'postdelegate_team_month',
        'postdelegate_team_year',
        'postdelegate_pro_month',
        'postdelegate_pro_year',
        'postdelegate_ultimate_month',
        'postdelegate_ultimate_year',
      ]);
    });

    it('limits an admin coupon to the plan products, so extra channels keep their price', async () => {
      live(
        stripeSubscription({
          discounts: [],
          items: {
            data: [
              {
                ...planItem(),
                price: { ...planItem().price, product: 'prod_legacy' },
              },
            ],
          },
        })
      );
      mockStripe.invoices.createPreview.mockResolvedValue({ total: 7900 });
      mockStripe.prices.list.mockResolvedValueOnce({
        data: [
          { id: 'p1', product: 'prod_pro' },
          { id: 'p2', product: 'prod_ultimate' },
        ],
      });
      mockStripe.coupons.create.mockResolvedValue({ id: 'coupon_1' });

      expect(
        await service.applyCoupon('org_1', {
          type: 'percentage',
          value: 50,
          months: 3,
        })
      ).toEqual({ applied: true });
      expect(mockStripe.coupons.create).toHaveBeenCalledWith(
        expect.objectContaining({
          percent_off: 50,
          applies_to: {
            products: ['prod_pro', 'prod_ultimate', 'prod_legacy'],
          },
        })
      );
    });
  });

  describe('plan changes', () => {
    const subscribe = (billing: string, period: string) =>
      service.subscribe(
        'cookie',
        'org_1',
        'user_1',
        { billing, period } as any,
        false
      );

    it('drops the extra channels when moving away from Ultimate', async () => {
      live(
        stripeSubscription({ items: { data: [extraItem(12), planItem()] } })
      );
      mockStripe.prices.list.mockResolvedValueOnce({
        data: [{ id: 'price_pro_month', unit_amount: 3900 }],
      });

      await subscribe('PRO', 'MONTHLY');

      expect(mockStripe.subscriptions.update.mock.calls[0][1]).toEqual(
        expect.objectContaining({
          proration_behavior: 'always_invoice',
          items: [
            { id: 'si_plan', price: 'price_pro_month', quantity: 1 },
            { id: 'si_extra', deleted: true },
          ],
        })
      );
    });

    it('moves the extra channels to the yearly price with the plan', async () => {
      live(
        stripeSubscription({ items: { data: [planItem(), extraItem(12)] } })
      );
      mockStripe.prices.list
        .mockResolvedValueOnce({
          data: [{ id: 'price_ultimate_year', unit_amount: 75600 }],
        })
        .mockResolvedValueOnce({
          data: [
            {
              id: 'price_extra_year',
              unit_amount: 960,
              recurring: { interval: 'year' },
            },
          ],
        });
      mockStripe.subscriptions.retrieve.mockResolvedValue({
        discounts: [],
        latest_invoice: null,
      });

      await subscribe('ULTIMATE', 'YEARLY');

      expect(mockStripe.subscriptions.update.mock.calls[0][1].items).toEqual([
        { id: 'si_plan', price: 'price_ultimate_year', quantity: 1 },
        { id: 'si_extra', price: 'price_extra_year', quantity: 12 },
      ]);
    });

    it('blocks a period change when the extra channel price of that period is missing', async () => {
      live(
        stripeSubscription({ items: { data: [planItem(), extraItem(12)] } })
      );
      mockStripe.prices.list
        .mockResolvedValueOnce({
          data: [{ id: 'price_ultimate_year', unit_amount: 75600 }],
        })
        .mockResolvedValueOnce({ data: [] });

      expect(await subscribe('ULTIMATE', 'YEARLY')).toEqual({
        error:
          'Your extra channels cannot move to this billing period right now. Remove them first, or contact support.',
      });
      expect(mockStripe.subscriptions.update).not.toHaveBeenCalled();
    });

    describe('during a trial', () => {
      const cardless = {
        trial_settings: { end_behavior: { missing_payment_method: 'cancel' } },
      };
      const trial = (billing: string, over: Record<string, any> = {}) =>
        stripeSubscription({
          status: 'trialing',
          trial_end: 1793664000,
          metadata: {
            service: 'gitroom',
            billing,
            period: 'MONTHLY',
            uniqueId: 'u1',
          },
          ...over,
        });
      const noCard = () =>
        mockStripe.customers.retrieve.mockResolvedValue({
          invoice_settings: { default_payment_method: null },
        });
      const ultimatePrice = () =>
        mockStripe.prices.list.mockResolvedValueOnce({
          data: [{ id: 'price_ultimate_month', unit_amount: 7900 }],
        });

      it('asks a trial without a card for one before a bigger plan', async () => {
        live(trial('STANDARD', cardless));
        noCard();
        ultimatePrice();

        expect(await subscribe('ULTIMATE', 'MONTHLY')).toEqual({
          needsPaymentMethod: true,
        });
        expect(mockStripe.subscriptions.update).not.toHaveBeenCalled();
      });

      it('moves a trial with a card to the bigger plan, keeping its end date', async () => {
        live(trial('STANDARD', cardless));
        mockStripe.customers.retrieve.mockResolvedValue({
          invoice_settings: { default_payment_method: 'pm_1' },
        });
        ultimatePrice();

        await subscribe('ULTIMATE', 'MONTHLY');

        const update = mockStripe.subscriptions.update.mock.calls[0][1];
        expect(update.items).toEqual([
          { id: 'si_plan', price: 'price_ultimate_month', quantity: 1 },
        ]);
        // the trial is neither ended nor extended, the first charge is the
        // new plan's price on the same day
        expect(update.trial_end).toBeUndefined();
        expect(update.trial_settings).toBeUndefined();
      });

      it('lets a trial without a card move to a smaller plan', async () => {
        live(trial('ULTIMATE', cardless));
        noCard();
        mockStripe.prices.list.mockResolvedValueOnce({
          data: [{ id: 'price_starter_month', unit_amount: 1900 }],
        });

        await subscribe('STANDARD', 'MONTHLY');

        expect(mockStripe.subscriptions.update.mock.calls[0][1].items).toEqual([
          { id: 'si_plan', price: 'price_starter_month', quantity: 1 },
        ]);
      });

      describe('price preview', () => {
        const prorate = (billing: string, period = 'MONTHLY') =>
          service.prorate('org_1', { billing, period } as any);

        // Stripe answers invoice-upcoming-none: the trial cancels at its end
        it('asks a trial without a card for one before a bigger plan, without an upcoming invoice', async () => {
          live(trial('STANDARD', cardless));
          noCard();
          ultimatePrice();

          expect(await prorate('ULTIMATE')).toEqual({
            price: 0,
            needsPaymentMethod: true,
          });
          expect(mockStripe.invoices.createPreview).not.toHaveBeenCalled();
        });

        it('shows the price at the end of the trial for a smaller plan', async () => {
          live(trial('ULTIMATE', cardless));
          noCard();
          mockStripe.prices.list.mockResolvedValueOnce({
            data: [{ id: 'price_starter_year', unit_amount: 18000 }],
          });

          expect(await prorate('STANDARD', 'YEARLY')).toEqual({
            price: 0,
            trialEndPrice: 180,
          });
          expect(mockStripe.invoices.createPreview).not.toHaveBeenCalled();
        });

        it('previews the invoice of a trial with a card', async () => {
          live(trial('STANDARD', cardless));
          mockStripe.customers.retrieve.mockResolvedValue({
            invoice_settings: { default_payment_method: 'pm_1' },
          });
          ultimatePrice();
          mockStripe.invoices.createPreview.mockResolvedValue({
            amount_due: 0,
          });

          expect(await prorate('ULTIMATE')).toEqual({ price: 0 });
          expect(mockStripe.invoices.createPreview).toHaveBeenCalled();
        });
      });

      it('lets a trial that came with a card from checkout move up', async () => {
        live(trial('STANDARD'));
        noCard();
        ultimatePrice();

        await subscribe('ULTIMATE', 'MONTHLY');

        expect(mockStripe.subscriptions.update).toHaveBeenCalled();
      });
    });

    it('leaves a subscription without extra channels as it was', async () => {
      live(stripeSubscription());
      mockStripe.prices.list.mockResolvedValueOnce({
        data: [{ id: 'price_pro_month', unit_amount: 3900 }],
      });

      await subscribe('PRO', 'MONTHLY');

      expect(mockStripe.subscriptions.update.mock.calls[0][1].items).toEqual([
        { id: 'si_plan', price: 'price_pro_month', quantity: 1 },
      ]);
    });
  });
});
