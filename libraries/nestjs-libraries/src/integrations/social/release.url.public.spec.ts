// nostr-tools ships ESM jest can't load, and nothing here signs anything
jest.mock('nostr-tools', () => ({
  getPublicKey: jest.fn(),
  finalizeEvent: jest.fn(),
  Relay: { connect: jest.fn() },
  SimplePool: jest.fn(),
}));

import 'reflect-metadata';
import { SocialProvider } from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import { socialIntegrationList } from '@gitroom/nestjs-libraries/integrations/integration.manager';
import { XProvider } from '@gitroom/nestjs-libraries/integrations/social/x.provider';
import { XOwnKeyProvider } from '@gitroom/nestjs-libraries/integrations/social/x.own.key.provider';
import { InstagramProvider } from '@gitroom/nestjs-libraries/integrations/social/instagram.provider';
import { InstagramStandaloneProvider } from '@gitroom/nestjs-libraries/integrations/social/instagram.standalone.provider';
import { ThreadsProvider } from '@gitroom/nestjs-libraries/integrations/social/threads.provider';
import { FacebookProvider } from '@gitroom/nestjs-libraries/integrations/social/facebook.provider';
import { PinterestProvider } from '@gitroom/nestjs-libraries/integrations/social/pinterest.provider';
import { GmbProvider } from '@gitroom/nestjs-libraries/integrations/social/gmb.provider';
import { TelegramProvider } from '@gitroom/nestjs-libraries/integrations/social/telegram.provider';
import { DevToProvider } from '@gitroom/nestjs-libraries/integrations/social/dev.to.provider';
import { DribbbleProvider } from '@gitroom/nestjs-libraries/integrations/social/dribbble.provider';
import { MoltbookProvider } from '@gitroom/nestjs-libraries/integrations/social/moltbook.provider';
import { FarcasterProvider } from '@gitroom/nestjs-libraries/integrations/social/farcaster.provider';
import { RedditProvider } from '@gitroom/nestjs-libraries/integrations/social/reddit.provider';
import { NostrProvider } from '@gitroom/nestjs-libraries/integrations/social/nostr.provider';
import { TumblrProvider } from '@gitroom/nestjs-libraries/integrations/social/tumblr.provider';
import { MediumProvider } from '@gitroom/nestjs-libraries/integrations/social/medium.provider';
import { HashnodeProvider } from '@gitroom/nestjs-libraries/integrations/social/hashnode.provider';
import { BlueskyProvider } from '@gitroom/nestjs-libraries/integrations/social/bluesky.provider';
import { TiktokProvider } from '@gitroom/nestjs-libraries/integrations/social/tiktok.provider';
import { TiktokBusinessProvider } from '@gitroom/nestjs-libraries/integrations/social/tiktok.business.provider';
import { MeweProvider } from '@gitroom/nestjs-libraries/integrations/social/mewe.provider';
import { SlackProvider } from '@gitroom/nestjs-libraries/integrations/social/slack.provider';
import { DiscordProvider } from '@gitroom/nestjs-libraries/integrations/social/discord.provider';
import { ListmonkProvider } from '@gitroom/nestjs-libraries/integrations/social/listmonk.provider';
import { MastodonProvider } from '@gitroom/nestjs-libraries/integrations/social/mastodon.provider';
import { WordpressProvider } from '@gitroom/nestjs-libraries/integrations/social/wordpress.provider';
import { LemmyProvider } from '@gitroom/nestjs-libraries/integrations/social/lemmy.provider';
import { SkoolProvider } from '@gitroom/nestjs-libraries/integrations/social/skool.provider';
import { LinkedinProvider } from '@gitroom/nestjs-libraries/integrations/social/linkedin.provider';
import { LinkedinPageProvider } from '@gitroom/nestjs-libraries/integrations/social/linkedin.page.provider';
import { VkProvider } from '@gitroom/nestjs-libraries/integrations/social/vk.provider';
import { KickProvider } from '@gitroom/nestjs-libraries/integrations/social/kick.provider';
import { TwitchProvider } from '@gitroom/nestjs-libraries/integrations/social/twitch.provider';
import { WhopProvider } from '@gitroom/nestjs-libraries/integrations/social/whop.provider';
import { YoutubeProvider } from '@gitroom/nestjs-libraries/integrations/social/youtube.provider';

