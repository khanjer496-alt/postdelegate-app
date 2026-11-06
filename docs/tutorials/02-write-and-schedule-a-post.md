# Video 2: Write and schedule your first post

Open the composer, pick a channel, write, add a picture and a thread reply, check the per-channel preview, choose a date, and understand the three ways to save: draft, schedule, post now.

| | |
| --- | --- |
| Target runtime | 2:22 (142 s), about 262 spoken words (about 111 words per minute) |
| Needs | One connected channel (the demo Bluesky account from video 1). One image file ready on disk (`latte.jpg`, under 10 MB). A second connected channel is nice for the per-channel preview but not required. |
| Account to record on | The "Acme Coffee" demo workspace. Use the dedicated demo Bluesky channel only. On any account that is connected to a real brand page, record **Save as draft** only. |
| Series | [Back to the series list](README.md) |

Label citations: see "How to read the label citations" in the [README](README.md). Anything marked [VERIFY] could not be confirmed from code and must be checked on screen before recording.

## Before you record

- Confirm the only channel selected in the composer is the demo Bluesky channel. A scheduled or "Post now" post really publishes there.
- Prepare `latte.jpg` (your own photo, a JPEG under 10 MB). Do not use someone else's photo.
- Draft the demo text (under 300 characters, no web address in it, otherwise a short-link question pops up): "Fall menu drops Friday. Maple oat latte, cinnamon cold brew and one very serious pumpkin loaf. First 20 guests get a free sample cup."
- Thread reply text: "Why maple? Our roaster found a small farm two towns over, and the beans pair well with it."
- Pick the schedule date as a day at least two weeks ahead so a failed clean-up cannot publish today.
- Dismiss the review card (**Not now**) and the Discord or chat bubble if either is on screen.

## Shot list

### Step 1 (0:00 to 0:08, 8 s): Open on the calendar

**On screen**

1. Calendar page, channel connected in the **Channels** column on the left, week view on the right.
2. Hover the **Create Post** button.

**Labels used**

- `Channels`: translation key `channels` (en/translation.json), used in `launches/launches.component.tsx`
- `Create Post`: translation key `create_new_post` (en/translation.json), used in `launches/new.post.tsx`

**Narration:** Let us write a post and schedule it. Everything starts on the Calendar page.

**Caption:** Write once, schedule everywhere

### Step 2 (0:08 to 0:18, 10 s): Click Create Post

**On screen**

1. Click **Create Post** (left column, under **Add Channel**).
2. The composer opens full screen. Left half: the title **Create Post** and the editor. Right half: the title **Post Preview**.
3. The date at the bottom is already set to the next free time slot.

**Labels used**

- `Create Post`: translation key `create_new_post` (en/translation.json), used in `launches/new.post.tsx`
- `Create Post`: translation key `create_post_title` (en/translation.json), used in `new-launch/manage.modal.tsx`
- `Post Preview`: translation key `post_preview` (en/translation.json), used in `new-launch/manage.modal.tsx`

**Narration:** Click Create Post. On the left you write your post. On the right you see a live preview.

**Caption:** Left: write. Right: preview.

**Notes**

- If your account has saved Sets, a window **Select a Set** appears first. A fresh demo workspace has none. If it does, click **Continue without set** (tk:continue_without_set).
- The suggested date comes from the find-slot request in new.post.tsx.

### Step 3 (0:18 to 0:28, 10 s): Pick the channel

**On screen**

1. At the top of the left half you see one round picture per channel. Hover the Bluesky picture (a tooltip shows the channel name).
2. Click it. The picture gets a purple ring and turns to colour.
3. Point at the big button at the bottom right. Before you choose a channel it reads **Check the circles above**. After you choose, it reads **Add to Calendar**.

**Labels used**

- `Check the circles above`: translation key `check_circles_above` (en/translation.json), used in `new-launch/manage.modal.tsx`
- `Add to Calendar`: translation key `add_to_calendar` (en/translation.json), used in `new-launch/manage.modal.tsx`

**Narration:** Choose where it goes by clicking a channel picture. The button at the bottom tells you to do this first, and changes once you have.

**Caption:** Click a channel picture to choose where it goes

### Step 4 (0:28 to 0:42, 14 s): Write the post

**On screen**

