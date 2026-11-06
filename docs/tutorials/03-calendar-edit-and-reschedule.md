# Video 3: Your calendar: view, edit and reschedule posts

A tour of the four calendar views, how to create a post at a chosen time, edit or drag a post to a new time, what the hover actions do, how to share a preview with a client, and how to set time slots.

| | |
| --- | --- |
| Target runtime | 2:32 (152 s), about 290 spoken words (about 114 words per minute) |
| Needs | The demo Bluesky channel and at least three demo posts spread over two weeks: two drafts and one scheduled post two weeks ahead (build them in 2 minutes before recording). Optionally one already-published post on the demo channel for the green check mark. |
| Account to record on | "Acme Coffee" demo workspace, demo Bluesky channel only. Everything in this video can be done with drafts, so use drafts on any account that is not the dedicated demo workspace. |
| Series | [Back to the series list](README.md) |

Label citations: see "How to read the label citations" in the [README](README.md). Anything marked [VERIFY] could not be confirmed from code and must be checked on screen before recording.

## Before you record

- Create drafts with the texts: "Behind the bar: how we dial in espresso every morning before doors open." and "Latte art class, Saturday 10am. Bring a friend, keep the heart-shaped mess." Put them on two different days next week.
- Switch the browser to light or dark to match the rest of the series. Start on the Week view with the current week showing.
- Have a throwaway name ready for the preview comment step ("Jordan").
- If you want the red error mark or the green check, use pre-made posts. Do not try to force an error on camera.

## Shot list

### Step 1 (0:00 to 0:08, 8 s): Overview of the calendar page

**On screen**

1. Calendar page in Week view. Left: **Channels**. Centre: seven day columns with hour rows. Top: the date range with arrows and **Today**, the customer and channel pickers, and **Day Week Month**.

**Labels used**

- `Channels`: translation key `channels` (en/translation.json), used in `launches/launches.component.tsx`
- `Today`: translation key `today` (en/translation.json), used in `launches/filters.tsx`
- `Day`: translation key `day` (en/translation.json), used in `launches/filters.tsx`
- `Week`: translation key `week` (en/translation.json), used in `launches/filters.tsx`
- `Month`: translation key `month` (en/translation.json), used in `launches/filters.tsx`

**Narration:** Your calendar shows everything you have planned. Let us look at the four ways to see it.

**Caption:** Everything you have planned, in one place

### Step 2 (0:08 to 0:26, 18 s): Day, Week and Month

**On screen**

1. Click **Day**. The page shows your preferred time slots for the day, with faded channel pictures where you can add a post.
2. Click **Week**. Seven columns, a thin line shows the current time on today.
3. Click **Month**. Day numbers with small post cards. If a day has more than three posts, a **+ Show more** link appears.
4. Use the left and right arrows next to the date range to move one day, week or month, then click **Today** to jump back.

**Labels used**

- `Day`: translation key `day` (en/translation.json), used in `launches/filters.tsx`
- `Week`: translation key `week` (en/translation.json), used in `launches/filters.tsx`
- `Month`: translation key `month` (en/translation.json), used in `launches/filters.tsx`
- `Today`: translation key `today` (en/translation.json), used in `launches/filters.tsx`
- `+ Show more`: translation key `show_more` (en/translation.json), used in `launches/calendar.tsx`

**Narration:** Day shows your time slots. Week is the best overview. Month is the big picture. Use the arrows to move forward or back, and Today to jump home.

**Caption:** Day, Week and Month. Today jumps back.

- [VERIFY] What Day view looks like when the channel has no time slots yet (calendar.tsx builds the day from the slots and the posts of the day). Add a slot in step 9 first if Day looks empty.

### Step 3 (0:26 to 0:40, 14 s): The list view

**On screen**

