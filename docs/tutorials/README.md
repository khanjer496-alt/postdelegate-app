# PostDelegate tutorial videos

Scripts for a series of eight short how-to videos (about 20 minutes in total). Each script is a click-by-click shot list with narration, on-screen captions, timings, an end card, and a ready YouTube title, description and chapters.

Status: scripts only. Nothing has been recorded. Nothing in this folder was run against the live app: every label was read from the code and checked against the translation file, and anything that could not be confirmed from code is marked **[VERIFY]**.

## The series

| # | Video | Runtime | Needs | One-line summary for the docs page |
| --- | --- | --- | --- | --- |
| 1 | [Get started: sign up and connect your first channel](01-get-started-connect-bluesky.md) | 2:30 | Sign-up mailbox you control; demo Bluesky account with an app password | Sign up, start your trial and connect a Bluesky channel with an app password in about two minutes. |
| 2 | [Write and schedule your first post](02-write-and-schedule-a-post.md) | 2:22 | One connected demo channel; one image file | Write a post, add media and threads, preview it per channel, then save it as a draft, schedule it or post it now. |
| 3 | [Your calendar: view, edit and reschedule posts](03-calendar-edit-and-reschedule.md) | 2:32 | Demo channel and a few demo drafts | Use the Day, Week, Month and List views, edit or drag posts to new times, and share a preview with a client. |
| 4 | [The media library: upload once, reuse in every post](04-media-library-and-uploads.md) | 2:05 | Three demo files (JPEG, PNG, MP4) | Upload images and MP4 video once, search them, add alt text and reuse them in any post. |
| 5 | [Teams and customers: work together and keep clients apart](05-teams-and-customers.md) | 2:16 | Team plan or higher; two connected channels | Invite teammates with the right role, and group channels by customer so client work stays separate. |
| 6 | [Connect Claude or ChatGPT to PostDelegate and schedule by chatting](06-connect-claude-or-chatgpt.md) | 3:00 | Claude with custom connectors; one connected demo channel | Connect your own Claude or ChatGPT to PostDelegate over MCP, save a draft by chatting, and revoke access any time. |
| 7 | [API keys, webhooks and the command line](07-api-keys-webhooks-and-cli.md) | 2:54 | API-enabled plan; Node.js 18 or newer; a request-inspector address | Find your API key, receive a webhook when a post publishes, and create drafts from the command line. |
| 8 | [The PostDelegate affiliate program: links, codes and payouts](08-affiliate-program.md) | 1:51 | Any signed-in demo workspace | Find your referral links, read your commission statuses, set a custom code and add payout details. |

Total runtime: 19:30. Runtimes are the sum of the step durations in each script. Narration runs at roughly 100 to 135 words per minute (the number is printed in each script), which is a calm pace with room for the screen action.

### Suggested order of recording

1. Videos 1 to 4 use the same demo workspace. Record 2, 3 and 4 in one sitting so the demo posts and media you build for one are reused by the next.
2. Record 5 (teams and customers) after you have connected a second demo channel.
3. Record 6 (AI) and 7 (API, webhooks, CLI) last. They show a key and an authorization, so do them on a workspace whose key you can rotate straight away.
4. Record 8 (affiliates) any time, but do not publish it until the affiliate terms page is final (see its [VERIFY] list).

### Things to confirm before any recording

These apply to the whole series and are repeated in the individual scripts.

- Whether billing and the 7-day trial are switched on for new sign-ups on the day (video 1, step 4).
- Whether sign-up needs an email activation (video 1, step 3).
- That the demo workspace plan includes team members, webhooks and API access (videos 5, 6 and 7).
- That the `postdelegate` command line tool is on npm (video 7). The release notes in `deploy/postdelegate/PUBLISHING-SDK-CLI.md` say it was still unpublished on 30 October 2026.

## Recording setup

### Screen and browser

- Record a browser window whose page area is exactly **1920 by 1080** pixels, at **100 percent zoom** (press Cmd+0 on a Mac). Export 1080p, 16:9, 30 frames per second, H.264. On a Retina display record a 1920 by 1080 point region and let the recorder scale it.
- The app switches to a phone layout at narrow widths, so never go below about 1280 pixels wide. Desktop layout is what every script assumes.
- Use a clean Chrome profile named "PostDelegate Demo": no extensions showing in the toolbar, no bookmarks bar (Cmd+Shift+B hides it), no saved logins offered, autofill off, tab titles neutral. Keep the address bar visible only for scenes that show an address; otherwise crop it out in the edit.
- Turn on Do Not Disturb. Hide the Dock and the menu bar clock. Close every other window and app that could show a notification.
- Set the browser language to **English (United States)**. The calendar then uses `MM/DD/YYYY hh:mm A` dates (`launches/helpers/isuscitizen.utils.tsx`); other languages use `DD/MM/YYYY HH:mm`, which would not match the narration.
- Time zone: leave it on Automatic or set **Settings > Global Settings > Timezone** to one fixed zone for the whole series, so the times in videos 2 and 3 agree.

