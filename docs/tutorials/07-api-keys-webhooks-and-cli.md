# Video 7: API keys, webhooks and the command line

Find and protect your API key, make a first request, receive a webhook when a post publishes, and create a draft from the terminal with the PostDelegate command line tool.

| | |
| --- | --- |
| Target runtime | 2:54 (174 s), about 307 spoken words (about 106 words per minute) |
| Needs | A plan with API access (all plans) and webhooks (Starter 2, Team 10, Pro 30, Ultimate 10,000; see docs billing.md). Node.js 18 or newer for the CLI. A terminal with a large font. A public https test address that shows incoming requests (a request-inspector site such as webhook.site, or a tiny receiver of your own). |
| Account to record on | A dedicated "Acme Coffee" demo workspace whose API key you can rotate right after filming. Never film on a workspace whose key powers a real integration. |
| Series | [Back to the series list](README.md) |

Label citations: see "How to read the label citations" in the [README](README.md). Anything marked [VERIFY] could not be confirmed from code and must be checked on screen before recording.

## Before you record

- The API key can act as the whole workspace (docs api.md). Assume anything that appears on screen is leaked. Plan to **Rotate Key** straight after the session and blur the footage anyway.
- In the terminal set the key in an environment variable before recording, off camera: `export POSTDELEGATE_API_KEY=...`, then clear the screen. Commands in the video use `$POSTDELEGATE_API_KEY` so the key never appears.
- Use a throwaway terminal profile: short prompt (`$`), no username, hostname or full path in the prompt, font size 20 or larger, history off or cleared.
- The CLI prints the path of its saved config (it contains your home folder name). Run it from a clean demo user account, or cover the path in the edit. Never show the contents of that file.
- Open the request-inspector site in a second tab and copy its https address. Webhook addresses must be public https (docs webhooks.md). The address is the secret to that inspector page, so blur it.
- This video is dense. If the first edit runs past 3:00, split it into two videos: 7a API key and first request, 7b webhooks and CLI.

## Shot list

### Step 1 (0:00 to 0:08, 8 s): Intro

**On screen**

1. Calendar page, then a title card: API, webhooks, CLI.

**Narration:** PostDelegate has a public API, webhooks, and a command line tool. Here is how to start with each.

**Caption:** API. Webhooks. CLI.

### Step 2 (0:08 to 0:28, 20 s): Find the API key

**On screen**

1. Click **Settings**, then the tab **Agents / Dev**. Scroll past **Connect your AI** to the card **API Key**.
2. It shows **API base URL** (`https://app.postdelegate.com/api/public/v1`) with **Copy URL**, then the key with all but the last five characters blurred by the app.
3. Move over the buttons: **Reveal**, **Copy**, **Rotate Key**, **Open Wizard**. Do NOT click **Reveal** while filming a real key.

**Labels used**

- `Settings`: translation key `settings` (en/translation.json), used in `layout/top.menu.tsx`
- `Agents / Dev`: translation key `agents_dev` (en/translation.json), used in `layout/settings.component.tsx`
- `API Key`: fixed or default text in `public-api/public.component.tsx` (no entry in translation.json)
- `Use PostDelegate API to integrate with your tools.`: translation key `use_postiz_api_to_integrate_with_your_tools` (en/translation.json), used in `public-api/public.component.tsx`
- `API base URL`: translation key `api_base_url` (en/translation.json), used in `public-api/public.component.tsx`
- `Copy URL`: translation key `copy_url` (en/translation.json), used in `public-api/public.component.tsx`
- `Reveal`: translation key `reveal` (en/translation.json), used in `public-api/public.component.tsx`
- `Copy`: translation key `copy` (en/translation.json), used in `public-api/public.component.tsx`
- `Rotate Key`: fixed or default text in `public-api/public.component.tsx` (no entry in translation.json)
- `Open Wizard`: fixed or default text in `public-api/public.component.tsx` (no entry in translation.json)

