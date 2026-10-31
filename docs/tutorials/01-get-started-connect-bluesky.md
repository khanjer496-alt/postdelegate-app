# Video 1: Get started: sign up and connect your first channel

A new customer signs up, optionally starts the trial, and connects a Bluesky account with an app password. Bluesky is used because it needs no platform approval, so this video keeps working while the other networks wait for review.

| | |
| --- | --- |
| Target runtime | 2:30 (150 s), about 330 spoken words (about 132 words per minute) |
| Needs | A browser with no PostDelegate session, a mailbox you control for the sign-up, and a dedicated demo Bluesky account with an app password already created (the app password is created on camera, then deleted). |
| Account to record on | A brand-new sign-up for the sign-up scenes. Record the later scenes on the prepared "Acme Coffee" demo workspace, because the plan step needs a card. Never enter a card number on camera. |
| Series | [Back to the series list](README.md) |

Label citations: see "How to read the label citations" in the [README](README.md). Anything marked [VERIFY] could not be confirmed from code and must be checked on screen before recording.

## Before you record

- Create the demo Bluesky account first and give it an obviously fake bio such as "Demo account for PostDelegate tutorials". Do not use a real brand account.
- Prepare an empty "Acme Coffee" workspace. If you cannot repeat a real sign-up, record steps 1 to 3 with a throwaway mailbox that you control, then record the rest in the prepared workspace and cut between them.
- Sign out and clear cookies for app.postdelegate.com so the sign-up page loads cleanly. Open https://app.postdelegate.com/auth.
- Browser language must be en-US (see README) so dates and buttons read the same as in the other videos.
- Blur in the edit: the email address, the password field, the Bluesky app password, and any activation link.

## Shot list

### Step 1 (0:00 to 0:12, 12 s): Cold open on the sign-up page

**On screen**

1. Browser at https://app.postdelegate.com/auth. The page shows the **Sign Up** heading, **Continue With** and the form.
2. Hold still for two seconds, then start the first move in step 2.

**Labels used**

- `Sign Up`: translation key `sign_up` (en/translation.json), used in `auth/register.tsx`
- `Continue With`: translation key `continue_with` (en/translation.json), used in `auth/register.tsx`

**Narration:** PostDelegate lets you write a post once and schedule it to every channel. Let us set up your account and connect your first channel, in about two minutes.

**Caption:** Set up PostDelegate in about two minutes

### Step 2 (0:12 to 0:28, 16 s): Create the account

**On screen**

1. Click the **Email Address** field and type the demo mailbox address.
2. Click the **Password** field and type a password (3 to 64 characters). It is masked on screen.
3. Click the **Company** field and type `Acme Coffee`. This becomes the workspace name. It must be at least 3 characters.
4. Move the pointer over the **Terms of Service** and **Privacy Policy** links without clicking.
5. Hover (do not click) the **Google** button to show the other way in.
6. Click **Create Account**.

**Labels used**

- `Email Address`: translation key `email_address` (en/translation.json), used in `auth/register.tsx`
- `Password`: translation key `label_password` (en/translation.json), used in `auth/register.tsx`
- `Company`: translation key `label_company` (en/translation.json), used in `auth/register.tsx`
- `Terms of Service`: translation key `terms_of_service` (en/translation.json), used in `auth/register.tsx`
- `Privacy Policy`: translation key `privacy_policy` (en/translation.json), used in `auth/register.tsx`
- `Google`: translation key `google` (en/translation.json), used in `auth/providers/google.provider.tsx`
- `Create Account`: translation key `create_account` (en/translation.json), used in `auth/register.tsx`

**Narration:** Enter your email and a password, then name your workspace. We will call ours Acme Coffee. If you prefer, you can continue with Google instead. Then choose Create Account.

**Caption:** Email, password, and a name for your workspace

**Notes**

- The field is called Company in the app, not Workspace. Say "name your workspace" in the voice-over and show the Company field. The existing docs page getting-started.md does not mention this field.
- Blur the email and password in the edit. Never reuse a real password.

### Step 3 (0:28 to 0:40, 12 s): Confirm the email and sign in

**On screen**

1. If the **Activate your account** page appears (it says **Thank you for registering!**), cut to the mailbox, open the activation message and click its link. Blur the mailbox and the link.
2. You land back in PostDelegate. If it asks you to sign in, use the **Sign In** page: fill **Email Address** and **Password**, then click **Sign in**.

**Labels used**