### Light or dark

Use **dark mode for the whole series.** It is the product's default (the `mode` cookie defaults to dark in `layout/mode.component.tsx`), so it matches what a new customer sees on their first visit. Switch modes with the sun or moon icon in the top bar. Do not mix modes inside a video. If a thumbnail needs more contrast, make it from a light-mode still, but keep the footage dark. Claude and ChatGPT should be in dark mode for video 6 to match.

### Clear the screen before you press record

- Dismiss the small review card at the bottom left with **Not now** (`reviews/review.prompt.tsx`). It appears for eligible accounts after some account age and published posts and can show up mid-take.
- Close any announcement banner at the top (`layout/announcement.banner.tsx`) and the Discord or chat bubble at the bottom right if it is configured (`layout/support.tsx`).
- Collapse nothing: leave the **Channels** column open, so the left side looks the same in every video.
- Check the top bar. Hide the email of the signed-in user, the workspace name if it is not "Acme Coffee", and any notification count.

### Cursor, pace and sound

- Increase the system cursor size one step and add a soft click highlight in the recorder. Move slowly. Pause one second before and after each click so the viewer can follow.
- Type at a natural speed. Speed up long waits (uploads, AI answers) by 4x and show a small fast-forward mark.
- Record the voice-over separately after the picture is locked. Calm and friendly, 100 to 140 words per minute, one take per step. Quiet room, pop filter, 48 kHz, around minus 16 LUFS when mixed. Music is optional and must sit well under the voice.
- Burn in the on-screen captions listed in each script (large, white text on a dark box, bottom third). Also upload an SRT file generated from the narration so captions work on YouTube. If you use a synthetic voice, switch on YouTube's disclosure for altered or synthetic content.
- Zoom the picture to 115 to 125 percent in the edit wherever small text matters (labels, toasts, tooltips).

## Demo workspace and content

Use one fictional workspace for the whole series.

| Item | Value |
| --- | --- |
| Workspace name (the **Company** field at sign-up) | Acme Coffee |
| Main demo channel | A dedicated Bluesky account created only for the tutorials, with a bio such as "Demo account for PostDelegate tutorials". Suggested display name "Acme Cafe Demo". |
| Second demo channel (videos 4 to 5) | A second throwaway Bluesky account, "Acme Bakery Demo" |
| Customers (video 5) | North Pier Bakery, Willow Tea House (fictional) |
| Teammate (video 5) | `teammate@example.com`, a reserved example address that cannot receive mail |
| Media | Your own photos and clips only: `latte.jpg`, `pumpkin-loaf.png`, `pour.mp4` |

Demo content themes, all about one imaginary coffee shop:

- Fall menu launch: maple oat latte, cinnamon cold brew, pumpkin loaf.
- Behind the bar: dialing in espresso before doors open.
- Events: Saturday latte art class.
- Community: loyalty day, a thank-you post.

Content rules:

- Bluesky allows 300 characters, so keep each demo post well under that.
- No web addresses in demo posts. A link makes PostDelegate ask whether to shorten it, which interrupts the scene.
- No real people, no real companies, no real prices, no health or earnings claims.
- Only use photos and video you made yourself.

## What NOT to show

Treat anything that appears on screen as public. Blur it in the edit, and rotate or revoke it afterwards.

| Do not show | Where it appears |
| --- | --- |
| Your real email address or any customer email | Sign-up and sign-in forms, the invited-member list (the list shows the part before the @), invite fields, the account corner of Claude and ChatGPT, mailbox scenes |
| The full API key | **Settings > Agents / Dev**, **API Key** card (use **Reveal** never), the onboarding step **Connect Your AI Agent** with the **API** tab, terminal history |
| The MCP address that contains a key (`/api/mcp/YOUR_API_KEY`), or a `Bearer` header with a key | **MCP with an API key** card in **Settings > Agents / Dev**, client config files |
| OAuth tokens (starting with `pos_`), authorization codes and the address bar during an OAuth redirect | The authorize page and the redirect back to Claude or ChatGPT |
| The Bluesky app password | The Bluesky page that shows it once, the **Password** field of the connect window |
| Invitation links, share and preview links, webhook inspector addresses | **Copy Link**, **Share with a client**, the webhook **URL** field |
| Card number, billing address, Stripe page | The plan step in video 1 (stop recording at the card form) |
| Payout email (PayPal) | The **Payout details** card in **Affiliates** |
| Your home folder name, username, computer name | Terminal prompt, the CLI line that prints the path of its saved config, the file picker, the Dock |
| Real client names and media | Customers and **Media** library on any workspace with real data |