**Narration:** Your key lives in Settings, under Agents and Dev. Reveal and Copy are right there. Treat this key like a password. It can read, publish and delete posts on every channel in the workspace.

**Caption:** Treat your API key like a password

**Notes**

- The key is shown with everything except the last five characters blurred (public.component.tsx), but the CLI and curl scenes use the full value from the environment, so keep the terminal clean.
- Docs api.md: keep it in a server secret store, not in a repository, a prompt or a screenshot.

### Step 3 (0:28 to 0:50, 22 s): Make a first request

**On screen**

1. Cut to the terminal. Type: `curl https://app.postdelegate.com/api/public/v1/is-connected -H "Authorization: $POSTDELEGATE_API_KEY"`. The answer is `{"connected":true}`.
2. Type: `curl https://app.postdelegate.com/api/public/v1/me -H "Authorization: $POSTDELEGATE_API_KEY"`. The answer names the workspace, "Acme Coffee", and `"user": null`.
3. Overlay: "Authorization header = the bare key. No Bearer."

**Narration:** Send your key in the Authorization header, with nothing in front of it. No Bearer. This first call checks the key works. The second shows which workspace it belongs to. The full reference is in the docs.

**Caption:** Authorization: YOUR_API_KEY (no "Bearer")

**Notes**

- Docs api.md: the REST API takes the bare key; the MCP endpoint at /mcp is different and wants `Bearer `. Mixing them is the most common cause of a 401.
- Responses from docs api/more.md: `{ "connected": true }` and `{ "organization": { "id": ..., "name": ... }, "user": null }`.
- Pipe through `jq` only if the demo machine has it installed; otherwise show the raw one-line JSON.

- [VERIFY] Exact output format of the two calls on production (spacing, extra fields).

### Step 4 (0:50 to 0:58, 8 s): Rotating a key

**On screen**

1. Back in **Settings > Agents / Dev**, point at **Rotate Key**. Show the dialog: **Rotate API Key?**, "This will generate a new API key and invalidate the current one." Click **Cancel** (do not rotate on camera unless this is the throwaway workspace).

**Labels used**

- `Rotate API Key?`: fixed or default text in `public-api/public.component.tsx` (no entry in translation.json)
- `This will generate a new API key and invalidate the current one.`: fixed or default text in `public-api/public.component.tsx` (no entry in translation.json)
- `Cancel`: translation key `cancel` (en/translation.json), used in `public-api/public.component.tsx`

**Narration:** If a key ever leaks, choose Rotate Key. The old one stops working everywhere, immediately.

**Caption:** Leaked? Rotate Key

**Notes**

- Rotating invalidates the key for every script and MCP connection that used it (docs api.md).

### Step 5 (0:58 to 1:24, 26 s): Create a webhook

**On screen**

1. In **Settings** click the tab **Webhooks**. The title shows the count, for example **Webhooks (0/2)**.
2. Click **Add a webhook**. The window **Add webhook** opens.
3. Fill **Name** with `Acme post log`. Fill **URL** with the inspector address (blur it).
4. In **Integrations** leave **All integrations**, and show that **Specific integrations** lets you pick channels.
5. Click **Send Test**. A toast says **Webhook send**. Then click **Save**. A toast says **Webhook added successfully**.

**Labels used**

- `Webhooks`: translation key `webhooks_1` (en/translation.json), used in `layout/settings.component.tsx`
- `Add a webhook`: translation key `add_a_webhook` (en/translation.json), used in `webhooks/webhooks.tsx`
- `Add webhook`: translation key `add_webhook` (en/translation.json), used in `webhooks/webhooks.tsx`
- `Name`: fixed or default text in `webhooks/webhooks.tsx` (no entry in translation.json)
- `URL`: fixed or default text in `webhooks/webhooks.tsx` (no entry in translation.json)
- `Integrations`: fixed or default text in `webhooks/webhooks.tsx` (no entry in translation.json)
- `All integrations`: translation key `all_integrations` (en/translation.json), used in `webhooks/webhooks.tsx`
- `Specific integrations`: translation key `specific_integrations` (en/translation.json), used in `webhooks/webhooks.tsx`
- `Send Test`: translation key `send_test` (en/translation.json), used in `webhooks/webhooks.tsx`
- `Webhook send`: translation key `webhook_sent` (en/translation.json), used in `webhooks/webhooks.tsx`
- `Save`: translation key `save` (en/translation.json), used in `webhooks/webhooks.tsx`
- `Webhook added successfully`: translation key `webhook_added_successfully` (en/translation.json), used in `webhooks/webhooks.tsx`

