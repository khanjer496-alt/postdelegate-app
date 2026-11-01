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
});