## Keeping the account safe

- Record only on the dedicated "Acme Coffee" demo workspace, never on a workspace with real customers, real channels or a real brand account. The production app at https://app.postdelegate.com is live and anything you publish is public.
- Connect only the dedicated demo Bluesky accounts. Their names should make the demo status obvious.
- Prefer **Save as draft** for everything. A draft never publishes. Drafts are enough to show every screen.
- Use **Add to Calendar** (schedule) only on the demo channels, and only with a date at least two weeks away, so a missed clean-up cannot publish today.
- Use **Post now** only on a demo channel, only if you really need to show it, and delete the post on Bluesky straight afterwards. Deleting a published post in PostDelegate only removes it from PostDelegate; the post stays on Bluesky.
- When an AI assistant or the command line creates content, ask for a **draft** only.
- Never paste an API key, an invitation link or an OAuth address into a chat, the calendar or a post.

### After every session

- [ ] Delete every demo draft and scheduled post (**Delete Post** on the calendar).
- [ ] Delete any post that was published to a demo channel, on Bluesky as well.
- [ ] Delete the demo Bluesky app password (Bluesky: Settings, Privacy and security, App passwords) if the demo channel will not be used again.
- [ ] Revoke any assistant you approved (**Settings > Apps > Approved Apps > Revoke**) and remove the connector from Claude or ChatGPT.
- [ ] **Rotate Key** in **Settings > Agents / Dev** if the key was on screen at any point.
- [ ] Delete test webhooks (**Settings > Webhooks > Delete**) and the request-inspector page.
- [ ] Remove demo teammates, demo customers and extra demo channels. A channel with posts cannot be deleted until its posts are deleted.
- [ ] Delete demo files from **Media**.
- [ ] If a real card started a trial, cancel it from **Billing** (**Cancel Subscription**) unless the account is the permanent demo workspace.
- [ ] Run `postdelegate logout` and clear the shell history.

## How to read the label citations

Every on-screen label in a shot list is followed by where it comes from:

- "translation key `x`" means the text is the value of key `x` in `libraries/react-shared-libraries/src/translation/locales/en/translation.json`, and the file after "used in" is the component, under `apps/frontend/src/components`. The English file wins over the default string written in the code (i18next), so a code default such as "Save as Draft" is shown as "Save as draft". The labels in the scripts use the values from the translation file.
- "fixed or default text in `file`" means the text is written in the component, or is the default string of a key that does not exist in the translation file. There is nothing else to look up.
- "external app" means a screen that PostDelegate does not own (Claude, ChatGPT, Bluesky). Those names come from PostDelegate's own instructions and docs, and need to be checked on the day. All of them are marked [VERIFY].

Quick check from the repository root, for example for the **Create Post** button:

```bash
grep -n '"create_new_post"' libraries/react-shared-libraries/src/translation/locales/en/translation.json
grep -rn "create_new_post" apps/frontend/src/components/launches/new.post.tsx
```

The scripts were produced with a small checker that confirmed, for every citation, that the translation key exists and holds exactly the quoted text, or that the quoted text appears in the cited file.

## Where the docs and the app disagree

Found while verifying the labels. The scripts follow the app, not the docs. These are worth fixing in the docs (or the app) before the videos go live, otherwise a viewer who reads the docs will see different words than the video shows.

