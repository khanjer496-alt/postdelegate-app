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
  charges: { retrieve: jest.fn() },
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
  resolveTierPrice,
  StripeService,
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

  it('does not remind when a card was added', async () => {
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

    expect(notificationService.inAppNotification).not.toHaveBeenCalled();
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