// Every provider that opted in to isPublicReleaseURL, with the release URLs it
// really stores: the public post pages it must accept, and the inbox, admin,
// profile-fallback and self-hosted URLs it must refuse. A refusal here is what
// keeps the stored URL off the shared preview page, which anyone can open.
const opted: {
  name: string;
  provider: SocialProvider;
  accepts: (string | [string, any])[];
  refuses: (string | [string, any])[];
}[] = [
  {
    name: 'x',
    provider: new XProvider(),
    accepts: [
      'https://twitter.com/acme/status/1795000000000000000',
      'https://x.com/acme/status/1795000000000000000',
    ],
    refuses: [
      // the draft-article URL: the owner's own article list
      'https://x.com/i/articles',
      'https://x.com/acme',
      // a Community post is readable by its members only
      [
        'https://x.com/acme/status/1795000000000000000',
        { community: 'https://x.com/i/communities/1493446837214187523' },
      ],
      'http://x.com/acme/status/1795000000000000000',
      'https://x.com.evil.test/acme/status/1',
    ],
  },
  {
    name: 'instagram',
    provider: new InstagramProvider(),
    accepts: [
      'https://www.instagram.com/p/C8sJ1kFq2sX/',
      'https://www.instagram.com/reel/C8sJ1kFq2sX',
      'https://www.instagram.com/tv/C8sJ1kFq2sX/',
    ],
    refuses: [
      // the profile fallback, stored when the platform gave us no media id
      'https://www.instagram.com/brand',
      'https://www.instagram.com/brand/',
      // a story permalink is login-walled and expires
      'https://www.instagram.com/stories/brand/3401234567890/',
      ['https://www.instagram.com/p/C8sJ1kFq2sX/', { post_type: 'story' }],
    ],
  },
  {
    name: 'instagram-standalone',
    provider: new InstagramStandaloneProvider(),
    accepts: ['https://www.instagram.com/p/C8sJ1kFq2sX/'],
    refuses: [
      'https://www.instagram.com/brand',
      ['https://www.instagram.com/p/C8sJ1kFq2sX/', { post_type: 'story' }],
    ],
  },
  {
    name: 'threads',
    provider: new ThreadsProvider(),
    accepts: [
      'https://www.threads.net/@brand/post/C8sJ1kFq2sX',
      'https://www.threads.com/@brand/post/C8sJ1kFq2sX',
    ],
    refuses: ['https://www.threads.net/@brand', 'https://www.threads.net/@brand/'],
  },
  {
    name: 'facebook',
    provider: new FacebookProvider(),
    accepts: [
      'https://www.facebook.com/reel/1234567890',
      'https://www.facebook.com/61560000000000/posts/pfbid0abc',
      // a Page whose slug carries hyphens or underscores
      'https://www.facebook.com/Acme-Home-Garden-123/posts/pfbid0abc',
      'https://www.facebook.com/permalink.php?story_fbid=pfbid0abc&id=615600000',
      'https://www.facebook.com/photo/?fbid=1234567890',
    ],
    refuses: [
      // stories are login-walled and expire within a day
      'https://www.facebook.com/stories/1234567890',
      ['https://www.facebook.com/reel/1234567890', { post_type: 'story' }],
      // the legacy story permalink, which no /stories/ prefix test would catch
      'https://m.facebook.com/story.php?story_fbid=1&id=2',
      // a post inside a private group
      'https://www.facebook.com/groups/123456/posts/789/',
      // credentials or a port in the authority are never what we stored
      'https://u:p@www.facebook.com/acme/posts/1',
      'https://www.facebook.com:8443/acme/posts/1',
      'https://www.facebook.com/login/?next=x',
      'https://m.facebook.com/messages/t/123',
      'https://www.facebook.com/',
      'http://www.facebook.com/reel/1234567890',
      'https://www.facebook.com.evil.test/reel/1',
      'not a url',
    ],
  },
  {
    name: 'pinterest',
    provider: new PinterestProvider(),
    accepts: [
      'https://www.pinterest.com/pin/1234567890',
      'https://www.pinterest.com/pin/1234567890/',
    ],
    // the sandbox stores no release URL at all
    refuses: ['', 'https://www.pinterest.com/acme/board'],
  },
  {
    name: 'gmb',
    provider: new GmbProvider(),
    accepts: [
      'https://search.google.com/local/posts?q=acme&ludocid=123',
      'https://www.google.com/search?q=acme',
    ],
    refuses: [
      // the Business Profile dashboard, which only the owner can open
      'https://business.google.com/locations/12345',
      'https://google.com.evil.test/search?q=acme',
      // owner-only pages on the very same hosts
      'https://search.google.com/search-console/ownership?resource_id=x',
      'https://www.google.com/maps/place/?q=acme',
      'https://www.google.com/',
      'https://search.google.com/local/postsfoo',
      'https://u:p@search.google.com/local/posts?q=acme',
    ],
  },
  {
    name: 'telegram',
    provider: new TelegramProvider(),
    accepts: ['https://t.me/acmechannel/42'],
    refuses: [
      // a private channel: members-only deep link, or a bare numeric chat id
      'https://t.me/c/1234567890/42',
      'https://t.me/-1001234567890/42',
      'https://t.me/acmechannel',
    ],
  },
  {
    name: 'devto',
    provider: new DevToProvider(),
    accepts: ['https://dev.to/acme/my-article-1abc'],
    refuses: ['https://dev.to/acme', 'https://dev.to/'],
  },
  {
    name: 'dribbble',
    provider: new DribbbleProvider(),
    accepts: ['https://dribbble.com/shots/12345678'],
    // a missing Location header would leave shots/undefined behind
    refuses: ['https://dribbble.com/shots/undefined', 'https://dribbble.com/acme'],
  },
  {
    name: 'moltbook',
    provider: new MoltbookProvider(),
    accepts: ['https://www.moltbook.com/post/abc123'],
    refuses: ['https://www.moltbook.com/post/', 'https://www.moltbook.com/'],
  },
  {
    name: 'wrapcast', // farcaster's identifier
    provider: new FarcasterProvider(),
    accepts: ['https://warpcast.com/acme/0xabc12345'],
    refuses: ['https://warpcast.com/undefined', 'https://warpcast.com/acme'],
  },
  {
    name: 'reddit',
    provider: new RedditProvider(),
    accepts: [
      'https://www.reddit.com/r/selfhosted/comments/1abcdef/my_post/',
      'https://www.reddit.com/r/selfhosted/comments/1abcdef',
    ],
    refuses: [
      // the fallback stored when the submission never surfaced
      'https://www.reddit.com/r/selfhosted',
      // a user profile rather than a subreddit
      'https://www.reddit.com/r/u_someone/comments/1abcdef/x/',
      'https://old.reddit.com/r/selfhosted/comments/1abcdef/x/',
    ],
  },
  {
    name: 'nostr',
    provider: new NostrProvider(),
    accepts: ['https://primal.net/e/' + 'a'.repeat(64)],
    refuses: ['https://primal.net/e/abc', 'https://primal.net/p/' + 'a'.repeat(64)],
  },
  {
    name: 'tumblr',
    provider: new TumblrProvider(),
    accepts: ['https://acme.tumblr.com/post/1234567890'],
    refuses: [
      // the blog feed, stored when the response carried no post id
      'https://acme.tumblr.com/post/',
      // a blog on a domain of its own, which we cannot vouch for
      'https://blog.acme.test/post/1234567890',
      // the bare handle a pre-step row leaves behind
      'https://acme/post/1234567890',
    ],
  },
  {
    name: 'medium',
    provider: new MediumProvider(),
    accepts: [
      'https://medium.com/p/1a2b3c4d5e6f',
      'https://medium.com/@acme/my-story-1a2b3c4d5e6f',
    ],
    refuses: [
      // submitted to a publication, so it was created as a draft
      ['https://medium.com/p/1a2b3c4d5e6f', { publication: 'pub-1' }],
      'https://medium.com/@acme',
    ],
  },
  {
    name: 'hashnode',
    provider: new HashnodeProvider(),
    accepts: ['https://acme.hashnode.dev/my-post'],
    // a publication on a domain of its own: the host comes back from the API
    refuses: ['https://blog.acme.test/my-post', 'https://acme.hashnode.dev/'],
  },
  {
    name: 'bluesky',
    provider: new BlueskyProvider(),
    accepts: [
      'https://bsky.app/profile/did:plc:abc123/post/3kabcdefghijk',
      'https://bsky.app/profile/did:web:acme.test/post/3kabcdefghijk',
    ],
    refuses: ['', 'https://bsky.app/profile/did:plc:abc123'],
  },
];

