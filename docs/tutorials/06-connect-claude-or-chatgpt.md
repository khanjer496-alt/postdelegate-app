# Video 6: Connect Claude or ChatGPT to PostDelegate and schedule by chatting

Add PostDelegate to Claude as a custom connector, approve access, ask the assistant to list channels and save a draft, check the result in the calendar, and learn how to stay in control and revoke access. ChatGPT and Claude Code are covered briefly.

| | |
| --- | --- |
| Target runtime | 3:00 (180 s), about 318 spoken words (about 106 words per minute) |
| Needs | A Claude account that can add custom connectors (depends on Claude plan and, on team plans, on the organisation; see the note in step 3). A ChatGPT account with Developer mode only if you film the ChatGPT clip. A PostDelegate plan with API access (all plans). One connected demo channel. |
| Account to record on | "Acme Coffee" demo workspace, demo Bluesky channel only. Ask for a **draft**, never "schedule", on camera. Use a Claude account that is not tied to your real inbox history. |
| Series | [Back to the series list](README.md) |

Label citations: see "How to read the label citations" in the [README](README.md). Anything marked [VERIFY] could not be confirmed from code and must be checked on screen before recording.

## Before you record

- PostDelegate does not provide an AI of its own: AI inside the app runs on the workspace's own OpenAI key, and PostDelegate never charges for AI. This video shows the assistant the viewer already has. Say that clearly and do not imply PostDelegate pays for or runs the AI.
- Remove any earlier PostDelegate connector from Claude so you film a clean add (Claude: Settings, Connectors). Also revoke earlier approvals in PostDelegate under **Settings > Apps > Approved Apps**.
- In Claude close old chats from the sidebar and hide your account name and email (blur the profile corner and the account menu).
- Make sure the Bluesky demo channel exists and has a short name such as "Acme Cafe Demo" so Claude can find it.
- Never paste an API key or the `/api/mcp/YOUR_API_KEY` address anywhere in the chat. This video uses the sign-in (OAuth) address only.
- Browser window for Claude must match the 1920x1080 setup and the same light or dark choice as the app.

## Shot list

### Step 1 (0:00 to 0:14, 14 s): Why connect your own AI

**On screen**

1. Calendar page, then a split screen graphic: a Claude chat on the left, the PostDelegate calendar on the right.

**Narration:** PostDelegate does not come with an AI of its own. Instead, you can connect the assistant you already use, like Claude or ChatGPT, and let it work with your calendar. Here is how.

**Caption:** Bring your own AI. PostDelegate has none built in.

### Step 2 (0:14 to 0:30, 16 s): Find the connector address in the app

**On screen**

1. Click **Settings** in the left menu, then the tab **Agents / Dev**. The page title is **Agents**.
2. The first card is **Connect your AI**. Show the four tabs: **Claude**, **ChatGPT**, **Claude Code** and **Cursor / VS Code / other**.
3. Stay on **Claude**. Under **MCP server URL** the address `https://app.postdelegate.com/mcp-oauth-dynamic` is shown.
4. Click **Copy URL**. A toast confirms it was copied.

**Labels used**

- `Settings`: translation key `settings` (en/translation.json), used in `layout/top.menu.tsx`
- `Agents / Dev`: translation key `agents_dev` (en/translation.json), used in `layout/settings.component.tsx`
- `Agents`: translation key `agents` (en/translation.json), used in `public-api/public.component.tsx`
- `Connect your AI`: translation key `connect_your_ai` (en/translation.json), used in `public-api/public.component.tsx`
- `Claude`: fixed or default text in `public-api/public.component.tsx` (no entry in translation.json)
- `ChatGPT`: fixed or default text in `public-api/public.component.tsx` (no entry in translation.json)
- `Claude Code`: fixed or default text in `public-api/public.component.tsx` (no entry in translation.json)
- `Cursor / VS Code / other`: translation key `connect_tab_other` (en/translation.json), used in `public-api/public.component.tsx`
- `MCP server URL`: translation key `mcp_server_url` (en/translation.json), used in `public-api/public.component.tsx`
- `Copy URL`: translation key `copy_url` (en/translation.json), used in `public-api/public.component.tsx`

