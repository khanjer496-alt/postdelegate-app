import 'reflect-metadata';
import dayjs from 'dayjs';
import { YoutubeProvider } from '@gitroom/nestjs-libraries/integrations/social/youtube.provider';

// Only the HTTP calls are replaced: the upload session request is captured so
// the metadata YouTube receives can be checked.
const startUpload = async (settings: Record<string, any>) => {
  const instance = new YoutubeProvider();
  const requests: { url: string; body: any }[] = [];
  (instance as any).youtubeMediaSize = jest.fn(async () => 1024);
  instance.fetch = jest.fn(async (url: string, options: any) => {
    requests.push({ url, body: JSON.parse(options.body) });
    return {
      headers: { get: () => 'https://upload.example/session' },
    } as any;
  }) as any;

  const [response] = await instance.postPending(
    'channel',
    'token',
    [
      {
        id: 'post-1',
        message: 'Description',
        settings: {
          __type: 'youtube',
          title: 'My video',
          type: 'public',
          selfDeclaredMadeForKids: 'no',
          ...settings,
        },
        media: [{ path: 'https://cdn.example/video.mp4' }],
      } as any,
    ],
    {} as any
  );

  expect(response.status).toBe('pending');
  expect(requests).toHaveLength(1);
  return requests[0].body.status;
};

describe('YoutubeProvider upload metadata', () => {
  it('sends the same status as before when the new settings are not set', async () => {
    expect(await startUpload({})).toEqual({
      privacyStatus: 'public',
      selfDeclaredMadeForKids: false,
    });
  });

  it('leaves containsSyntheticMedia out unless it is yes', async () => {
    expect(
      await startUpload({ containsSyntheticMedia: 'no' })
    ).not.toHaveProperty('containsSyntheticMedia');
    expect(await startUpload({ containsSyntheticMedia: 'yes' })).toEqual({
      privacyStatus: 'public',
      selfDeclaredMadeForKids: false,
      containsSyntheticMedia: true,
    });
  });

  it('uploads as private with publishAt when publishing later on YouTube', async () => {
    const publishAt = dayjs().add(2, 'day').startOf('hour');
    expect(
      await startUpload({
        type: 'unlisted',
        publishAt: publishAt.toISOString(),
      })
    ).toEqual({
      privacyStatus: 'private',
      publishAt: publishAt.toISOString(),
      selfDeclaredMadeForKids: false,
    });
  });

  it('publishes now when the publishAt time already passed', async () => {
    expect(
      await startUpload({
        type: 'private',
        publishAt: dayjs().subtract(1, 'hour').toISOString(),
      })
    ).toEqual({
      privacyStatus: 'public',
      selfDeclaredMadeForKids: false,
    });
  });

  it('keeps the type when publishAt is not a real date (drafts skip validation)', async () => {
    for (const publishAt of ['2026-309', '20261105T150000Z', '2026-W45-1']) {
      expect(await startUpload({ type: 'unlisted', publishAt })).toEqual({
        privacyStatus: 'unlisted',
        selfDeclaredMadeForKids: false,
      });
    }
  });
});

describe('YoutubeProvider.checkValidity description', () => {
  const video = [[{ path: 'https://cdn.example/video.mp4' }]];
  const check = (description: string) =>
    new YoutubeProvider().checkValidity(video, {}, [], [description]);

  it('refuses < and >, which YouTube rejects', async () => {
    expect(await check('a <b> c')).toMatch(/cannot contain < or >/);
    expect(await check('1 > 0')).toMatch(/cannot contain < or >/);
  });

  // 5,000 characters fit the old character count, YouTube counts bytes
  it('measures the 5,000 limit in bytes', async () => {
    expect(await check('a'.repeat(5000))).toBe(true);
    expect(await check('é'.repeat(2501))).toMatch(/5000 bytes/);
    expect(await check('🎉'.repeat(1250))).toBe(true);
    expect(await check('🎉'.repeat(1251))).toMatch(/5000 bytes/);
  });

  it('still checks the video, and works without a description', async () => {
    expect(await new YoutubeProvider().checkValidity([[]], {}, [])).toBe(
      'You need one media'
    );
    expect(await new YoutubeProvider().checkValidity(video, {}, [])).toBe(true);
  });
});