1. Click into the editor (placeholder **Write something …**) and type the demo text at a calm speed (speed up 2x in the edit if needed).
2. The right half now shows the preview with your channel name and text.
3. Hover the small character counter at the bottom right of the editor. A popup lists each selected channel with used and allowed characters, for example `120/300` for Bluesky.

**Labels used**

- `Write something …`: translation key `write_something` (en/translation.json), used in `new-launch/editor.tsx`

**Narration:** Write your post. The preview updates as you type, and the counter shows how much room you have. Bluesky allows three hundred characters.

**Caption:** Preview updates as you type. Bluesky limit: 300 characters.

- [VERIFY] Where the character counter sits and how the popup looks (launches/information.component.tsx shows a per-channel list such as "Name (Bluesky): 120/300" on hover). Confirm the position on screen before writing the voice-over cue.

### Step 5 (0:42 to 0:58, 16 s): Add a picture

**On screen**

1. Under the editor click **Insert Media**. The **Media Library** window opens.
2. Click **Upload**, choose `latte.jpg`, wait for the thumbnail to appear.
3. Click the thumbnail so it shows a numbered purple badge, then click **Add selected media**.
4. The picture shows under the text and in the preview.

**Labels used**

- `Insert Media`: translation key `insert_media` (en/translation.json), used in `media/media.component.tsx`
- `Media Library`: translation key `media_library` (en/translation.json), used in `media/media.component.tsx`
- `Upload`: translation key `upload` (en/translation.json), used in `media/media.component.tsx`
- `Add selected media`: translation key `add_selected_media` (en/translation.json), used in `media/media.component.tsx`

**Narration:** To add a picture, click Insert Media. Upload a file, or pick one you already uploaded. Select it, then choose Add selected media.

**Caption:** Insert Media: upload once, reuse anywhere

**Notes**

- Bluesky takes up to 4 images or 1 video per post (docs channels/bluesky.md). Images up to 10 MB, MP4 video up to 1 GB (docs media.md).

### Step 6 (0:58 to 1:10, 12 s): Add a reply in a thread

**On screen**

1. Below the editor click **Add post in a thread**. A second box appears.
2. Type the thread reply text. The preview now shows two posts.

**Labels used**

- `Add post in a thread`: translation key `add_post` (en/translation.json), used in `new-launch/add.post.button.tsx`

**Narration:** Bluesky supports threads. Add post in a thread adds a reply to your own post, so you can tell a longer story.

**Caption:** Add post in a thread: replies to yourself

**Notes**

- Label is the translation value of key add_post. The code default says "Add post"; the English file overrides it.

### Step 7 (1:10 to 1:28, 18 s): Preview and per-channel wording

**On screen**

1. Pan over the **Post Preview** column to show how the post will read.
2. Click the channel picture in the top row (not the globe). The editor greys out with the message "Click this button to exit global editing and customize the post for this channel" and a button **Edit content**.
3. Click **Edit content**. A pink dot and the line **Editing a Specific Network** appear. Change one word, watch the preview change.
4. Click **Back to global**, and confirm **Yes, go back to global mode** in the dialog.

**Labels used**

- `Post Preview`: translation key `post_preview` (en/translation.json), used in `new-launch/manage.modal.tsx`
- `Click this button to exit global editing and customize the post for this channel`: translation key `click_to_exit_global_editing` (en/translation.json), used in `new-launch/editor.tsx`
- `Edit content`: translation key `edit_content` (en/translation.json), used in `new-launch/editor.tsx`
- `Editing a Specific Network`: translation key `editing_a_specific_network` (en/translation.json), used in `new-launch/editor.tsx`
- `Back to global`: translation key `back_to_global` (en/translation.json), used in `new-launch/editor.tsx`
- `Yes, go back to global mode`: translation key `yes_go_back_to_global_mode` (en/translation.json), used in `new-launch/editor.tsx`

**Narration:** The preview shows how your post will look. If one channel needs different wording, click its picture and choose Edit content. Change it just for that channel. Back to global brings the shared text back.

**Caption:** Edit content = different wording for one channel

**Notes**

- Going back to global discards that channel's custom text. It is irreversible, so only do it on the demo post. With only one channel connected the demo still works; with two it reads better.

### Step 8 (1:28 to 1:42, 14 s): Choose the date and time

**On screen**

1. At the bottom right click the date button (calendar icon and a date such as `11/20/2026 09:00 AM`).
2. A picker opens with **Date** and **Time**. Pick a day two weeks ahead and set the time to 9:00 AM.
3. Click **Close**.