**Narration:** In PostDelegate, open Settings, then Agents and Dev. The Connect your AI card has a tab for Claude, ChatGPT, and more. Copy the server address. It signs you in, so there is no key to copy.

**Caption:** Settings > Agents / Dev > Connect your AI

**Notes**

- The page needs a plan with API access (tier public_api, settings.component.tsx). All four plans have it (docs billing.md).
- The address on screen is derived from the configured server address. Docs mcp.md says: if the app shows a different base address than the docs, use the one from the app. Confirm it reads `https://app.postdelegate.com/mcp-oauth-dynamic`.
- Do not scroll down to the **API Key** or **MCP with an API key** cards on this shot. They contain a partly masked key.

- [VERIFY] The exact address printed under **MCP server URL** on production.

### Step 3 (0:30 to 0:52, 22 s): Add the custom connector in Claude

**On screen**

1. Switch to Claude (claude.ai in the browser, or the desktop app). Open **Settings**, then **Connectors**.
2. Click **Add custom connector**. In the name field type `PostDelegate`. In the server URL field paste the copied address.
3. Click **Add**. In the list click **Connect** next to PostDelegate.

**Labels used**

- `Settings`: external app (not PostDelegate). Wording not checked in this repo. [VERIFY]
- `Connectors`: external app (not PostDelegate). Wording not checked in this repo. [VERIFY]
- `Add custom connector`: external app (not PostDelegate). Wording not checked in this repo. [VERIFY]
- `Add`: external app (not PostDelegate). Wording not checked in this repo. [VERIFY]
- `Connect`: external app (not PostDelegate). Wording not checked in this repo. [VERIFY]

**Narration:** In Claude, go to Settings, then Connectors, and choose Add custom connector. Name it PostDelegate and paste the address. Click Add, then Connect.

**Caption:** Claude: Settings > Connectors > Add custom connector

**Notes**

- These steps follow PostDelegate's in-app text (tk:connect_claude_step_1 to _4) and docs mcp/claude.md. Claude's own menus are owned by Anthropic and may be renamed.
- On Claude Team and Enterprise plans an owner first adds the connector under Organization settings > Connectors (tk:connect_claude_note). Whether custom connectors are available depends on the Claude plan and organisation, not on PostDelegate (docs mcp/claude.md).

- [VERIFY] Claude's current menu names and button labels (Settings, Connectors, Add custom connector, Add, Connect) on the day you record.
- [VERIFY] Whether your Claude plan allows custom connectors.

### Step 4 (0:52 to 1:10, 18 s): Sign in and approve access

**On screen**

1. A PostDelegate page opens in the browser. If you are signed out you see a button **Sign in to PostDelegate**: click it, sign in, and you return to this page.
2. Slowly point out: the app name, the line that says where you will be sent after you decide, and the list "Access your integrations and channels", "Create and schedule posts on your behalf", "Read your post analytics".
3. Click **Authorize**. (The other button is **Deny**.)

**Labels used**

- `Sign in to PostDelegate`: fixed or default text in `oauth/authorize.component.tsx` (no entry in translation.json)
- `Access your integrations and channels`: fixed or default text in `oauth/authorize.component.tsx` (no entry in translation.json)
- `Create and schedule posts on your behalf`: fixed or default text in `oauth/authorize.component.tsx` (no entry in translation.json)
- `Read your post analytics`: fixed or default text in `oauth/authorize.component.tsx` (no entry in translation.json)
- `Authorize`: fixed or default text in `oauth/authorize.component.tsx` (no entry in translation.json)
- `Deny`: fixed or default text in `oauth/authorize.component.tsx` (no entry in translation.json)

**Narration:** PostDelegate asks you to approve. Read it. Claude can see your channels, create and schedule posts, and read your analytics. Only continue if you started this connection. Then click Authorize.

**Caption:** Read what it can do. Then Authorize.

**Notes**

- These words are written in English directly in the page (oauth/authorize.component.tsx), not taken from the translation file. The docs say "approve"; the button says **Authorize**. Report to docs owner.
- For an assistant that registered itself, the page adds: "This application registered itself and its name is not verified, only continue if you started this connection and recognize that address." Read that out. It is the main safety check.

### Step 5 (1:10 to 1:28, 18 s): Ask Claude to list your channels

**On screen**