1. At the right end of the filter row there are two small icon buttons, calendar and list. Click the list icon.
2. The posts are grouped by day. Click the filters in turn: **All**, **Scheduled**, **Draft**, **Published**.
3. Point at **Page 1 of N** and the arrows next to it.
4. Click the calendar icon to go back to Week.

**Labels used**

- `All`: fixed or default text in `launches/filters.tsx` (no entry in translation.json)
- `Scheduled`: fixed or default text in `launches/filters.tsx` (no entry in translation.json)
- `Draft`: translation key `draft` (en/translation.json), used in `launches/filters.tsx`
- `Published`: fixed or default text in `launches/filters.tsx` (no entry in translation.json)
- `Page`: fixed or default text in `launches/filters.tsx` (no entry in translation.json)

**Narration:** The list view shows your posts in order. Filter it to scheduled, drafts, or already published. It is perfect for a quick check.

**Caption:** List view: filter by All, Scheduled, Draft, Published

- [VERIFY] The list toggle has no text label on desktop (it is a pair of icons, filters.tsx setCalendarView and setList). The word List only appears on phones (tk:list). Confirm which icon is which on screen.

### Step 4 (0:40 to 0:52, 12 s): Create a post at a chosen time

**On screen**

1. Back in Week view. Hover an empty hour cell in the future. A **+** appears.
2. Click it. The composer opens with that exact date and time already set.
3. Show that cells in the past are striped and cannot take posts: hover one and the hint **Date passed** appears. Close the composer without saving (X at the top right, then **Yes, close it!**).

**Labels used**

- `Date passed`: fixed or default text in `apps/frontend/src/app/global.scss` (no entry in translation.json)
- `Yes, close it!`: translation key `yes_close_it` (en/translation.json), used in `new-launch/manage.modal.tsx`

**Narration:** Click the plus on any empty slot to create a post for that exact time. Past slots are blocked, so you can not schedule into the past by accident.

**Caption:** Click + on an empty slot to plan a post for that time

### Step 5 (0:52 to 1:08, 16 s): Open and edit a post

**On screen**

1. Click the body of the card "Behind the bar...". The composer opens with the post loaded.
2. Edit a few words in the text. Point at the bottom bar: a red **Delete Post** button is there, and the big button reads **Schedule** for a draft (**Update** for an already scheduled post).
3. Click **Save as draft**. A toast **Updated successfully** appears.

**Labels used**

- `Delete Post`: translation key `delete_post` (en/translation.json), used in `new-launch/manage.modal.tsx`
- `Schedule`: translation key `schedule` (en/translation.json), used in `new-launch/manage.modal.tsx`
- `Update`: translation key `update` (en/translation.json), used in `new-launch/manage.modal.tsx`
- `Save as draft`: translation key `save_as_draft` (en/translation.json), used in `new-launch/manage.modal.tsx`
- `Updated successfully`: translation key `updated_successfully` (en/translation.json), used in `new-launch/manage.modal.tsx`

**Narration:** Click any post to open it and change anything. A draft offers Schedule, a scheduled post offers Update. You can move it between draft and scheduled whenever you like, until it publishes.

**Caption:** Click a post to edit it

**Notes**

- A post that already published asks "What do you want to do?" with **Just update the post details** or **Republish the post** when you save it (manage.modal.tsx). Do not demo this on a live channel.

### Step 6 (1:08 to 1:22, 14 s): Drag a post to a new time

**On screen**

1. In Week view press and hold the card "Latte art class...", drag it to a later hour or another day and release.
2. The card jumps to the new cell. Reload the page (Cmd+R) to prove it stuck.
3. Try to drop it on a past cell: it is refused.

**Labels used**

- `What do you want to do?`: translation key `what_do_you_want_to_do` (en/translation.json), used in `launches/calendar.tsx`
- `Reschedule the post`: translation key `reschedule_post` (en/translation.json), used in `launches/calendar.tsx`
- `Just update the post details`: translation key `just_update_post_details` (en/translation.json), used in `launches/calendar.tsx`