- `Activate your account`: translation key `activate_your_account` (en/translation.json), used in `auth/activate.tsx`
- `Thank you for registering!`: translation key `thank_you_for_registering` (en/translation.json), used in `auth/activate.tsx`
- `Sign In`: translation key `sign_in` (en/translation.json), used in `auth/login.tsx`
- `Sign in`: translation key `sign_in_1` (en/translation.json), used in `auth/login.tsx`

**Narration:** If we ask you to confirm your email, open the message and click the link. Then sign in. That is the only account step.

**Caption:** Confirm your email, then sign in

- [VERIFY] Whether email activation is switched on in production. The code only asks for it when an email provider is configured (auth.controller.ts register: activationRequired). If registration signs you straight in, delete the first screen line and shorten this step to 6 seconds.

### Step 4 (0:40 to 0:54, 14 s): Pick a plan and start the trial (only if billing is on)

**On screen**

1. If billing is enabled for new accounts, the page **Grow your social presence with PostDelegate** appears with **100% No-Risk Free Trial**, **Pay NOTHING for the first 7-days** and **Cancel anytime, from settings**.
2. Under **Choose a Plan** flick between **Monthly** and **Yearly**, then hover one plan card (Starter, Team, Pro, Ultimate).
3. Do NOT type a card on camera. Stop the capture at the payment form (button text **Pay $0 Today - Start your free trial!**) and cut to the next step, recorded on the prepared workspace.

**Labels used**

- `Grow your social presence with PostDelegate`: translation key `billing_postiz_grow_social` (en/translation.json), used in `billing/first.billing.component.tsx`
- `100% No-Risk Free Trial`: translation key `billing_no_risk_trial` (en/translation.json), used in `billing/first.billing.component.tsx`
- `Pay NOTHING for the first 7-days`: translation key `billing_pay_nothing_7_days` (en/translation.json), used in `billing/first.billing.component.tsx`
- `Cancel anytime, from settings`: translation key `billing_cancel_anytime` (en/translation.json), used in `billing/first.billing.component.tsx`
- `Choose a Plan`: translation key `billing_choose_plan` (en/translation.json), used in `billing/first.billing.component.tsx`
- `Monthly`: translation key `billing_monthly` (en/translation.json), used in `billing/first.billing.component.tsx`
- `Yearly`: translation key `billing_yearly` (en/translation.json), used in `billing/first.billing.component.tsx`
- `Pay $0 Today - Start your free trial!`: translation key `billing_pay_0_start_trial` (en/translation.json), used in `billing/embedded.billing.tsx`

**Narration:** Next you pick a plan. Every plan starts with a seven day trial. A card is needed to start it, but nothing is charged during the trial, and you can cancel from Settings at any time.

**Caption:** 7-day trial. Cancel anytime from Settings.

**Notes**

- Docs (billing.md): to check the card PostDelegate places a $1 authorization and voids it straight away. Say this only if you want to; the on-screen FAQ key faq_to_confirm_credit_card_information_postiz_will_hold carries the same wording.
- Plan names and prices ($19, $29, $39, $79) come from libraries/nestjs-libraries/src/database/prisma/subscriptions/pricing.ts. Do not read prices aloud, they can change.

- [VERIFY] That billing is enabled and the trial is offered to new accounts on the day you record (user.allowTrial and the billingEnabled variable). If not, delete this step and move the 14 seconds to step 6.
- [VERIFY] What new customers see right after the trial starts (whether the onboarding window of step 5 opens by itself or you have to use Add Channel on the Calendar page).

### Step 5 (0:54 to 1:04, 10 s): Open the channel setup window

**On screen**

1. The onboarding window opens over the Calendar page (address ends in `/launches?onboarding=true`). Step indicators read **Connect Channels** and **Connect Agents**.
2. Read out the title **Connect Your Channels** and the line below it, then point at **Click a channel to add it**.
3. If the window does not appear, close any dialog and use the Calendar page instead: click **Add Channel** at the top of the **Channels** column. The same tiles open in a window called **Add Channel**.

**Labels used**

- `Connect Channels`: translation key `connect_channels` (en/translation.json), used in `onboarding/onboarding.modal.tsx`
- `Connect Agents`: translation key `connect_agents` (en/translation.json), used in `onboarding/onboarding.modal.tsx`
- `Connect Your Channels`: translation key `connect_your_channels` (en/translation.json), used in `onboarding/onboarding.modal.tsx`
- `Click a channel to add it`: translation key `click_channel_to_add` (en/translation.json), used in `onboarding/onboarding.modal.tsx`
- `Add Channel`: translation key `add_channel` (en/translation.json), used in `launches/add.provider.component.tsx`
- `Channels`: translation key `channels` (en/translation.json), used in `launches/launches.component.tsx`