1. Back in Claude the connector shows as connected. Start a new chat and make sure the PostDelegate connector is switched on for this chat.
2. Type and send: `List my PostDelegate channels.`
3. Claude asks permission to use a PostDelegate tool. Click the option that allows it once.
4. Claude answers with the demo channel list (name and network).

**Labels used**

- `Allow`: external app (not PostDelegate). Wording not checked in this repo. [VERIFY]

**Narration:** Start a chat and make sure the connector is on. Ask something small first: list my PostDelegate channels. Claude asks for permission before it uses a tool. Allow it, and it answers with your channels.

**Caption:** Start small: "List my PostDelegate channels."

**Notes**

- The tool behind this is `integrationList` (docs mcp/tools.md). Show the tool name if Claude's tool panel displays it.

- [VERIFY] How Claude asks for tool permission (wording and options) and where the per-chat connector toggle lives in the current Claude interface.

### Step 6 (1:28 to 1:56, 28 s): Ask for a draft

**On screen**

1. Type and send: `Write a short post announcing our new maple oat latte and save it as a draft on my Acme Cafe Demo Bluesky channel for tomorrow at 9am. Show me the preview link.`
2. Claude shows its tool calls: it reads the Bluesky rules (`integrationSchema`) and then creates the post (`integrationSchedulePostTool`). Approve each prompt.
3. Speed up the waiting 4x with a small "fast forward" mark. Slow down on the answer: the text of the post, "draft", and a preview link.

**Labels used**

- `Allow`: external app (not PostDelegate). Wording not checked in this repo. [VERIFY]

**Narration:** Now ask for a draft. Say draft, not schedule, so you can check it first. Claude reads the rules for Bluesky, such as the three hundred character limit, writes the post, and saves it. It gives you a preview link.

**Caption:** Say "draft" so you can check it first

**Notes**

- Prompt mirrors the example in docs mcp/claude.md. Docs mcp.md: ask for a draft first; each created post returns a preview link of the form `https://app.postdelegate.com/p/POST_ID?share=true`.
- Never ask for "schedule" or "post now" while filming against the live channel.

- [VERIFY] That Claude picks the demo channel by name and creates a draft dated tomorrow at 9am. Re-run until the answer is clean. If the date comes out wrong, say the date explicitly in the prompt.

### Step 7 (1:56 to 2:18, 22 s): Check the preview and the calendar

**On screen**

1. Click the preview link in Claude. A new tab opens titled **PostDelegate Preview** showing the post. Keep the address bar out of the shot.
2. Switch to the PostDelegate **Calendar**. Go to tomorrow. A card starting with **Draft:** is there.
3. Click the card. In the composer header, next to **Create Post**, a purple **MCP** badge shows. Hover it: the tooltip says **Created via MCP**.
4. Do not click Schedule. Close with X and **Yes, close it!**.

**Labels used**

- `Draft`: translation key `draft` (en/translation.json), used in `launches/calendar.tsx`
- `Create Post`: translation key `create_post_title` (en/translation.json), used in `new-launch/manage.modal.tsx`
- `MCP`: fixed or default text in `launches/creation.method.badge.tsx` (no entry in translation.json)
- `Created via`: fixed or default text in `launches/creation.method.badge.tsx` (no entry in translation.json)
- `Yes, close it!`: translation key `yes_close_it` (en/translation.json), used in `new-launch/manage.modal.tsx`

**Narration:** Open the preview link to see how it reads. Then check your calendar. There it is, saved as a draft, and marked as created by MCP. Nothing is scheduled until you say so.

**Caption:** Drafts stay drafts until you schedule them

**Notes**

- Docs mcp.md says posts created this way are labelled so you can tell them apart "on the calendar". In the code the badge appears in the composer header for the person who owns the post, and on the calendar card only when an admin is impersonating a customer (calendar.tsx showCreationMethodBadge). Show the composer header badge, not the card.

- [VERIFY] That the purple MCP badge appears in the composer header for a draft created by an assistant (manage.modal.tsx renders CreationMethodBadge next to the title).

### Step 8 (2:18 to 2:38, 20 s): Stay in control and revoke access

**On screen**