**Labels used**

- `Date`: translation key `date` (en/translation.json), used in `launches/helpers/date.picker.tsx`
- `Time`: translation key `time` (en/translation.json), used in `launches/helpers/date.picker.tsx`
- `Close`: translation key `close` (en/translation.json), used in `launches/helpers/date.picker.tsx`

**Narration:** Choose the day and time. Times follow the time zone in your settings. Then click Close.

**Caption:** Times follow your time zone setting

**Notes**

- US browsers (language en-US) see `MM/DD/YYYY hh:mm A`, others see `DD/MM/YYYY HH:mm` (launches/helpers/isuscitizen.utils.tsx). Record in en-US.
- The time zone is set under Settings > Global Settings > **Timezone** (settings/metric.component.tsx). Docs posts.md: dates follow the profile time zone.

### Step 9 (1:42 to 1:58, 16 s): Explain the three ways to save

**On screen**

1. Point at the three controls at the bottom right, left to right: the grey button **Save as draft**, the purple button **Add to Calendar**, and the small arrow on the purple button.
2. Hover the arrow (do NOT click the pink button that pops up above it). A pink button **Post now** appears.
3. Use a simple graphic over the screen: Save as draft = stored, never publishes. Add to Calendar = publishes at the chosen time. Post now = publishes right away.

**Labels used**

- `Save as draft`: translation key `save_as_draft` (en/translation.json), used in `new-launch/manage.modal.tsx`
- `Add to Calendar`: translation key `add_to_calendar` (en/translation.json), used in `new-launch/manage.modal.tsx`
- `Post now`: translation key `post_now` (en/translation.json), used in `new-launch/manage.modal.tsx`

**Narration:** You have three choices. Save as draft keeps it safe and never publishes. Add to Calendar schedules it for the time you picked. And the arrow gives you Post now, which sends it straight away.

**Caption:** Draft = safe. Add to Calendar = scheduled. Post now = immediate.

**Notes**

- Docs posts.md: drafts skip most settings checks, so half-finished work can be saved.
- Do not click **Post now** on a live account. If you want to show it, use only the dedicated demo Bluesky channel and delete the post on Bluesky afterwards.

### Step 10 (1:58 to 2:16, 18 s): Save it as a draft, then schedule it

**On screen**

1. Click **Save as draft**. A toast reads **Added successfully** and the composer closes.
2. On the calendar find the card starting with **Draft:** at your chosen date (switch to the right week or month with the arrows).
3. Click the card. The composer opens again. The big button now reads **Schedule**. A red **Delete Post** button shows at the bottom.
4. DEMO CHANNEL ONLY: click **Schedule**. Toast **Updated successfully**. The card loses the "Draft:" prefix.

**Labels used**

- `Save as draft`: translation key `save_as_draft` (en/translation.json), used in `new-launch/manage.modal.tsx`
- `Added successfully`: translation key `added_successfully` (en/translation.json), used in `new-launch/manage.modal.tsx`
- `Draft`: translation key `draft` (en/translation.json), used in `launches/calendar.tsx`
- `Schedule`: translation key `schedule` (en/translation.json), used in `new-launch/manage.modal.tsx`
- `Delete Post`: translation key `delete_post` (en/translation.json), used in `new-launch/manage.modal.tsx`
- `Updated successfully`: translation key `updated_successfully` (en/translation.json), used in `new-launch/manage.modal.tsx`

**Narration:** Let us save this as a draft. It shows up on the calendar marked Draft. When it is ready, open it and click Schedule. Now it will publish on its own at the time you chose.

**Caption:** Draft first, schedule when it is ready

**Notes**

- On a live account stop after the draft is saved. Scheduling a draft arms it for real publication.
- Sequence matters for the labels: a new post says **Add to Calendar**, an existing draft says **Schedule**, an existing scheduled post says **Update** (manage.modal.tsx scheduleLabel).

- [VERIFY] Whether the "Draft:" prefix is visible in the week view on a narrow card. calendar.tsx puts it before the post text inside the card.

### Step 11 (2:16 to 2:22, 6 s): End card

**On screen**

1. End card: PostDelegate logo, `app.postdelegate.com`, next video title.

**Narration:** Next, see how to move, edit and review everything on your calendar. Thanks for watching.

**Caption:** Next: your calendar, edits and reschedules

## Voice-over read-through

