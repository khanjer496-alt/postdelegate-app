# PostDelegate CLI

Schedule and publish social media posts from your terminal, scripts, CI or an AI agent, using the
[PostDelegate](https://postdelegate.com) public API. Built on [`@postdelegate/node`](https://www.npmjs.com/package/@postdelegate/node),
no runtime dependencies, Node.js 18 or newer.

```bash
npm install -g postdelegate
# or run without installing
npx postdelegate help
```

## Log in

Create an API key in the app under **Settings > Agents / Dev** (availability depends on your plan).

```bash
postdelegate login          # prompts for the key (hidden), verifies it, saves it
```

The key is saved to `~/.config/postdelegate/config.json` (or `$XDG_CONFIG_HOME/postdelegate/config.json`) with
permissions `0600`. You can also pass it by environment, which takes precedence over the saved one:

```bash
export POSTDELEGATE_API_KEY=...
export POSTDELEGATE_API_URL=https://app.postdelegate.com/api   # optional, e.g. a self-hosted instance
```

Piping works for scripts: `echo "$KEY" | postdelegate login`. Avoid `--api-key` on shared machines, it ends up in shell history.
`postdelegate logout` deletes the saved key. The CLI never prints your key.

## Commands

```text
postdelegate login [--api-key <key>] [--api-url <url>] [--no-verify]
postdelegate logout
postdelegate whoami [--json]
postdelegate channels [--group <id>] [--json]
postdelegate posts list [--from <date>] [--to <date>] [--customer <id>] [--json]
postdelegate posts create --channel <id> [--channel <id> ...] --text <text> [--text <text> ...]
                          [--media <file|url> ...] (--schedule <ISO date|now> | --draft)
                          [--settings <json|@file>] [--html] [--short-links] [--dry-run] [--json]
postdelegate posts delete <post-id> [--json]
postdelegate upload <file|url> [--json]
postdelegate help [command]
postdelegate --version
```

Global flags: `--json` (machine-readable output), `--api-url <url>`, `--api-key <key>`.
The command comes first, flags after it. A value that starts with a dash needs the `=` form: `--text=-hello`.

### Examples

```bash
# list connected channels and their ids
postdelegate channels

# schedule a post on two channels
postdelegate posts create --channel CH1 --channel CH2 \
  --text "Launching tomorrow!" --schedule 2026-12-01T09:00:00Z

# a thread: the first --text is the post, the next ones are replies
postdelegate posts create --channel CH1 --schedule now \
  --text "Thread 1/2" --text "Thread 2/2"

# with media (local file uploaded for you, or a public URL), saved as a draft
postdelegate posts create --channel CH1 --text "New photo" --media ./photo.png --draft

# channel specific settings
postdelegate posts create --channel CH1 --text "Video" --media ./clip.mp4 \
  --settings '{"title":"My video"}' --schedule 2026-12-02T15:00:00Z

# see the request without sending anything
postdelegate posts create --channel CH1 --text "Hi" --draft --dry-run

# what is scheduled this week
postdelegate posts list --from 2026-12-01 --to 2026-12-07

# delete
postdelegate posts delete POST_ID

# JSON for scripts
postdelegate channels --json | jq '.[].id'
```

Notes:

- `--text` is plain text. Blank lines make paragraphs and single line breaks are kept. Use `--html` to send HTML yourself.
- `--schedule` takes an ISO 8601 date-time. Include a time zone (`Z` or `+02:00`), otherwise your local time zone is used.
- `posts create` needs either `--schedule` or `--draft`, so a post is never published by accident.
- `posts list` defaults to the last 7 days through the next 30 days. A date-only `--to` includes the whole day (UTC).
- `posts delete` removes the whole post (all channels that were created together).

### Exit codes

| Code | Meaning |
| --- | --- |
| 0 | Success |
| 1 | Error (API error, network problem, validation failure) |
| 2 | Usage error (bad or missing arguments) |
| 3 | Not logged in or authentication failed |

Errors go to stderr. With `--json` they are printed as `{"error":{"message":"...","exitCode":N}}`.

## For AI agents

See [SKILL.md](./SKILL.md): a short guide to drive this CLI from Claude Code, Codex or any other agent.

## License

AGPL-3.0, the same license as PostDelegate itself.