1. Graphic with three tips: 1. Say draft first. 2. Keep your assistant's approval prompts on. 3. Never paste a key into a chat.
2. In PostDelegate click **Settings**, the tab **Apps**. (Admins see two sub-tabs, **Apps** and **Approved Apps**: click **Approved Apps**.) The text reads "Applications you have authorized to access your PostDelegate account."
3. Find the Claude entry (it shows **Authorized on** and a date) and click **Revoke**. A toast says **Access revoked successfully**.

**Labels used**

- `Apps`: fixed or default text in `settings/apps.component.tsx` (no entry in translation.json)
- `Approved Apps`: fixed or default text in `settings/apps.component.tsx` (no entry in translation.json)
- `Applications you have authorized to access your PostDelegate account.`: fixed or default text in `approved-apps/approved-apps.component.tsx` (no entry in translation.json)
- `Authorized on`: fixed or default text in `approved-apps/approved-apps.component.tsx` (no entry in translation.json)
- `Revoke`: fixed or default text in `approved-apps/approved-apps.component.tsx` (no entry in translation.json)
- `Access revoked successfully`: fixed or default text in `approved-apps/approved-apps.component.tsx` (no entry in translation.json)

**Narration:** A few rules. Ask for drafts first. Keep your assistant's approval prompts switched on. And never paste a key into a chat. You can cut off access at any time: open Settings, then Apps, find the assistant, and choose Revoke.

**Caption:** Revoke any time: Settings > Apps > Approved Apps

**Notes**

- Docs mcp.md: these tokens do not expire on their own, so revoking is how you end access.
- Revoking here is the last step of the demo. You have to run Connect again in Claude to reconnect.

### Step 9 (2:38 to 2:54, 16 s): ChatGPT and Claude Code

**On screen**

1. Back on **Settings > Agents / Dev > Connect your AI**. Click the **ChatGPT** tab and let the numbered steps show for four seconds: Settings > Apps & Connectors > Advanced settings > Developer mode, then Create, name and address, OAuth, Create, Connect.
2. Click the **Claude Code** tab. The command `claude mcp add --transport http postdelegate https://app.postdelegate.com/mcp-oauth-dynamic` appears, then the steps "Start Claude Code, type /mcp, choose postdelegate and select Authenticate."
3. Point at **Read the full setup guide**.

**Labels used**

- `ChatGPT`: fixed or default text in `public-api/public.component.tsx` (no entry in translation.json)
- `Developer mode is not available on every ChatGPT plan.`: translation key `connect_chatgpt_note` (en/translation.json), used in `public-api/public.component.tsx`
- `Claude Code`: fixed or default text in `public-api/public.component.tsx` (no entry in translation.json)
- `Read the full setup guide`: translation key `connect_read_guide` (en/translation.json), used in `public-api/public.component.tsx`

**Narration:** ChatGPT works the same way. Turn on Developer mode, create a connector with the same address, and choose OAuth. Developer mode is not on every ChatGPT plan. Claude Code is one command. Full guides are linked below.

**Caption:** Same address works in ChatGPT, Claude Code and more

**Notes**

- Steps are the in-app text tk:connect_chatgpt_step_1 to _4 and tk:connect_code_step_1 and _2. OpenAI and Anthropic own those menus.

- [VERIFY] ChatGPT's current connector menus. If you do not film ChatGPT, keep this step as the in-app tab only and cut the narration to "Claude Code is one command. Full guides are linked below."

### Step 10 (2:54 to 3:00, 6 s): End card

**On screen**

1. End card with the logo, `app.postdelegate.com`, `postdelegate.com/docs/mcp`, and the next video title.

**Narration:** Next, API keys, webhooks and the command line. Thanks for watching.

**Caption:** Docs: postdelegate.com/docs/mcp

## Voice-over read-through

Read this straight through for the voice recording. Timecodes are where each line starts on the picture.

**0:00** PostDelegate does not come with an AI of its own. Instead, you can connect the assistant you already use, like Claude or ChatGPT, and let it work with your calendar. Here is how.

**0:14** In PostDelegate, open Settings, then Agents and Dev. The Connect your AI card has a tab for Claude, ChatGPT, and more. Copy the server address. It signs you in, so there is no key to copy.

**0:30** In Claude, go to Settings, then Connectors, and choose Add custom connector. Name it PostDelegate and paste the address. Click Add, then Connect.