- **Bluesky connect button.** `site/src/pages/docs/channels/bluesky.md` says "Save". The window is titled **Add Provider** and its button says **Connect** (`launches/add.provider.component.tsx`).
- **Sign-up form.** `site/src/pages/docs/getting-started.md` does not mention the required **Company** field. It becomes the workspace name and must be at least 3 characters.
- **Approve versus Authorize.** `site/src/pages/docs/mcp/claude.md` and `mcp.md` say "approve". The authorize page has **Authorize** and **Deny** buttons (`oauth/authorize.component.tsx`).
- **Team invite button.** `site/src/pages/docs/team.md` says the button is **Add another member** only once you already have some. The app always shows **Add another member**, because the owner is already in the list.
- **MCP label on the calendar.** `site/src/pages/docs/mcp.md` says assistant-created posts are labelled "on the calendar". The calendar card shows the badge only while an admin is impersonating a customer (`launches/calendar.tsx`). The badge shows in the composer header for the post's owner.
- **CLI help text.** `apps/cli/README.md` and the login prompt in `apps/cli/src/commands.ts` send people to "Settings > Public API". The key is on **Settings > Agents / Dev**.
- **Customer picker.** `site/src/pages/docs/team.md` calls it the **Customers** selector. In the app it is a person icon with the tooltip **Select Customer**, shown only when there is more than one customer.

## [VERIFY] index

Collected from the scripts. Each one also sits in the step it belongs to.

### Video 1: Get started

- [ ] Step 3: Whether email activation is switched on in production. The code only asks for it when an email provider is configured (auth.controller.ts register: activationRequired). If registration signs you straight in, delete the first screen line and shorten this step to 6 seconds.
- [ ] Step 4: That billing is enabled and the trial is offered to new accounts on the day you record (user.allowTrial and the billingEnabled variable). If not, delete this step and move the 14 seconds to step 6.
- [ ] Step 4: What new customers see right after the trial starts (whether the onboarding window of step 5 opens by itself or you have to use Add Channel on the Calendar page).
- [ ] Step 5: The onboarding window appears automatically right after sign-up on production (layout.context.tsx redirects to /launches?onboarding=true when the sign-up response carries the onboarding header).
- [ ] Step 7: Bluesky owns this screen. Its menu names (docs channels/bluesky.md says Settings, Privacy and security, App passwords) and the exact button labels can change. Check them on the day.
- [ ] Step 7: wording of the external (non-PostDelegate) labels "Settings", "Privacy and security", "App passwords"
- [ ] Step 9: The exact toast wording. continue.integration.tsx redirects with `msg=Channel Updated`, and launches.component.tsx shows that message as a toast, so a new channel most likely shows "Channel Updated" (the translation key channel_added, "Channel added", is only posted to the opener window).

### Video 2: Write and schedule a post

- [ ] Step 4: Where the character counter sits and how the popup looks (launches/information.component.tsx shows a per-channel list such as "Name (Bluesky): 120/300" on hover). Confirm the position on screen before writing the voice-over cue.
- [ ] Step 10: Whether the "Draft:" prefix is visible in the week view on a narrow card. calendar.tsx puts it before the post text inside the card.

### Video 3: Calendar, editing and rescheduling

- [ ] Step 2: What Day view looks like when the channel has no time slots yet (calendar.tsx builds the day from the slots and the posts of the day). Add a slot in step 9 first if Day looks empty.
- [ ] Step 3: The list toggle has no text label on desktop (it is a pair of icons, filters.tsx setCalendarView and setList). The word List only appears on phones (tk:list). Confirm which icon is which on screen.
- [ ] Step 7: That the hover strip in the card shows icons with tooltips (calendar.tsx components Preview, Duplicate, DeletePost) and no text labels. Confirm on screen.
- [ ] Step 10: Use a real error example from a pre-made demo post for the red mark (calendar.tsx shows the error text in a tooltip), or keep this as a graphic. Do not fake an error.

### Video 4: Media library and uploads

- [ ] Step 3: The look of the drop target. The DropFiles component handles the drop (media.component.tsx); the composer text for the same idea is "Drop your files here to upload" (tk:drop_files_here_to_upload). Confirm which overlay appears on the Media page.
- [ ] Step 5: Which combination to show. Docs channels/bluesky.md says images and video cannot be mixed on Bluesky. Use two images (`latte.jpg` and `pumpkin-loaf.png`) on camera and keep the video for a separate YouTube clip if you want it.
- [ ] Step 6: Where the Thumbnails & alt text bar sits. manage.modal.tsx renders it inside a collapsible purple bar at the bottom of the editor that is labelled **Settings** in global mode. Confirm that you have to open that bar first.
- [ ] Step 7: The rejected-file message. media/new.uploader.tsx builds: File type "..." is not allowed for file "...". Allowed types: ... Show it only if it appears as described, otherwise keep just the graphic.

### Video 5: Teams and customers