**Narration:** A webhook calls your own address when a post goes live. Open the Webhooks tab and add one. Give it a name and a public https address. Choose all channels or only some. Send Test checks that your address answers. Then save.

**Caption:** Webhook = PostDelegate calls your URL when a post publishes

**Notes**

- Docs webhooks.md: the one event is "a post was published". The URL must be a public https address; private and internal addresses are refused when you save and when a request is sent. No signature, no retries.
- The Webhooks tab shows only if the plan allows webhooks (settings.component.tsx tier.webhooks).

- [VERIFY] The exact field labels inside the Add webhook window (**Name**, **URL**, **Integrations**). They are fixed strings in webhooks.tsx; confirm they are not renamed.

### Step 6 (1:24 to 1:40, 16 s): See the request arrive

**On screen**

1. Switch to the inspector tab. The test request is there: a `POST` with a JSON body, an array with example posts (made-up ids).
2. Point at the fields `id`, `content`, `publishDate`, `releaseURL`, `state` and `integration`. Blur the inspector address.

**Narration:** In your inspector you can see the request. It is a small JSON list with the post, its time, the link to the live post, and the channel. Reply quickly with any 2xx, and do the slow work later.

**Caption:** JSON body: id, content, publishDate, releaseURL, state, integration

**Notes**

- Docs webhooks.md: the Send Test payload has made-up ids and more than one entry. Requests are sent once; PostDelegate ignores your response.

### Step 7 (1:40 to 2:00, 20 s): Install the CLI and log in

**On screen**

1. Terminal. Type: `npm install -g postdelegate` and let it finish (speed up). Then `postdelegate --version`.
2. Type `postdelegate login`. The prompt asks for the key and hides what you type. Paste the key (it does not show). Output: `Logged in to Acme Coffee (https://app.postdelegate.com/api). Saved to ...config.json`. Cover the saved path in the edit.
3. Type `postdelegate whoami`.

**Narration:** The command line tool installs with npm. Run postdelegate login and paste your key. It stays hidden, and it is saved only on your computer. whoami confirms the workspace.

**Caption:** npm install -g postdelegate

**Notes**

- Source: apps/cli/README.md and apps/cli/src/commands.ts. Login hides the key, verifies it with GET /me and saves it with 0600 permissions. Never show the contents of the saved config file.
- The CLI prompt and README tell users to look under "Settings > Public API". In the app the key is on the **Settings > Agents / Dev** tab. Cover the prompt text in the edit or re-record the prompt after the CLI is fixed. Report this to the CLI owner.

- [VERIFY] That the `postdelegate` package is published to npm on the day you record. deploy/postdelegate/PUBLISHING-SDK-CLI.md says the name was unregistered on 30 October 2026 and publishing was still pending. Run `npm view postdelegate`. If it returns 404, skip this scene or build the CLI locally and say "coming soon". Do not claim it is on npm until it is.
- [VERIFY] Node.js 18 or newer is installed on the recording machine (package.json engines).

### Step 8 (2:00 to 2:22, 22 s): List channels and create a draft

**On screen**

1. Type `postdelegate channels`. A table appears with the columns ID, PLATFORM, NAME, STATUS, GROUP. Copy the demo channel ID.
2. Type `postdelegate posts create --channel CHANNEL_ID --text "Behind the bar: dialing in espresso before doors open." --draft`. Output: `Saved draft on 1 channel(s)` and a table with POST ID and CHANNEL.
3. The command refuses to run without either `--draft` or `--schedule`. Say that out loud.