**0:52** PostDelegate asks you to approve. Read it. Claude can see your channels, create and schedule posts, and read your analytics. Only continue if you started this connection. Then click Authorize.

**1:10** Start a chat and make sure the connector is on. Ask something small first: list my PostDelegate channels. Claude asks for permission before it uses a tool. Allow it, and it answers with your channels.

**1:28** Now ask for a draft. Say draft, not schedule, so you can check it first. Claude reads the rules for Bluesky, such as the three hundred character limit, writes the post, and saves it. It gives you a preview link.

**1:56** Open the preview link to see how it reads. Then check your calendar. There it is, saved as a draft, and marked as created by MCP. Nothing is scheduled until you say so.

**2:18** A few rules. Ask for drafts first. Keep your assistant's approval prompts switched on. And never paste a key into a chat. You can cut off access at any time: open Settings, then Apps, find the assistant, and choose Revoke.

**2:38** ChatGPT works the same way. Turn on Developer mode, create a connector with the same address, and choose OAuth. Developer mode is not on every ChatGPT plan. Claude Code is one command. Full guides are linked below.

**2:54** Next, API keys, webhooks and the command line. Thanks for watching.

## On-screen captions

- 0:00 to 0:14: Bring your own AI. PostDelegate has none built in.
- 0:14 to 0:30: Settings > Agents / Dev > Connect your AI
- 0:30 to 0:52: Claude: Settings > Connectors > Add custom connector
- 0:52 to 1:10: Read what it can do. Then Authorize.
- 1:10 to 1:28: Start small: "List my PostDelegate channels."
- 1:28 to 1:56: Say "draft" so you can check it first
- 1:56 to 2:18: Drafts stay drafts until you schedule them
- 2:18 to 2:38: Revoke any time: Settings > Apps > Approved Apps
- 2:38 to 2:54: Same address works in ChatGPT, Claude Code and more
- 2:54 to 3:00: Docs: postdelegate.com/docs/mcp

## End card

- Headline: Your AI. Your calendar. Your approval.
- Call to action: Connect it at app.postdelegate.com. Docs: postdelegate.com/docs/mcp.
- Next video: Video 7: API keys, webhooks and the CLI
- Keep the card on screen for 5 seconds (the last step of the shot list is this card).

## YouTube

**Title** (62 characters): Connect Claude or ChatGPT to PostDelegate and schedule by chat

**Description**

```text
PostDelegate has no built-in AI. Connect the assistant you already use, such as Claude or ChatGPT, over MCP. You will add the connector, approve access, ask for your channels, save a draft by chatting, check it in the calendar, and revoke access when you are done.

Chapters
0:00 Bring your own AI
0:14 Get the connector address
1:10 Chat with your calendar
2:18 Stay in control

Links
Open PostDelegate: https://app.postdelegate.com
MCP overview: https://postdelegate.com/docs/mcp
Connect Claude: https://postdelegate.com/docs/mcp/claude
Connect ChatGPT: https://postdelegate.com/docs/mcp/chatgpt
Connector address: https://app.postdelegate.com/mcp-oauth-dynamic
Previous video: [LINK to video 5]
Next video: [LINK to video 7]

Questions? support@postdelegate.com

Note: PostDelegate does not provide an AI. Claude and ChatGPT are separate products with their own plans and limits. Menu names in those apps can change.
```

**Tags:** PostDelegate, MCP, Claude connector, ChatGPT connector, schedule social media with AI, Model Context Protocol, bring your own AI

**Chapter check:** 4 chapters, first at 0:00, each at least 10 seconds. Timestamps above are computed from the step durations, so re-time them if you change a step.

## Docs page summary (one line)

> Connect your own Claude or ChatGPT to PostDelegate over MCP, save a draft by chatting, and revoke access any time.

## [VERIFY] checklist for this video

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

## Clean-up after recording

- [ ] Delete the draft the assistant created (calendar card, **Delete Post**).
- [ ] Revoke the approval in **Settings > Apps > Approved Apps** (**Revoke**), and remove the PostDelegate connector from Claude (and ChatGPT if you filmed it).
- [ ] Delete the Claude chat used for filming.
- [ ] If the full API key or an `/api/mcp/KEY` address ever appeared on screen, rotate the key in **Settings > Agents / Dev** (**Rotate Key**) and blur the footage.
