import 'reflect-metadata';

// Only the Google OAuth client is replaced: its transporter records the
// revocation request and answers like Google does.
const request = jest.fn();
jest.mock('googleapis', () => ({
  google: {
    auth: { OAuth2: jest.fn(() => ({ transporter: { request } })) },
    oauth2: jest.fn(),
  },
}));

import { GmbProvider } from '@gitroom/nestjs-libraries/integrations/social/gmb.provider';
import { GmbSettingsDto } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/gmb.settings.dto';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

describe('GmbProvider revokeAuthorization', () => {
  afterEach(() => {
    request.mockReset();
  });

  const revoke = (credentials: { accessToken: string; refreshToken?: string | null }) =>
    new GmbProvider().revokeAuthorization({ ...credentials, internalId: 'accounts/1/locations/2' });

  it('revokes the refresh token at Google with a form body', async () => {
    request.mockResolvedValueOnce({ status: 200 });

    expect(await revoke({ accessToken: 'at', refreshToken: 'rt' })).toEqual({
      status: 'revoked',
    });
    expect(request).toHaveBeenCalledTimes(1);
    const [options] = request.mock.calls[0];
    // the token never goes in the URL
    expect(options).toMatchObject({
      url: 'https://oauth2.googleapis.com/revoke',
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      data: 'token=rt',
      retry: false,
    });
  });

  it('falls back to the access token when there is no refresh token', async () => {
    request.mockResolvedValueOnce({ status: 200 });

    await revoke({ accessToken: 'at', refreshToken: null });
    expect(request.mock.calls[0][0].data).toBe('token=at');
  });

  it('treats a token Google no longer knows as revoked', async () => {
    request.mockRejectedValueOnce({
      response: { status: 400, data: { error: 'invalid_token' } },
    });

    expect(await revoke({ accessToken: 'at', refreshToken: 'rt' })).toEqual({
      status: 'revoked',
    });
  });

  it('reports unknown when Google refuses or cannot be reached', async () => {
    request.mockRejectedValueOnce({ response: { status: 503, data: {} } });
    expect(await revoke({ accessToken: 'at', refreshToken: 'rt' })).toEqual({
      status: 'unknown',
    });

    request.mockRejectedValueOnce(new Error('down'));
    expect(await revoke({ accessToken: 'at', refreshToken: 'rt' })).toEqual({
      status: 'unknown',
    });
  });

  it('reports unknown without calling Google when no token is stored', async () => {
    expect(await revoke({ accessToken: '', refreshToken: null })).toEqual({
      status: 'unknown',
    });
    expect(request).not.toHaveBeenCalled();
  });

  it('shares the grant group of the Google project its client belongs to', () => {
    const realGmb = process.env.GOOGLE_GMB_CLIENT_ID;
    const realYoutube = process.env.YOUTUBE_CLIENT_ID;
    delete process.env.GOOGLE_GMB_CLIENT_ID;
    process.env.YOUTUBE_CLIENT_ID = '123-abc.apps.googleusercontent.com';
    expect(new GmbProvider().authorizationGrantGroup).toBe('google-project:123');
    process.env.GOOGLE_GMB_CLIENT_ID = '456-def.apps.googleusercontent.com';
    expect(new GmbProvider().authorizationGrantGroup).toBe('google-project:456');
    process.env.GOOGLE_GMB_CLIENT_ID = 'not-a-google-client';
    expect(new GmbProvider().authorizationGrantGroup).toBeUndefined();
    if (realGmb === undefined) delete process.env.GOOGLE_GMB_CLIENT_ID;
    else process.env.GOOGLE_GMB_CLIENT_ID = realGmb;
    if (realYoutube === undefined) delete process.env.YOUTUBE_CLIENT_ID;
    else process.env.YOUTUBE_CLIENT_ID = realYoutube;
  });
});

