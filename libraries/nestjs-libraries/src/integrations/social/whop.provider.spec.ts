jest.mock('@gitroom/helpers/utils/timer', () => ({ timer: jest.fn(async () => undefined) }));

import { WhopProvider } from '@gitroom/nestjs-libraries/integrations/social/whop.provider';
import { RefreshToken } from '@gitroom/nestjs-libraries/integrations/social.abstract';

const realFetch = global.fetch;
afterEach(() => {
  global.fetch = realFetch;
});

const answer = (status: number, body: unknown) => {
  global.fetch = jest.fn(async () => ({
    status,
    text: async () => JSON.stringify(body),
    json: async () => body,
  })) as any;
};

describe('WhopProvider lists', () => {
  // an empty list used to hide an expired token
  it('surfaces a refused token on the companies', async () => {
    answer(401, { error: 'unauthorized' });
    await expect(new WhopProvider().companies('token', {}, 'id')).rejects.toBeInstanceOf(
      RefreshToken
    );
  });

  it('surfaces a refused token on the forums', async () => {
    answer(401, { error: 'unauthorized' });
    await expect(
      new WhopProvider().experiences('token', { id: 'biz_1' }, 'id')
    ).rejects.toBeInstanceOf(RefreshToken);
  });

  it('lists companies and forums', async () => {
    answer(200, { data: [{ id: 'biz_1', title: 'Acme' }] });
    await expect(new WhopProvider().companies('token', {}, 'id')).resolves.toEqual([
      { id: 'biz_1', name: 'Acme' },
    ]);
    answer(200, { data: [{ id: 'f1', experience: { id: 'exp_1', name: 'Forum' } }] });
    await expect(
      new WhopProvider().experiences('token', { id: 'biz_1' }, 'id')
    ).resolves.toEqual([{ id: 'exp_1', name: 'Forum' }]);
  });
});