const privateProviders: [string, SocialProvider, string][] = [
  ['tiktok', new TiktokProvider(), "the creator's own inbox, with the internal publish id"],
  ['slack', new SlackProvider(), 'a workspace-internal archives link'],
  ['discord', new DiscordProvider(), 'a guild-internal channel deep link'],
  ['listmonk', new ListmonkProvider(), 'the self-hosted campaign preview admin URL'],
  ['mastodon', new MastodonProvider(), 'a self-hosted instance URL'],
  ['wordpress', new WordpressProvider(), 'a self-hosted site, and the post may be a draft'],
  ['lemmy', new LemmyProvider(), 'a customer-supplied instance URL'],
  ['skool', new SkoolProvider(), 'an internal group id, in a members-only community'],
  ['linkedin', new LinkedinProvider(), 'the logged-in feed route, not a public permalink'],
  ['linkedin-page', new LinkedinPageProvider(), 'the same logged-in feed route as linkedin'],
  ['tiktok-business', new TiktokBusinessProvider(), 'the same inbox and profile fallbacks, and a video publishes at the account default visibility'],
  ['mewe', new MeweProvider(), 'the profile feed or the group, never the post'],
  ['vk', new VkProvider(), 'the logged-in feed view'],
  ['kick', new KickProvider(), 'the channel, never the message'],
  ['twitch', new TwitchProvider(), 'the channel, never the message'],
  ['whop', new WhopProvider(), 'a membership-gated experience'],
  ['youtube', new YoutubeProvider(), 'platform data under an authorizationPolicy, and the video may be private or unlisted'],
];

