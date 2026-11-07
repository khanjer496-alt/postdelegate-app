import { BadBody } from '@gitroom/nestjs-libraries/integrations/social.abstract';
import { BlueskyProvider } from '@gitroom/nestjs-libraries/integrations/social/bluesky.provider';

// getAgent decrypts the channel's stored instance details, so a broken
// credential throws there - the production shape of the failure this guards
const provider = new BlueskyProvider();
const integration = {
  id: 'int-1',
  customInstanceDetails: 'not-an-encrypted-blob',
} as any;

const armed = {
  message: 'hello',
  media: [],
  attempting: true,
  confirmed: true,
  prepFailures: 4,
} as any;

describe('BlueskyProvider preparation failures', () => {
  it('tells the customer what to do without quoting our own error', async () => {
    await expect(
      provider.finalizePost('token', armed, integration)
    ).rejects.toThrow(BadBody);

    const err = await provider
      .finalizePost('token', armed, integration)
      .catch((e: any) => e);

    expect(err.message).toEqual(
      'Could not prepare the post for Bluesky, nothing was published, please try again, and reconnect the channel if it keeps failing.'
    );
    // nothing of ours leaked into what the customer reads
    expect(err.message).not.toMatch(/TypeError|argument must be|error:[0-9a-f]{8}|JSON/i);
  });

  it('keeps the underlying error in the failure, for support', async () => {
    const err = await provider
      .finalizePost('token', armed, integration)
      .catch((e: any) => e);

    const detail = JSON.parse(err.details[0].json);
    expect(typeof detail.message).toEqual('string');
    expect(detail.message.length).toBeGreaterThan(0);
  });

  it('keeps polling instead of failing while the attempts are under the limit', async () => {
    const result: any = await provider.finalizePost(
      'token',
      { ...armed, prepFailures: 1 },
      integration
    );

    expect(result.status).toEqual('pending');
    expect(result.pendingData.attempting).toEqual(false);
  });
});