**Narration:** channels lists your channels with their IDs. posts create makes a post. Here we use dash dash draft, so nothing publishes. The tool will not run without either draft or schedule, so a post never goes out by accident.

**Caption:** posts create needs --draft or --schedule

**Notes**

- Always use `--draft` on camera. The CLI also supports `--schedule <ISO date|now>`, `--media`, `--dry-run` and `--json` (apps/cli/README.md). Mention `--dry-run` if there is time: it shows the request without sending anything.
- Keep the post text free of web addresses.

### Step 9 (2:22 to 2:38, 16 s): List, check in the app, delete

**On screen**

1. Type `postdelegate posts list`. The draft shows in a table (ID, DATE (UTC), STATE, CHANNEL, CONTENT).
2. Switch to the PostDelegate **Calendar**. The draft is there. Click it: in the composer header next to **Create Post** there is a teal **CLI** badge.
3. Back in the terminal type `postdelegate posts delete POST_ID`. Output: `Deleted post POST_ID`.

**Labels used**

- `Create Post`: translation key `create_post_title` (en/translation.json), used in `new-launch/manage.modal.tsx`
- `CLI`: fixed or default text in `launches/creation.method.badge.tsx` (no entry in translation.json)

**Narration:** posts list shows what is planned. The draft is on your calendar, marked as created from the command line. And posts delete removes it again.

**Caption:** posts list. posts delete.

**Notes**

- posts delete removes the whole post, every channel it was created for (apps/cli/README.md).
- The posts list default range is the last 7 days to the next 30 days. A draft made with the CLI is dated "now", so it will show.

- [VERIFY] That a CLI draft shows the teal CLI badge in the composer header (creation.method.badge.tsx maps CLI to teal). The CLI sends creationMethod CLI (commands.ts).

### Step 10 (2:38 to 2:48, 10 s): Safety recap

**On screen**

1. Graphic: 1. Key in an environment variable or secret store. 2. Rotate if exposed. 3. Webhook address is public https only, no secrets in the body. 4. Always draft first.

**Narration:** Keep your key out of code and chats. Rotate it if it ever leaks. And start with drafts while you are testing.

**Caption:** Keep keys secret. Test with drafts.

### Step 11 (2:48 to 2:54, 6 s): End card

**On screen**

1. End card with the logo, `app.postdelegate.com`, `postdelegate.com/docs/api`, and the next video title.

**Narration:** Next, the affiliate program. Thanks for watching.

**Caption:** Docs: postdelegate.com/docs/api

## Voice-over read-through

Read this straight through for the voice recording. Timecodes are where each line starts on the picture.

**0:00** PostDelegate has a public API, webhooks, and a command line tool. Here is how to start with each.

**0:08** Your key lives in Settings, under Agents and Dev. Reveal and Copy are right there. Treat this key like a password. It can read, publish and delete posts on every channel in the workspace.

**0:28** Send your key in the Authorization header, with nothing in front of it. No Bearer. This first call checks the key works. The second shows which workspace it belongs to. The full reference is in the docs.

**0:50** If a key ever leaks, choose Rotate Key. The old one stops working everywhere, immediately.

**0:58** A webhook calls your own address when a post goes live. Open the Webhooks tab and add one. Give it a name and a public https address. Choose all channels or only some. Send Test checks that your address answers. Then save.

**1:24** In your inspector you can see the request. It is a small JSON list with the post, its time, the link to the live post, and the channel. Reply quickly with any 2xx, and do the slow work later.

**1:40** The command line tool installs with npm. Run postdelegate login and paste your key. It stays hidden, and it is saved only on your computer. whoami confirms the workspace.