**Narration:** PostDelegate opens a short setup. A channel is any account or site you post to. You click one to connect it.

**Caption:** A channel is any account or site you post to

- [VERIFY] The onboarding window appears automatically right after sign-up on production (layout.context.tsx redirects to /launches?onboarding=true when the sign-up response carries the onboarding header).

### Step 6 (1:04 to 1:18, 14 s): Choose Bluesky and read the 2FA note

**On screen**

1. Hover the **Bluesky** tile. A tooltip appears: "We don’t currently support two-factor authentication. If it’s enabled on Bluesky, you’ll need to disable it." Hold it for three seconds.
2. Click the **Bluesky** tile. A window titled **Add Provider** opens with three fields.

**Labels used**

- `Bluesky`: fixed or default text in `libraries/nestjs-libraries/src/integrations/social/bluesky.provider.ts` (no entry in translation.json)
- `Add Provider`: translation key `add_provider_title` (en/translation.json), used in `launches/add.provider.component.tsx`

**Narration:** We will use Bluesky, because it needs no approval screen. You only need your handle and an app password. One note: two-factor sign-in is not supported, so turn it off on Bluesky if you use it.

**Caption:** Bluesky: a handle and an app password

**Notes**

- Tooltip text is the `toolTip` field of the Bluesky provider (bluesky.provider.ts line 239).

### Step 7 (1:18 to 1:34, 16 s): Create an app password on Bluesky (b-roll)

**On screen**

1. Cut to the Bluesky website or app, signed in as the demo account.
2. Open Settings, then Privacy and security, then App passwords, then add a new app password. Name it `PostDelegate` and create it.
3. Show the generated password for one second only, then copy it. Blur it in the edit completely.

**Labels used**

- `Settings`: external app (not PostDelegate). Wording not checked in this repo. [VERIFY]
- `Privacy and security`: external app (not PostDelegate). Wording not checked in this repo. [VERIFY]
- `App passwords`: external app (not PostDelegate). Wording not checked in this repo. [VERIFY]

**Narration:** On Bluesky, open Settings, then Privacy and security, then App passwords. Make a new one and call it PostDelegate. An app password is separate from your main password, and you can delete it whenever you like.

**Caption:** Bluesky Settings > Privacy and security > App passwords

**Notes**

- Delete this app password from Bluesky after recording (see clean-up).

- [VERIFY] Bluesky owns this screen. Its menu names (docs channels/bluesky.md says Settings, Privacy and security, App passwords) and the exact button labels can change. Check them on the day.

### Step 8 (1:34 to 1:48, 14 s): Fill in the Bluesky form

**On screen**

1. Back in the **Add Provider** window. Leave **Service** as the prefilled `https://bsky.social`.
2. Click **Identifier** and type the demo handle (for example `acme-coffee-demo.bsky.social`).
3. Click **Password** and paste the app password (masked).
4. Click **Connect**.

**Labels used**

- `Service`: fixed or default text in `libraries/nestjs-libraries/src/integrations/social/bluesky.provider.ts` (no entry in translation.json)
- `Identifier`: fixed or default text in `libraries/nestjs-libraries/src/integrations/social/bluesky.provider.ts` (no entry in translation.json)
- `Password`: fixed or default text in `libraries/nestjs-libraries/src/integrations/social/bluesky.provider.ts` (no entry in translation.json)
- `Connect`: translation key `connect` (en/translation.json), used in `launches/add.provider.component.tsx`

**Narration:** Back in PostDelegate, leave Service as it is. Type your handle as the identifier, paste the app password, and choose Connect.

**Caption:** Service stays https://bsky.social

**Notes**

- The three field labels come from the provider’s `customFields()` (bluesky.provider.ts lines 267 to 289). The submit button says Connect, not Save as the docs page channels/bluesky.md currently says. Report this to the docs owner.
- The handle you type is public, but still check the demo account name before you publish the video.

### Step 9 (1:48 to 2:00, 12 s): The channel is connected

**On screen**

1. PostDelegate redirects back to the Calendar page (`/launches?added=bluesky...`). A green toast appears.
2. In the onboarding window the line **Connected Channels (1)** now lists the Bluesky channel. If you used Add Channel instead, the channel appears in the **Channels** column on the left with its picture and a small Bluesky badge.

**Labels used**

- `Connected Channels`: translation key `connected_channels` (en/translation.json), used in `onboarding/onboarding.modal.tsx`
- `Channels`: translation key `channels` (en/translation.json), used in `launches/launches.component.tsx`

**Narration:** That is it. Your Bluesky account is connected and shows up on the left, with its picture. You can connect more channels the same way at any time.

