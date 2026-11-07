import { getAuth } from '@gitroom/nestjs-libraries/chat/async.storage';

export const checkAuth = (
  inputData: any,
  context: any
) => {
  const auth = getAuth();
  const authInfo = context?.mcp?.extra?.authInfo || auth;
  if (authInfo && context?.requestContext) {
    (context.requestContext as any).set(
      'organization',
      JSON.stringify(authInfo)
    );
    (context.requestContext as any).set('ui', 'false');
  }
};

export const SUBSCRIPTION_ENDED_MESSAGE =
  'Your PostDelegate subscription has ended. Renew it from Billing in PostDelegate to keep using this connection.';
export const PLAN_NEEDED_MESSAGE =
  'Your PostDelegate workspace needs an active plan. Choose one from Billing in PostDelegate to use this connection.';

// The same rule as the public API (PublicAuthMiddleware): with billing on, an
// organization without a subscription can't use MCP. Billing off (self-hosted)
// never blocks. A workspace that has a billing customer had a plan (or a
// trial) that ended, one without never subscribed
export const subscriptionProblem = (
  org?: { subscription?: unknown; paymentId?: string | null } | null
) =>
  !process.env.STRIPE_SECRET_KEY || !org || org.subscription
    ? null
    : org.paymentId
    ? SUBSCRIPTION_ENDED_MESSAGE
    : PLAN_NEEDED_MESSAGE;
