// the real services pull in every social provider, the spec only reads route metadata
jest.mock('@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service', () => ({ SubscriptionService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/notifications/notification.service', () => ({ NotificationService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/users/users.service', () => ({ UsersService: class {} }));
jest.mock('@gitroom/nestjs-libraries/services/payment/payment.service', () => ({ PaymentService: class {} }));

import { CHECK_POLICIES_KEY } from '@gitroom/backend/services/auth/permissions/permissions.ability';
import {
  AuthorizationActions,
  Sections,
} from '@gitroom/backend/services/auth/permissions/permission.exception.class';
import { BillingController } from './billing.controller';

const policiesOf = (name: keyof BillingController) =>
  Reflect.getMetadata(CHECK_POLICIES_KEY, BillingController.prototype[name]);

describe('BillingController authorization', () => {
  it.each([
    'embedded',
    'subscribe',
    'sync',
    'modifyPayment',
    'cancel',
    'prorate',
    'finishTrial',
    'applyDiscount',
    'getInvoices',
    'getExtraChannels',
    'setExtraChannels',
  ] as const)('%s requires an org admin', (name) => {
    expect(policiesOf(name)).toEqual([
      [AuthorizationActions.Create, Sections.ADMIN],
    ]);
  });
});

describe('BillingController self-service refunds', () => {
  // the Chatbase refund-and-cancel routes let any org admin refund the last
  // charge, so they are gone; cancelling at period end is the documented flow
  it.each(['chatbaseRefund', 'chatbaseRefundPreview'])(
    '%s is not exposed',
    (name) => {
      expect(
        (BillingController.prototype as unknown as Record<string, unknown>)[
          name
        ]
      ).toBeUndefined();
    }
  );
});

// Someone who wants to buy today should not be forced through seven free days.
// The rule has to be one-way: skipTrial may only ever REMOVE a trial, never
// grant one to an organisation that has already used its own.
describe('allowTrialFor', () => {
  const { allowTrialFor } = require('./billing.controller');

  it('gives the trial when the org is entitled and does not opt out', () => {
    expect(allowTrialFor(true, {})).toBe(true);
    expect(allowTrialFor(true, { skipTrial: false })).toBe(true);
  });

  it('skips the trial when the buyer asks to pay now', () => {
    expect(allowTrialFor(true, { skipTrial: true })).toBe(false);
  });

  // the important direction: a request cannot talk its way into a trial
  it('never grants a trial to an org that is not entitled to one', () => {
    expect(allowTrialFor(false, {})).toBe(false);
    expect(allowTrialFor(false, { skipTrial: false })).toBe(false);
    expect(allowTrialFor(false, { skipTrial: true })).toBe(false);
  });

  // only a real boolean true declines it: the string "false" is truthy in
  // JavaScript, and this codebase has shipped that bug before
  it('treats anything other than a true opt-out as not opting out', () => {
    expect(allowTrialFor(true, { skipTrial: undefined })).toBe(true);
    expect(allowTrialFor(true, {} as any)).toBe(true);
    expect(allowTrialFor(true, { skipTrial: 'false' })).toBe(true);
    expect(allowTrialFor(true, { skipTrial: 'true' })).toBe(true);
    expect(allowTrialFor(true, { skipTrial: 0 })).toBe(true);
  });
});