- [ ] Step 4: That copying a link with the toggle off creates no pending invitation you must delete later (the Teams list only shows accepted members). If a pending invite is recorded, remove it after recording.
- [ ] Step 6: The switcher only renders when the user belongs to more than one workspace (layout/organization.selector.tsx returns nothing for exactly one). It also needs the invited person to accept the invite first. The step ties together the invite flow and has not been traced end to end in code. Test with a second account before recording.
- [ ] Step 9: Drag and drop of a channel onto a group (launches.component.tsx: MenuGroupComponent useDrop and changeItemGroup). Confirm it works with the mouse in your recording browser.
- [ ] Step 10: That choosing a customer in the calendar filter hides other customers' posts, as described. filters.tsx passes the customer to the calendar query; confirm on screen with two posts.

### Video 6: Connect your own AI (MCP)

- [ ] Step 2: The exact address printed under **MCP server URL** on production.
- [ ] Step 3: Claude's current menu names and button labels (Settings, Connectors, Add custom connector, Add, Connect) on the day you record.
- [ ] Step 3: Whether your Claude plan allows custom connectors.
- [ ] Step 3: wording of the external (non-PostDelegate) labels "Settings", "Connectors", "Add custom connector", "Add", "Connect"
- [ ] Step 5: How Claude asks for tool permission (wording and options) and where the per-chat connector toggle lives in the current Claude interface.
- [ ] Step 5: wording of the external (non-PostDelegate) labels "Allow"
- [ ] Step 6: That Claude picks the demo channel by name and creates a draft dated tomorrow at 9am. Re-run until the answer is clean. If the date comes out wrong, say the date explicitly in the prompt.
- [ ] Step 6: wording of the external (non-PostDelegate) labels "Allow"
- [ ] Step 7: That the purple MCP badge appears in the composer header for a draft created by an assistant (manage.modal.tsx renders CreationMethodBadge next to the title).
- [ ] Step 9: ChatGPT's current connector menus. If you do not film ChatGPT, keep this step as the in-app tab only and cut the narration to "Claude Code is one command. Full guides are linked below."

### Video 7: API keys, webhooks and the CLI

- [ ] Step 3: Exact output format of the two calls on production (spacing, extra fields).
- [ ] Step 5: The exact field labels inside the Add webhook window (**Name**, **URL**, **Integrations**). They are fixed strings in webhooks.tsx; confirm they are not renamed.
- [ ] Step 7: That the `postdelegate` package is published to npm on the day you record. deploy/postdelegate/PUBLISHING-SDK-CLI.md says the name was unregistered on 30 October 2026 and publishing was still pending. Run `npm view postdelegate`. If it returns 404, skip this scene or build the CLI locally and say "coming soon". Do not claim it is on npm until it is.
- [ ] Step 7: Node.js 18 or newer is installed on the recording machine (package.json engines).
- [ ] Step 9: That a CLI draft shows the teal CLI badge in the composer header (creation.method.badge.tsx maps CLI to teal). The CLI sends creationMethod CLI (commands.ts).

### Video 8: Affiliate program

- [ ] Step 2: The percentage and months shown on production. They are env settings (AFFILIATE_COMMISSION_PERCENT, AFFILIATE_COMMISSION_MONTHS). Replace "thirty percent" and "twelve months" in the narration if the screen differs.
- [ ] Step 3: The day count shown in the **How it works** box on production.
- [ ] Step 4: The hold period (30 days by default, AFFILIATE_HOLD_DAYS) on production.
- [ ] Step 6: The minimum payout amount shown (AFFILIATE_MIN_PAYOUT_USD, default 50).
- [ ] Step 8: That /legal/affiliate-terms is live and final on the day you publish. The copy in the repo (deploy/postdelegate/legal-public/affiliate-terms.html) is marked "DRAFT for owner review". Do not publish this video until the terms are approved and linked.

## Publishing checklist

- [ ] Picture locked, voice-over recorded and matched to the step times in the script, captions burned in and an SRT uploaded.
- [ ] Every blurred area checked frame by frame at full size.
- [ ] Title, description and chapters pasted from the script. Replace each `[LINK to video N]` placeholder with the real address once the videos are uploaded.
- [ ] Chapters: first at 0:00, at least three, each at least 10 seconds. The timestamps in each script are computed from the step durations, so recompute them if the edit changes a step.
- [ ] Thumbnail 1280 by 720, under 2 MB, readable at small size, no real emails or keys in it.
- [ ] Playlist in the series order, end screen pointing to the next video, subscribe button.
- [ ] Add the one-line summary and the video to the matching docs page.
- [ ] Re-check every [VERIFY] item above against the live app on the day of publishing.
