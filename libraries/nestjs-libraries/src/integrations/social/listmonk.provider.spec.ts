jest.mock('@gitroom/helpers/auth/auth.service', () => ({
  AuthService: {
    fixedDecryption: () =>
      JSON.stringify({ url: 'https://lists.example', username: 'u', password: 'p' }),
  },
}));

import { ListmonkProvider } from '@gitroom/nestjs-libraries/integrations/social/listmonk.provider';

const campaignName = async (subject: string) => {
  const provider = new ListmonkProvider();
  const bodies: any[] = [];
  provider.fetch = jest.fn(async (_: string, init: any) => {
    bodies.push(JSON.parse(init.body));
    return { json: async () => ({ data: { uuid: 'u-1', id: 1 } }) } as any;
  }) as any;
  await provider.post(
    'id',
    'token',
    [{ id: 'p-1', message: '<p>Hi</p>', settings: { subject, preview: '', list: '2' } } as any],
    { customInstanceDetails: 'x' } as any
  );
  return bodies[0].name;
};

describe('ListmonkProvider campaign name', () => {
  it('keeps the slug of a Latin subject', async () => {
    expect(await campaignName('Hello World!')).toBe('hello-world');
  });

  // slugify drops non-Latin letters, Listmonk needs a name
  it('falls back to the subject when the slug is empty', async () => {
    expect(await campaignName('  你好世界  ')).toBe('你好世界');
  });
});
