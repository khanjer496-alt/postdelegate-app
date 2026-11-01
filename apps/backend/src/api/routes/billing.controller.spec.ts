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
    'chatbaseRefund',
    'getInvoices',
    'getExtraChannels',
    'setExtraChannels',
  ] as const)('%s requires an org admin', (name) => {
    expect(policiesOf(name)).toEqual([
      [AuthorizationActions.Create, Sections.ADMIN],
    ]);
  });
});