**Narration:** To reschedule, just drag the post to a new day or time. It moves right away. You can not drop it on the past.

**Caption:** Drag a post to reschedule it

**Notes**

- Only mention the dialog **What do you want to do?** if you demonstrate dragging a post that already published. It offers **Just update the post details** or **Reschedule the post** (republish), calendar.tsx lines 849 to 890.

### Step 7 (1:22 to 1:40, 18 s): Hover actions on a post

**On screen**

1. Hover a post card. Its top strip changes from the tag names into a row of small icons. Hover each one slowly to show its tooltip: **Preview Post**, **Duplicate Post**, **Delete Post**. On published posts you also see **Open Post** and **Post Statistics**.
2. Click **Preview Post**. A new browser tab opens with the page titled **PostDelegate Preview**.
3. On that page click **Share with a client**. A toast says **Link copied to clipboard**. Do not show the address bar contents.
4. Scroll to the **Comments** area and show the box **Add a comment**.

**Labels used**

- `Preview Post`: translation key `preview_post` (en/translation.json), used in `launches/calendar.tsx`
- `Duplicate Post`: translation key `duplicate_post` (en/translation.json), used in `launches/calendar.tsx`
- `Delete Post`: translation key `delete_post` (en/translation.json), used in `launches/calendar.tsx`
- `Open Post`: translation key `open_post` (en/translation.json), used in `launches/calendar.tsx`
- `Post Statistics`: translation key `post_statistics` (en/translation.json), used in `launches/calendar.tsx`
- `Share with a client`: translation key `share_with_a_client` (en/translation.json), used in `preview/copy.client.tsx`
- `Link copied to clipboard`: translation key `link_copied_to_clipboard` (en/translation.json), used in `preview/copy.client.tsx`
- `Comments`: translation key `comments` (en/translation.json), used in `preview/comments.components.tsx`
- `Add a comment`: translation key `add_a_comment` (en/translation.json), used in `preview/comments.components.tsx`

**Narration:** Hover a post to see its actions. Preview Post opens a page that shows exactly how it reads. Share with a client copies a link. Anyone with it can read the post and leave comments, without an account.

**Caption:** Share with a client: no account needed to comment

**Notes**

- Docs posts.md: comments on selected text lose their highlight if the text is edited afterwards.
- The preview address contains the post id. Delete the demo post afterwards so the link stops working, and keep the address bar out of shot.

- [VERIFY] That the hover strip in the card shows icons with tooltips (calendar.tsx components Preview, Duplicate, DeletePost) and no text labels. Confirm on screen.

### Step 8 (1:40 to 1:54, 14 s): Duplicate and delete

**On screen**

1. Hover the card "Behind the bar..." and click **Duplicate Post**. The composer opens with a copy of the text. Click the X and confirm **Yes, close it!**.
2. Hover a spare demo card and click **Delete Post**. A dialog reads **Are you sure?** and **Are you sure you want to delete this post?** Click **Yes, delete it!**. A toast reads **Post deleted successfully**.

**Labels used**

- `Duplicate Post`: translation key `duplicate_post` (en/translation.json), used in `launches/calendar.tsx`
- `Delete Post`: translation key `delete_post` (en/translation.json), used in `launches/calendar.tsx`
- `Are you sure?`: translation key `are_you_sure` (en/translation.json), used in `libraries/react-shared-libraries/src/helpers/delete.dialog.tsx`
- `Are you sure you want to delete this post?`: translation key `are_you_sure_you_want_to_delete_post` (en/translation.json), used in `launches/calendar.tsx`
- `Yes, delete it!`: translation key `yes_delete_it` (en/translation.json), used in `libraries/react-shared-libraries/src/helpers/delete.dialog.tsx`
- `Post deleted successfully`: translation key `post_deleted_successfully` (en/translation.json), used in `launches/calendar.tsx`

