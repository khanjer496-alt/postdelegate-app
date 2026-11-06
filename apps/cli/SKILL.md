---
name: postdelegate
description: Schedule, draft, publish, list and delete social media posts on the user's connected channels (X, LinkedIn, Instagram, Facebook, TikTok and more) with the PostDelegate CLI. Use when the user asks to post, schedule, queue or draft content for social media, check what is scheduled, or upload media for a post.
---

# PostDelegate CLI for AI agents

`postdelegate` posts to the user's own social channels. Publishing is public and hard to undo,
so confirm anything irreversible with the user first.

## Setup (once)

- Check it is installed: `postdelegate --version`. If not: `npm install -g postdelegate` (or prefix commands with `npx`).
- Check you are logged in: `postdelegate whoami`. Exit code 3 means no valid key.
- The user creates an API key in the app (Settings > Agents / Dev) and runs `postdelegate login` themselves,
  or exports `POSTDELEGATE_API_KEY`. Never ask the user to paste the key into the chat, and never print,
  log or commit it.

## Rules

1. Always pass `--json` and parse the output. Errors arrive on stderr as JSON, check the exit code.
2. Get channel ids with `postdelegate channels --json`. Use the `id` field. Skip channels with `"disabled": true`.
3. A post needs `--schedule <ISO date|now>` or `--draft`. If the user did not say when, use `--draft`
   or ask. Only use `--schedule now` when the user clearly asked to publish immediately.
4. Run with `--dry-run` first when unsure: it prints the request and sends nothing.
5. Confirm with the user before `--schedule now` or `posts delete`. Drafts and future schedules are reversible.
6. Dates are ISO 8601 with a time zone, for example `2026-12-01T09:00:00Z`. Do not guess the user's time zone,
   ask if it matters.
7. Respect each platform's limits (X: 280 characters unless the account is verified, and so on).
   A 400 error names the channel and the problem, fix the text and retry.

## Commands

```bash
postdelegate whoami --json
postdelegate channels --json                         # [{id, name, identifier, disabled, ...}]
postdelegate posts list --from 2026-12-01 --to 2026-12-31 --json
postdelegate upload ./photo.png --json               # or a public https URL -> {id, path}

# draft on one channel
postdelegate posts create --channel CH_ID --text "Copy here" --draft --json

# schedule on several channels, with media (a local path or a public URL is uploaded for you)
postdelegate posts create --channel CH1 --channel CH2 \
  --text "Copy here" --media ./photo.png \
  --schedule 2026-12-01T09:00:00Z --json

# thread: first --text is the post, the following ones are replies
postdelegate posts create --channel CH_ID --text "1/2" --text "2/2" --schedule 2026-12-01T09:00:00Z --json

# channel specific settings as JSON (or @file.json)
postdelegate posts create --channel CH_ID --text "..." --settings '{"title":"..."}' --draft --json

postdelegate posts delete POST_ID --json             # removes the post on all channels it was created for
```

`posts create --json` returns `[{ "postId": "...", "integration": "<channel id>" }]`.
`posts list --json` returns posts with `id`, `content` (HTML), `publishDate`, `state`
(`QUEUE`, `PUBLISHED`, `ERROR`, `DRAFT`), `error`, `releaseURL` and `integration`.

## Exit codes

0 ok, 1 error (API/network/validation), 2 usage error (fix the arguments), 3 not logged in or key rejected.
On 3, stop and ask the user to log in. Do not retry in a loop.

## Text formatting

`--text` is plain text. Blank lines become paragraphs, single newlines become line breaks. HTML is
escaped unless you pass `--html`. A value starting with `-` must use `--text=-value`.
Pass the exact copy the user approved, do not add hashtags, emoji or links on your own.
