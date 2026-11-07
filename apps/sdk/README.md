# PostDelegate Node.js SDK

Official Node.js / TypeScript SDK for the [PostDelegate](https://postdelegate.com) public API:
schedule posts, publish to your connected channels, upload media and read your calendar.

- Zero dependencies (uses the built-in `fetch`, Node.js 18 or newer)
- Fully typed, ESM and CommonJS
- Throws a `PostDelegateError` (with the HTTP `status`) on every failed request

Prefer a terminal or an AI agent? Use the [`postdelegate` CLI](https://www.npmjs.com/package/postdelegate), which is built on this SDK.

## Install

```bash
npm install @postdelegate/node
# or
pnpm add @postdelegate/node
```

## Get an API key

Open [app.postdelegate.com](https://app.postdelegate.com), go to **Settings > Agents / Dev** and copy your API key
(Public API access depends on your plan). Keep it secret, it can publish to all your channels.

## Quick start

```typescript
import PostDelegate from '@postdelegate/node';

const client = new PostDelegate(process.env.POSTDELEGATE_API_KEY!);

const channels = await client.integrations();

await client.post({
  type: 'schedule',
  date: '2026-12-01T09:00:00Z',
  posts: [
    {
      integration: { id: channels[0].id },
      value: [{ content: '<p>Hello from the PostDelegate SDK!</p>' }],
    },
  ],
});
```

CommonJS works too: `const { PostDelegate } = require('@postdelegate/node');`

### Options

```typescript
new PostDelegate(apiKey);
new PostDelegate(apiKey, 'https://my-postdelegate.example.com/api'); // base URL, without /public/v1
new PostDelegate(apiKey, {
  baseUrl: 'https://app.postdelegate.com/api', // default
  fetch: myFetch, // custom fetch implementation
  userAgent: 'my-app/1.0',
});
```

Post content is HTML (`<p>`, `<br>`, `<strong>`, `<a>`, ...). Plain text without tags also works, but use `<p>` for paragraphs.

## Methods

All methods return promises and use the routes under `{baseUrl}/public/v1`.

### `post(body)` - create, schedule or publish a post

`POST /posts`. `type` is `draft`, `schedule` (queue for `date`), `now` (publish immediately) or `update`.
`date`, `shortLink` and `tags` are optional in the SDK (defaults: now, `false`, none).
Returns one `{ postId, integration }` per channel.

```typescript
const result = await client.post({
  type: 'schedule',
  date: '2026-12-01T09:00:00Z',
  shortLink: false,
  tags: [],
  posts: [
    {
      integration: { id: 'CHANNEL_ID' },
      value: [
        { content: '<p>First post</p>', image: [{ id: media.id, path: media.path }] },
        { content: '<p>A reply in the thread</p>' }, // further items become comments / thread
      ],
      settings: {}, // channel specific settings, see integrationSettings()
    },
  ],
});
// [{ postId: '...', integration: 'CHANNEL_ID' }]
```

The same date applies to every channel of one request. Create separate posts to use different dates.

### `postList({ startDate, endDate, customer? })` - list posts

`GET /posts`

```typescript
const { posts } = await client.postList({
  startDate: '2026-12-01T00:00:00Z',
  endDate: '2026-12-31T23:59:59Z',
  customer: 'GROUP_ID', // optional, only channels of this group
});
```

### `deletePost(id)` - delete a post

`DELETE /posts/:id`. Deletes the post and everything created together with it (all channels of that post group).

```typescript
await client.deletePost('POST_ID');
```

### `deletePostByGroup(group)` - delete by group id

`DELETE /posts/group/:group`

```typescript
await client.deletePostByGroup(posts[0].group);
```

### `changePostStatus(id, status)` - move between draft and scheduled

`PUT /posts/:id/status` with `'draft'` or `'schedule'`.

```typescript
await client.changePostStatus('POST_ID', 'schedule');
```

### `upload(file, filenameOrExtension, options?)` - upload a file

`POST /upload`. Pass a `Buffer`, `Uint8Array` or `Blob`, and a file name (`photo.png`) or just an extension (`png`).
Set `adjust: true` to let PostDelegate normalize the file for publishing.

```typescript
import { readFileSync } from 'node:fs';

const media = await client.upload(readFileSync('photo.png'), 'photo.png');
// { id, name, path, ... } -> use { id: media.id, path: media.path } in post()
```

### `uploadFromUrl(url, options?)` - import a file from a public URL

`POST /upload-from-url`. The URL must be public `https` and point to a supported image or video.

```typescript
const media = await client.uploadFromUrl('https://example.com/photo.jpg');
```

### `getMedia({ page?, search? })` - browse the media library

`GET /media`

```typescript
const { pages, results } = await client.getMedia({ page: 1, search: 'logo' });
```

### `mediaStatus(id)` - processing status of an upload

`GET /media/:id/status`

```typescript
const status = await client.mediaStatus(media.id);
```

### `integrations(group?)` - list connected channels

`GET /integrations`

```typescript
const channels = await client.integrations();
// [{ id, name, identifier: 'x', picture, disabled, profile, customer? }]
const clientChannels = await client.integrations('GROUP_ID');
```

### `groups()` - list channel groups (customers)

`GET /groups`

```typescript
const groups = await client.groups(); // [{ id, name }]
```

### `integrationSettings(id)` - rules and settings of a channel

`GET /integration-settings/:id`. Returns max length, posting rules and the settings schema accepted in `post().posts[].settings`.

```typescript
const { output } = await client.integrationSettings('CHANNEL_ID');
console.log(output.maxLength, output.rules, output.settings);
```

### `findSlot(integrationId)` - next free time slot

`GET /find-slot/:id`

```typescript
const { date } = await client.findSlot('CHANNEL_ID');
```

### `me()` and `isConnected()` - check the key

`GET /me`, `GET /is-connected`

```typescript
const { organization } = await client.me(); // { id, name }
const { connected } = await client.isConnected(); // true
```

### `notifications(page = 0)` - in-app notifications

`GET /notifications`

```typescript
const notifications = await client.notifications(0);
```

### `analytics(integrationId, days = 7)` and `postAnalytics(postId, days = 7)`

`GET /analytics/:integration` and `GET /analytics/post/:postId`

```typescript
const channelStats = await client.analytics('CHANNEL_ID', 30);
const postStats = await client.postAnalytics('POST_ID', 7);
```

## Error handling

```typescript
import PostDelegate, { PostDelegateError } from '@postdelegate/node';

try {
  await client.me();
} catch (err) {
  if (err instanceof PostDelegateError) {
    console.error(err.status, err.message, err.body); // e.g. 401 'Invalid API key'
  }
  throw err;
}
```

| Status | Meaning |
| --- | --- |
| 400 | Validation failed (for example a post that is too long for the channel), see `message` |
| 401 | Missing or invalid API key, or no active subscription |
| 403 | The key is not allowed to do this |

## Types

All request and response types are exported: `CreatePostBody`, `PostItem`, `PostValue`, `MediaItem`, `GetPostsFilters`,
`Post`, `Integration`, `Group`, `Media`, `MeResponse`, `PostDelegateOptions` and more.

## Raw HTTP

Every method is a thin wrapper over `https://app.postdelegate.com/api/public/v1/*` with the key in the `Authorization` header:

```bash
curl https://app.postdelegate.com/api/public/v1/integrations -H "Authorization: $POSTDELEGATE_API_KEY"
```

## License

AGPL-3.0, the same license as PostDelegate itself.