**2:00** channels lists your channels with their IDs. posts create makes a post. Here we use dash dash draft, so nothing publishes. The tool will not run without either draft or schedule, so a post never goes out by accident.

**2:22** posts list shows what is planned. The draft is on your calendar, marked as created from the command line. And posts delete removes it again.

**2:38** Keep your key out of code and chats. Rotate it if it ever leaks. And start with drafts while you are testing.

**2:48** Next, the affiliate program. Thanks for watching.

## On-screen captions

- 0:00 to 0:08: API. Webhooks. CLI.
- 0:08 to 0:28: Treat your API key like a password
- 0:28 to 0:50: Authorization: YOUR_API_KEY (no "Bearer")
- 0:50 to 0:58: Leaked? Rotate Key
- 0:58 to 1:24: Webhook = PostDelegate calls your URL when a post publishes
- 1:24 to 1:40: JSON body: id, content, publishDate, releaseURL, state, integration
- 1:40 to 2:00: npm install -g postdelegate
- 2:00 to 2:22: posts create needs --draft or --schedule
- 2:22 to 2:38: posts list. posts delete.
- 2:38 to 2:48: Keep keys secret. Test with drafts.
- 2:48 to 2:54: Docs: postdelegate.com/docs/api

## End card

- Headline: Automate with care
- Call to action: Docs: postdelegate.com/docs/api and postdelegate.com/docs/webhooks. Start at app.postdelegate.com.
- Next video: Video 8: The affiliate program
- Keep the card on screen for 5 seconds (the last step of the shot list is this card).

## YouTube

**Title** (53 characters): PostDelegate API key, webhooks and CLI: a quick start

**Description**

```text
Find and protect your PostDelegate API key, make a first request, set up a webhook that calls you when a post is published, and create a draft from the terminal with the command line tool.

Chapters
0:00 Your API key
0:28 A first request
0:58 Webhooks
1:40 The command line

Links
Open PostDelegate: https://app.postdelegate.com
REST API overview: https://postdelegate.com/docs/api
Webhooks: https://postdelegate.com/docs/webhooks
Plans and limits: https://postdelegate.com/docs/billing
Previous video: [LINK to video 6]
Next video: [LINK to video 8]

Questions? support@postdelegate.com

Never share your API key. If it leaks, rotate it in Settings, on the Agents / Dev tab.
```

**Tags:** PostDelegate, social media API, webhooks, CLI, API key, automate social media posts, developer

**Chapter check:** 4 chapters, first at 0:00, each at least 10 seconds. Timestamps above are computed from the step durations, so re-time them if you change a step.

## Docs page summary (one line)

> Find your API key, receive a webhook when a post publishes, and create drafts from the command line.

## [VERIFY] checklist for this video

- [ ] Step 3: Exact output format of the two calls on production (spacing, extra fields).
- [ ] Step 5: The exact field labels inside the Add webhook window (**Name**, **URL**, **Integrations**). They are fixed strings in webhooks.tsx; confirm they are not renamed.
- [ ] Step 7: That the `postdelegate` package is published to npm on the day you record. deploy/postdelegate/PUBLISHING-SDK-CLI.md says the name was unregistered on 30 October 2026 and publishing was still pending. Run `npm view postdelegate`. If it returns 404, skip this scene or build the CLI locally and say "coming soon". Do not claim it is on npm until it is.
- [ ] Step 7: Node.js 18 or newer is installed on the recording machine (package.json engines).
- [ ] Step 9: That a CLI draft shows the teal CLI badge in the composer header (creation.method.badge.tsx maps CLI to teal). The CLI sends creationMethod CLI (commands.ts).

## Clean-up after recording

- [ ] **Rotate Key** in Settings > Agents / Dev on the demo workspace, whether or not it appeared on screen.
- [ ] Delete the demo webhook (**Settings > Webhooks > Delete**), and discard the request-inspector page.
- [ ] Run `postdelegate logout` and delete the CLI draft if `posts delete` was not run.
- [ ] Clear shell history for the recording session.