**Caption:** Connected. Add more channels any time.

- [VERIFY] The exact toast wording. continue.integration.tsx redirects with `msg=Channel Updated`, and launches.component.tsx shows that message as a toast, so a new channel most likely shows "Channel Updated" (the translation key channel_added, "Channel added", is only posted to the opener window).

### Step 10 (2:00 to 2:10, 10 s): Skip the AI step

**On screen**

1. In the onboarding window click **Continue**. Step 2, **Connect Your AI Agent**, appears with the tabs **Connect your AI** and **API**.
2. Do not connect anything here. Click **Continue / Skip**.

**Labels used**

- `Continue`: translation key `continue` (en/translation.json), used in `onboarding/onboarding.modal.tsx`
- `Connect Your AI Agent`: translation key `connect_your_ai_agent` (en/translation.json), used in `onboarding/onboarding.modal.tsx`
- `Connect your AI`: translation key `connect_your_ai` (en/translation.json), used in `onboarding/onboarding.modal.tsx`
- `API`: translation key `api` (en/translation.json), used in `onboarding/onboarding.modal.tsx`
- `Continue / Skip`: translation key `continue_skip` (en/translation.json), used in `onboarding/onboarding.modal.tsx`

**Narration:** The next step is optional. You can connect your own AI assistant here. We cover that in another video, so for now, skip it.

**Caption:** Optional: connect your own AI assistant later

**Notes**

- On a plan without API access this step shows "Agent access is not available for your current plan or role" instead of the tabs (tk:agent_access_unavailable). Record on a plan that includes the API.

### Step 11 (2:10 to 2:24, 14 s): Tour of the calendar page

**On screen**

1. You are on the **Calendar** page. Slowly trace the left icon menu from top to bottom: **Calendar**, **Analytics**, **Media**, then at the bottom **Affiliates**, **Review**, **Billing**, **Settings**.
2. Point at the **Channels** column and the **Create Post** button under **Add Channel**.
3. Do not click **Create Post** yet, the next video starts there.

**Labels used**

- `Calendar`: translation key `calendar` (en/translation.json), used in `layout/top.menu.tsx`
- `Analytics`: translation key `analytics` (en/translation.json), used in `layout/top.menu.tsx`
- `Media`: translation key `media` (en/translation.json), used in `layout/top.menu.tsx`
- `Affiliates`: translation key `affiliates` (en/translation.json), used in `layout/top.menu.tsx`
- `Review`: translation key `review_menu` (en/translation.json), used in `layout/top.menu.tsx`
- `Billing`: translation key `billing` (en/translation.json), used in `layout/top.menu.tsx`
- `Settings`: translation key `settings` (en/translation.json), used in `layout/top.menu.tsx`
- `Create Post`: translation key `create_new_post` (en/translation.json), used in `launches/new.post.tsx`

**Narration:** This is your calendar. The menu on the left takes you to Analytics, your Media library, and Settings. Create Post is where you start writing. We do that in the next video.

**Caption:** Next: write and schedule your first post

**Notes**

- The **Billing** item only shows to admins when billing is enabled. The **Agent** item is hidden because AI features are off.
- If the small review card appears at the bottom left, dismiss it with **Not now** before recording (README has the checklist).

### Step 12 (2:24 to 2:30, 6 s): End card

**On screen**

1. Full-screen end card with the PostDelegate logo, the address `app.postdelegate.com` and the next video title.

**Narration:** Ready for more? Watch how to write and schedule your first post. Thanks for watching.

**Caption:** app.postdelegate.com

## Voice-over read-through

Read this straight through for the voice recording. Timecodes are where each line starts on the picture.

**0:00** PostDelegate lets you write a post once and schedule it to every channel. Let us set up your account and connect your first channel, in about two minutes.

**0:12** Enter your email and a password, then name your workspace. We will call ours Acme Coffee. If you prefer, you can continue with Google instead. Then choose Create Account.

**0:28** If we ask you to confirm your email, open the message and click the link. Then sign in. That is the only account step.

**0:40** Next you pick a plan. Every plan starts with a seven day trial. A card is needed to start it, but nothing is charged during the trial, and you can cancel from Settings at any time.

**0:54** PostDelegate opens a short setup. A channel is any account or site you post to. You click one to connect it.

**1:04** We will use Bluesky, because it needs no approval screen. You only need your handle and an app password. One note: two-factor sign-in is not supported, so turn it off on Bluesky if you use it.

**1:18** On Bluesky, open Settings, then Privacy and security, then App passwords. Make a new one and call it PostDelegate. An app password is separate from your main password, and you can delete it whenever you like.