Read this straight through for the voice recording. Timecodes are where each line starts on the picture.

**0:00** Let us write a post and schedule it. Everything starts on the Calendar page.

**0:08** Click Create Post. On the left you write your post. On the right you see a live preview.

**0:18** Choose where it goes by clicking a channel picture. The button at the bottom tells you to do this first, and changes once you have.

**0:28** Write your post. The preview updates as you type, and the counter shows how much room you have. Bluesky allows three hundred characters.

**0:42** To add a picture, click Insert Media. Upload a file, or pick one you already uploaded. Select it, then choose Add selected media.

**0:58** Bluesky supports threads. Add post in a thread adds a reply to your own post, so you can tell a longer story.

**1:10** The preview shows how your post will look. If one channel needs different wording, click its picture and choose Edit content. Change it just for that channel. Back to global brings the shared text back.

**1:28** Choose the day and time. Times follow the time zone in your settings. Then click Close.

**1:42** You have three choices. Save as draft keeps it safe and never publishes. Add to Calendar schedules it for the time you picked. And the arrow gives you Post now, which sends it straight away.

**1:58** Let us save this as a draft. It shows up on the calendar marked Draft. When it is ready, open it and click Schedule. Now it will publish on its own at the time you chose.

**2:16** Next, see how to move, edit and review everything on your calendar. Thanks for watching.

## On-screen captions

- 0:00 to 0:08: Write once, schedule everywhere
- 0:08 to 0:18: Left: write. Right: preview.
- 0:18 to 0:28: Click a channel picture to choose where it goes
- 0:28 to 0:42: Preview updates as you type. Bluesky limit: 300 characters.
- 0:42 to 0:58: Insert Media: upload once, reuse anywhere
- 0:58 to 1:10: Add post in a thread: replies to yourself
- 1:10 to 1:28: Edit content = different wording for one channel
- 1:28 to 1:42: Times follow your time zone setting
- 1:42 to 1:58: Draft = safe. Add to Calendar = scheduled. Post now = immediate.
- 1:58 to 2:16: Draft first, schedule when it is ready
- 2:16 to 2:22: Next: your calendar, edits and reschedules

## End card

- Headline: You scheduled a post
- Call to action: Try it at app.postdelegate.com. Docs: postdelegate.com/docs/posts.
- Next video: Video 3: Your calendar: view, edit and reschedule
- Keep the card on screen for 5 seconds (the last step of the shot list is this card).

## YouTube

**Title** (61 characters): How to write and schedule a social media post in PostDelegate

**Description**

```text
Open the composer, pick a channel, add a picture and a thread reply, check the preview, choose a date, and learn the difference between Save as draft, Add to Calendar and Post now. This video uses a Bluesky channel.

Chapters
0:00 Open the composer
0:28 Write your post
0:42 Add media
1:10 Preview and per-channel edits
1:28 Choose when it publishes

Links
Open PostDelegate: https://app.postdelegate.com
Creating and scheduling posts: https://postdelegate.com/docs/posts
Bluesky limits: https://postdelegate.com/docs/channels/bluesky
Previous video: [LINK to video 1]
Next video: [LINK to video 3]

Questions? support@postdelegate.com
```

**Tags:** PostDelegate, schedule social media posts, content calendar, post composer, Bluesky, draft vs scheduled

**Chapter check:** 5 chapters, first at 0:00, each at least 10 seconds. Timestamps above are computed from the step durations, so re-time them if you change a step.

## Docs page summary (one line)

> Write a post, add media and threads, preview it per channel, then save it as a draft, schedule it or post it now.

## [VERIFY] checklist for this video

- [ ] Step 4: Where the character counter sits and how the popup looks (launches/information.component.tsx shows a per-channel list such as "Name (Bluesky): 120/300" on hover). Confirm the position on screen before writing the voice-over cue.
- [ ] Step 10: Whether the "Draft:" prefix is visible in the week view on a narrow card. calendar.tsx puts it before the post text inside the card.

## Clean-up after recording

- [ ] Open every demo post on the calendar and click **Delete Post** (confirm **Yes, delete it!**). Deleting a scheduled post stops it from publishing.
- [ ] If you used **Post now** on the demo channel, delete the post on Bluesky too. Deleting a published post in PostDelegate only removes it from PostDelegate (docs mcp/tools.md, deletePostTool).
- [ ] Delete `latte.jpg` from the Media page if you do not want it in the demo library.
