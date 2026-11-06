import {
  AuthorizationActions,
  Sections,
  SubscriptionException,
} from '@gitroom/backend/services/auth/permissions/permission.exception.class';
import { SubscriptionExceptionFilter } from './subscription.exception';

describe('SubscriptionExceptionFilter', () => {
  const realFrontendUrl = process.env.FRONTEND_URL;
  let json: jest.Mock;
  let status: jest.Mock;
  let host: any;
  let role: 'USER' | 'ADMIN' | 'SUPERADMIN';

  beforeEach(() => {
    process.env.FRONTEND_URL = 'https://app.example.com';
    json = jest.fn();
    status = jest.fn().mockReturnValue({ json });
    role = 'ADMIN';
    host = {
      switchToHttp: () => ({
        getResponse: () => ({ status }),
        getRequest: () => ({ org: { users: [{ role }] } }),
      }),
    };
  });

  afterEach(() => {
    if (realFrontendUrl === undefined) {
      delete process.env.FRONTEND_URL;
    } else {
      process.env.FRONTEND_URL = realFrontendUrl;
    }
  });

  const deny = (section: Sections) =>
    new SubscriptionExceptionFilter().catch(
      new SubscriptionException({
        section,
        action: AuthorizationActions.Create,
      }),
      host
    );

  it('sends a workspace without an OpenAI key to Settings → AI, not billing', () => {
    deny(Sections.AI);

    expect(status).toHaveBeenCalledWith(402);
    expect(json).toHaveBeenCalledWith({
      statusCode: 402,
      message: 'Add your OpenAI key in Settings → AI',
      section: Sections.AI,
      url: 'https://app.example.com/settings?tab=ai',
    });
  });

  it('tells a member without access to the AI settings to ask an admin, with no link', () => {
    role = 'USER';
    deny(Sections.AI);

    expect(status).toHaveBeenCalledWith(402);
    expect(json).toHaveBeenCalledWith({
      statusCode: 402,
      message: 'Ask a workspace admin to add an OpenAI key in Settings → AI.',
      section: Sections.AI,
    });
  });

  it.each(['ADMIN', 'USER'] as const)(
    'still sends a plan limit to billing for a %s',
    (memberRole) => {
      role = memberRole;
      deny(Sections.CHANNEL);

      expect(json).toHaveBeenCalledWith({
        statusCode: 402,
        message:
          'You have reached the maximum number of channels for your subscription. Please upgrade your subscription to add more channels.',
        section: Sections.CHANNEL,
        url: 'https://app.example.com/billing',
      });
    }
  );

  const denyChannel = (extraChannels?: Record<string, unknown>) =>
    new SubscriptionExceptionFilter().catch(
      new SubscriptionException({
        section: Sections.CHANNEL,
        action: AuthorizationActions.Create,
        ...(extraChannels ? { extraChannels: extraChannels as any } : {}),
      }),
      host
    );

  it('offers extra channels instead of an upgrade, priced monthly', () => {
    denyChannel({
      plan: 'Ultimate',
      totalChannels: 125,
      price: 1,
      period: 'MONTHLY',
    });

    expect(json).toHaveBeenCalledWith({
      statusCode: 402,
      message:
        'You have used all 125 channels of your Ultimate plan. Add extra channels for $1 a month each.',
      section: Sections.CHANNEL,
      url: 'https://app.example.com/billing?extraChannels=true',
    });
  });

  it('prices the offer yearly on a yearly plan', () => {
    denyChannel({
      plan: 'Ultimate',
      totalChannels: 100,
      price: 9.6,
      period: 'YEARLY',
    });

    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        message:
          'You have used all 100 channels of your Ultimate plan. Add extra channels for $9.60 a year each.',
      })
    );
  });

  it('keeps the upgrade prompt without an offer', () => {
    denyChannel();

    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://app.example.com/billing' })
    );
  });

  it('still sends a plan limit to billing', () => {
    deny(Sections.POSTS_PER_MONTH);

    expect(status).toHaveBeenCalledWith(402);
    expect(json).toHaveBeenCalledWith({
      statusCode: 402,
      message:
        'You have reached the maximum number of posts for your subscription. Please upgrade your subscription to add more posts.',
      section: Sections.POSTS_PER_MONTH,
      url: 'https://app.example.com/billing',
    });
  });

  it('shows the message written for a network cap and links billing', () => {
    new SubscriptionExceptionFilter().catch(
      new SubscriptionException({
        section: Sections.PROVIDER_POSTS_PER_MONTH,
        action: AuthorizationActions.Create,
        message: "You've used your 30 X posts for this month on the Starter plan.",
      }),
      host
    );

    expect(status).toHaveBeenCalledWith(402);
    expect(json).toHaveBeenCalledWith({
      statusCode: 402,
      message: "You've used your 30 X posts for this month on the Starter plan.",
      section: Sections.PROVIDER_POSTS_PER_MONTH,
      url: 'https://app.example.com/billing',
    });
  });

  it('answers 403 and asks a member to ask an admin for an admin-only action', () => {
    role = 'USER';
    deny(Sections.ADMIN);

    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith({
      statusCode: 403,
      message: 'Only workspace admins can do this. Ask a workspace admin.',
      section: Sections.ADMIN,
    });
  });

  it('puts the reconnect-first wording before the extra channels offer', () => {
    new SubscriptionExceptionFilter().catch(
      new SubscriptionException({
        section: Sections.CHANNEL,
        action: AuthorizationActions.Create,
        message: 'Reconnect or remove a channel first, or upgrade your plan to add more channels.',
        extraChannels: { plan: 'Pro', totalChannels: 10, price: 5, period: 'MONTHLY' },
      }),
      host
    );
    expect(json.mock.calls[0][0].message).toBe(
      'Reconnect or remove a channel first, or upgrade your plan to add more channels.'
    );
  });
});