**1:34** Back in PostDelegate, leave Service as it is. Type your handle as the identifier, paste the app password, and choose Connect.

**1:48** That is it. Your Bluesky account is connected and shows up on the left, with its picture. You can connect more channels the same way at any time.

**2:00** The next step is optional. You can connect your own AI assistant here. We cover that in another video, so for now, skip it.

**2:10** This is your calendar. The menu on the left takes you to Analytics, your Media library, and Settings. Create Post is where you start writing. We do that in the next video.

**2:24** Ready for more? Watch how to write and schedule your first post. Thanks for watching.

## On-screen captions

- 0:00 to 0:12: Set up PostDelegate in about two minutes
- 0:12 to 0:28: Email, password, and a name for your workspace
- 0:28 to 0:40: Confirm your email, then sign in
- 0:40 to 0:54: 7-day trial. Cancel anytime from Settings.
- 0:54 to 1:04: A channel is any account or site you post to
- 1:04 to 1:18: Bluesky: a handle and an app password
- 1:18 to 1:34: Bluesky Settings > Privacy and security > App passwords
- 1:34 to 1:48: Service stays https://bsky.social
- 1:48 to 2:00: Connected. Add more channels any time.
- 2:00 to 2:10: Optional: connect your own AI assistant later
- 2:10 to 2:24: Next: write and schedule your first post
- 2:24 to 2:30: app.postdelegate.com

## End card

- Headline: Your first channel is connected
- Call to action: Start at app.postdelegate.com. Docs: postdelegate.com/docs/getting-started. Add "7-day trial, cancel anytime from Settings" only if the trial is live when you publish [VERIFY].
- Next video: Video 2: Write and schedule your first post
- Keep the card on screen for 5 seconds (the last step of the shot list is this card).

## YouTube

**Title** (60 characters): PostDelegate setup: sign up and connect Bluesky in 2 minutes

**Description**

```text
Create your PostDelegate workspace and connect your first channel. We use Bluesky because it only needs your handle and an app password, so there is no approval screen to wait for. You will see the sign-up form, the plan step, the Bluesky app password, and your first connected channel.

Chapters
0:00 What you will do
0:12 Create your account
0:40 Choose a plan
1:04 Connect Bluesky
1:48 Your channel is connected
2:10 A quick look around

Links
Open PostDelegate: https://app.postdelegate.com
Getting started guide: https://postdelegate.com/docs/getting-started
Bluesky channel guide: https://postdelegate.com/docs/channels/bluesky
Next video: [LINK to video 2]

Questions? support@postdelegate.com
```

**Tags:** PostDelegate, social media scheduler, Bluesky, schedule posts, getting started, app password

**Chapter check:** 6 chapters, first at 0:00, each at least 10 seconds. Timestamps above are computed from the step durations, so re-time them if you change a step.

## Docs page summary (one line)

> Sign up, start your trial and connect a Bluesky channel with an app password in about two minutes.

## [VERIFY] checklist for this video

- [ ] Step 3: Whether email activation is switched on in production. The code only asks for it when an email provider is configured (auth.controller.ts register: activationRequired). If registration signs you straight in, delete the first screen line and shorten this step to 6 seconds.
- [ ] Step 4: That billing is enabled and the trial is offered to new accounts on the day you record (user.allowTrial and the billingEnabled variable). If not, delete this step and move the 14 seconds to step 6.
- [ ] Step 4: What new customers see right after the trial starts (whether the onboarding window of step 5 opens by itself or you have to use Add Channel on the Calendar page).
- [ ] Step 5: The onboarding window appears automatically right after sign-up on production (layout.context.tsx redirects to /launches?onboarding=true when the sign-up response carries the onboarding header).
- [ ] Step 7: Bluesky owns this screen. Its menu names (docs channels/bluesky.md says Settings, Privacy and security, App passwords) and the exact button labels can change. Check them on the day.
- [ ] Step 7: wording of the external (non-PostDelegate) labels "Settings", "Privacy and security", "App passwords"
- [ ] Step 9: The exact toast wording. continue.integration.tsx redirects with `msg=Channel Updated`, and launches.component.tsx shows that message as a toast, so a new channel most likely shows "Channel Updated" (the translation key channel_added, "Channel added", is only posted to the opener window).

## Clean-up after recording

- [ ] Delete the app password you created for the recording from Bluesky (Settings > Privacy and security > App passwords).
- [ ] If you used a real card for the plan step, cancel the trial from Billing (**Cancel Subscription**) unless the account is the long-lived demo workspace.
- [ ] Delete the throwaway sign-up mailbox messages (activation link).