describe('isPublicReleaseURL, per provider that opted in', () => {
  for (const { name, provider, accepts, refuses } of opted) {
    describe(name, () => {
      const call = (entry: string | [string, any]) => {
        const [url, settings] = Array.isArray(entry) ? entry : [entry, {}];
        return provider.isPublicReleaseURL!(url, settings);
      };

      it('accepts the public post pages it stores', () => {
        // an empty table would pass every assertion below without testing
        // anything, so opting a provider in means showing both sides
        expect(accepts.length).toBeGreaterThan(0);
        expect(refuses.length).toBeGreaterThan(0);
        for (const entry of accepts) {
          expect({ entry, public: call(entry) }).toEqual({
            entry,
            public: true,
          });
        }
      });

      it('refuses everything else it stores', () => {
        for (const entry of refuses) {
          expect({ entry, public: call(entry) }).toEqual({
            entry,
            public: false,
          });
        }
      });
    });
  }

  it('is inherited by the X provider that runs on the customer keys', () => {
    expect(
      new XOwnKeyProvider().isPublicReleaseURL!(
        'https://x.com/acme/status/1795000000000000000',
        {}
      )
    ).toBe(true);
  });
});

// These providers store a release URL that is not a public post page, so they
// must never opt in. Leaving the hook off is what keeps them private: the
// generic code reads releaseURL for the preview page only through it.
describe('providers that must stay private', () => {
  for (const [name, provider, why] of privateProviders) {
    it(`${name} does not opt in: ${why}`, () => {
      expect(provider.isPublicReleaseURL).toBeUndefined();
    });
  }
});

// A provider added later must be ruled on, not forgotten: forgetting means it
// opts out, which is the safe side, but it should be a decision someone wrote
// down. This fails until the new provider is listed in one table or the other.
describe('every provider is ruled on', () => {
  // x-own-key is the same X provider on the customer's own keys and inherits
  // its opt-in, which the suite above checks directly
  const optedIdentifiers = [...opted.map((o) => o.name), 'x-own-key'];
  const privateIdentifiers = privateProviders.map(([name]) => name);

  it('lists each connectable provider as opted in or kept private', () => {
    const ruled = new Set([...optedIdentifiers, ...privateIdentifiers]);

    const missing = socialIntegrationList
      .map((provider) => provider.identifier)
      .filter((identifier) => !ruled.has(identifier));

    expect(missing).toEqual([]);
  });

  it('agrees with what each provider actually implements', () => {
    const optedIn = new Set(optedIdentifiers);
    const disagrees = socialIntegrationList
      .filter(
        (provider) =>
          optedIn.has(provider.identifier) !== !!provider.isPublicReleaseURL
      )
      .map((provider) => provider.identifier);

    expect(disagrees).toEqual([]);
  });
});