**Narration:** Duplicate Post makes a copy to reuse. Delete Post removes it after a quick check. A deleted scheduled post will not publish.

**Caption:** Duplicate to reuse. Delete to remove.

**Notes**

- From the calendar, Delete Post removes the whole post group, that means every channel the post was created for (calendar.tsx deletePost calls DELETE /posts/{group}). Inside the composer you are asked whether to delete from all channels or **Only from** one. Say this in the voice-over if you demo with two channels.

### Step 9 (1:54 to 2:12, 18 s): Time slots

**On screen**

1. In the **Channels** column hover the channel and click the three-dot menu on its right.
2. Click **Edit Time Slots**. The window **Time Table Slots** opens.
3. In **Add Time Slot** choose **Hour** and **Minutes**, click **Add**. The new time shows under **Scheduled Times**.
4. Click **Save Changes**.

**Labels used**

- `Edit Time Slots`: translation key `edit_time_slots` (en/translation.json), used in `launches/menu/menu.tsx`
- `Time Table Slots`: translation key `time_table_slots` (en/translation.json), used in `launches/menu/menu.tsx`
- `Add Time Slot`: translation key `add_time_slot` (en/translation.json), used in `launches/time.table.tsx`
- `Hour`: translation key `hour` (en/translation.json), used in `launches/time.table.tsx`
- `Minutes`: translation key `minutes` (en/translation.json), used in `launches/time.table.tsx`
- `Add`: translation key `add` (en/translation.json), used in `launches/time.table.tsx`
- `Scheduled Times`: fixed or default text in `launches/time.table.tsx` (no entry in translation.json)
- `Save Changes`: fixed or default text in `launches/time.table.tsx` (no entry in translation.json)

**Narration:** Every channel has time slots, the times you like to publish. Open the channel menu, choose Edit Time Slots, add a time and save. Create Post suggests the next free slot, so you never have to guess.

**Caption:** Time slots = your favourite times to post

**Notes**

- Docs posts.md: slots power the next-free-slot suggestions in the app and in the API find-slot endpoint.

### Step 10 (2:12 to 2:26, 14 s): What the marks mean

**On screen**

1. Graphic over a still of a calendar week: a green ring with a check mark = published; a red ring with an exclamation mark = could not publish (hover shows the error); "Draft:" before the text = not scheduled.
2. Cut to the bell icon at the top right and click it to show **Notifications**.

**Labels used**

- `Draft`: translation key `draft` (en/translation.json), used in `launches/calendar.tsx`
- `Notifications`: translation key `notifications` (en/translation.json), used in `notifications/notification.component.tsx`

**Narration:** A green check means published. A red mark means it could not publish, and hovering shows why. You also get a notification, so you can fix it and try again.

**Caption:** Green check = published. Red ! = needs attention.

- [VERIFY] Use a real error example from a pre-made demo post for the red mark (calendar.tsx shows the error text in a tooltip), or keep this as a graphic. Do not fake an error.

### Step 11 (2:26 to 2:32, 6 s): End card

**On screen**

1. End card with the logo, `app.postdelegate.com`, and the next video title.

**Narration:** Next, we look at your media library. Thanks for watching.

**Caption:** Next: the media library

## Voice-over read-through

Read this straight through for the voice recording. Timecodes are where each line starts on the picture.

**0:00** Your calendar shows everything you have planned. Let us look at the four ways to see it.

**0:08** Day shows your time slots. Week is the best overview. Month is the big picture. Use the arrows to move forward or back, and Today to jump home.

**0:26** The list view shows your posts in order. Filter it to scheduled, drafts, or already published. It is perfect for a quick check.

**0:40** Click the plus on any empty slot to create a post for that exact time. Past slots are blocked, so you can not schedule into the past by accident.

**0:52** Click any post to open it and change anything. A draft offers Schedule, a scheduled post offers Update. You can move it between draft and scheduled whenever you like, until it publishes.