describe('GmbProvider post', () => {
  const LOCATION = 'accounts/1/locations/2';

  // Only the Google HTTP call is replaced, the body is built by the provider.
  const publish = async (settings: any) => {
    const instance = new GmbProvider();
    const fetchMock = jest.fn(async () => ({
      json: async () => ({ name: `${LOCATION}/localPosts/3` }),
    }));
    instance.fetch = fetchMock as any;
    await instance.post(LOCATION, 'at', [
      {
        id: 'post-1',
        message: 'Hello',
        settings: { __type: 'gmb', ...settings },
        media: [],
      } as any,
    ]);
    const [url, init] = fetchMock.mock.calls[0] as any;
    expect(url).toBe(
      `https://mybusiness.googleapis.com/v4/${LOCATION}/localPosts`
    );
    return JSON.parse(init.body);
  };

  it('sends the event block Google requires next to the offer', async () => {
    const body = await publish({
      topicType: 'OFFER',
      eventTitle: '20% off this week',
      eventStartDate: '2026-11-10',
      eventEndDate: '2026-11-16',
      // left over from an event, offers only run on dates
      eventStartTime: '09:00',
      offerCouponCode: 'SAVE20',
    });

    expect(body.topicType).toBe('OFFER');
    expect(body.event).toEqual({
      title: '20% off this week',
      schedule: {
        startDate: { year: 2026, month: 11, day: 10 },
        endDate: { year: 2026, month: 11, day: 16 },
        startTime: { hours: 0, minutes: 0, seconds: 0, nanos: 0 },
        endTime: { hours: 23, minutes: 59, seconds: 0, nanos: 0 },
      },
    });
    expect(body.offer).toEqual({ couponCode: 'SAVE20' });
  });

  it('leaves the event block out of an offer saved without a title', async () => {
    const body = await publish({ topicType: 'OFFER' });

    expect(body.event).toBeUndefined();
  });

  it('keeps the event times for event posts', async () => {
    const body = await publish({
      topicType: 'EVENT',
      eventTitle: 'Open day',
      eventStartDate: '2026-11-10',
      eventEndDate: '2026-11-10',
      eventStartTime: '09:30',
      eventEndTime: '17:00',
    });

    expect(body.event.schedule.startTime).toEqual({
      hours: 9,
      minutes: 30,
      seconds: 0,
      nanos: 0,
    });
    expect(body.event.schedule.endTime.hours).toBe(17);
    expect(body.offer).toBeUndefined();
  });

  it('sends the Call button without a url', async () => {
    const body = await publish({
      callToActionType: 'CALL',
      callToActionUrl: 'https://example.com/left-over',
    });

    expect(body.callToAction).toEqual({ actionType: 'CALL' });
  });

  it('keeps the url of the other buttons', async () => {
    const body = await publish({
      callToActionType: 'LEARN_MORE',
      callToActionUrl: 'https://example.com',
    });

    expect(body.callToAction).toEqual({
      actionType: 'LEARN_MORE',
      url: 'https://example.com',
    });
  });

  it('sends no button for NONE or a button that is missing its url', async () => {
    expect(
      (await publish({ callToActionType: 'NONE' })).callToAction
    ).toBeUndefined();
    expect(
      (await publish({ callToActionType: 'BOOK' })).callToAction
    ).toBeUndefined();
  });
});

describe('GmbProvider checkValidity', () => {
  const check = (settings: any) =>
    new GmbProvider().checkValidity([[]], settings);

  it('asks for a title on offers and events', async () => {
    expect(await check({ topicType: 'OFFER' })).toBe(
      'Offer posts require an offer title'
    );
    expect(await check({ topicType: 'EVENT' })).toBe(
      'Event posts require an event title'
    );
    expect(await check({ topicType: 'OFFER', eventTitle: 'Sale' })).toBe(
      'Offer posts require a start and an end date'
    );
    expect(
      await check({
        topicType: 'OFFER',
        eventTitle: 'Sale',
        eventStartDate: '2026-11-10',
        eventEndDate: '2026-11-16',
      })
    ).toBe(true);
    expect(
      await check({
        topicType: 'OFFER',
        eventTitle: 'Sale',
        eventStartDate: '2026-11-16',
        eventEndDate: '2026-11-10',
      })
    ).toBe('The offer end date must be on or after the start date');
    expect(await check({ topicType: 'STANDARD' })).toBe(true);
  });
});

describe('GmbSettingsDto', () => {
  const errors = async (settings: any) =>
    (await validate(plainToInstance(GmbSettingsDto, settings))).map(
      (e) => e.property
    );

  it('needs no url for NONE and CALL, even when an old value is left', async () => {
    expect(
      await errors({ callToActionType: 'CALL', callToActionUrl: '' })
    ).toEqual([]);
    expect(
      await errors({ callToActionType: 'NONE', callToActionUrl: '' })
    ).toEqual([]);
    expect(await errors({ callToActionType: 'CALL' })).toEqual([]);
  });

  it('still checks the url of the other buttons', async () => {
    expect(
      await errors({ callToActionType: 'LEARN_MORE', callToActionUrl: 'nope' })
    ).toEqual(['callToActionUrl']);
    expect(
      await errors({
        callToActionType: 'LEARN_MORE',
        callToActionUrl: 'https://example.com',
      })
    ).toEqual([]);
  });
});