**1:08** To reschedule, just drag the post to a new day or time. It moves right away. You can not drop it on the past.

**1:22** Hover a post to see its actions. Preview Post opens a page that shows exactly how it reads. Share with a client copies a link. Anyone with it can read the post and leave comments, without an account.

**1:40** Duplicate Post makes a copy to reuse. Delete Post removes it after a quick check. A deleted scheduled post will not publish.

**1:54** Every channel has time slots, the times you like to publish. Open the channel menu, choose Edit Time Slots, add a time and save. Create Post suggests the next free slot, so you never have to guess.

**2:12** A green check means published. A red mark means it could not publish, and hovering shows why. You also get a notification, so you can fix it and try again.

**2:26** Next, we look at your media library. Thanks for watching.

## On-screen captions

- 0:00 to 0:08: Everything you have planned, in one place
- 0:08 to 0:26: Day, Week and Month. Today jumps back.
- 0:26 to 0:40: List view: filter by All, Scheduled, Draft, Published
- 0:40 to 0:52: Click + on an empty slot to plan a post for that time
- 0:52 to 1:08: Click a post to edit it
- 1:08 to 1:22: Drag a post to reschedule it
- 1:22 to 1:40: Share with a client: no account needed to comment
- 1:40 to 1:54: Duplicate to reuse. Delete to remove.
- 1:54 to 2:12: Time slots = your favourite times to post
- 2:12 to 2:26: Green check = published. Red ! = needs attention.
- 2:26 to 2:32: Next: the media library

## End card

- Headline: Your calendar, under control
- Call to action: Try it at app.postdelegate.com. Docs: postdelegate.com/docs/posts.
- Next video: Video 4: The media library
- Keep the card on screen for 5 seconds (the last step of the shot list is this card).

## YouTube

**Title** (54 characters): PostDelegate calendar: edit, drag and reschedule posts

**Description**

```text
A tour of the PostDelegate calendar. See the Day, Week, Month and List views, create a post in a chosen slot, edit or drag a post to a new time, preview and share it with a client for comments, and set your time slots.

Chapters
0:00 The four views
0:40 Create, edit and move
1:22 Preview and share
1:54 Time slots

Links
Open PostDelegate: https://app.postdelegate.com
Posts, drafts and previews: https://postdelegate.com/docs/posts
Previous video: [LINK to video 2]
Next video: [LINK to video 4]

Questions? support@postdelegate.com
```

**Tags:** PostDelegate, social media calendar, reschedule posts, drag and drop scheduler, client preview, time slots

**Chapter check:** 4 chapters, first at 0:00, each at least 10 seconds. Timestamps above are computed from the step durations, so re-time them if you change a step.

## Docs page summary (one line)

> Use the Day, Week, Month and List views, edit or drag posts to new times, and share a preview with a client.

## [VERIFY] checklist for this video

- [ ] Step 2: What Day view looks like when the channel has no time slots yet (calendar.tsx builds the day from the slots and the posts of the day). Add a slot in step 9 first if Day looks empty.
- [ ] Step 3: The list toggle has no text label on desktop (it is a pair of icons, filters.tsx setCalendarView and setList). The word List only appears on phones (tk:list). Confirm which icon is which on screen.
- [ ] Step 7: That the hover strip in the card shows icons with tooltips (calendar.tsx components Preview, Duplicate, DeletePost) and no text labels. Confirm on screen.
- [ ] Step 10: Use a real error example from a pre-made demo post for the red mark (calendar.tsx shows the error text in a tooltip), or keep this as a graphic. Do not fake an error.

## Clean-up after recording

- [ ] Delete every demo draft and scheduled post (**Delete Post**).
- [ ] Remove the demo time slot if you do not want it (**Edit Time Slots**, delete the row, **Save Changes**).
- [ ] The preview link you copied dies with the post. Do not paste it anywhere.
