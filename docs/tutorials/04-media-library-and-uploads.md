# Video 4: The media library: upload once, reuse in every post

Upload images and video to the media library, find and preview them, delete what you do not need, reuse files in the composer, reorder them, and add alt text to a picture.

| | |
| --- | --- |
| Target runtime | 2:05 (125 s), about 205 spoken words (about 98 words per minute) |
| Needs | Three demo files on disk: `latte.jpg` (JPEG, under 10 MB), `pumpkin-loaf.png` (PNG, under 10 MB) and `pour.mp4` (an MP4 you filmed, short, under 1 GB). Optional: a throwaway `notes.txt` to show a rejected file type. |
| Account to record on | "Acme Coffee" demo workspace. Start with an empty media library so the empty state shows. Use a fresh workspace, or delete the demo files first. |
| Series | [Back to the series list](README.md) |

Label citations: see "How to read the label citations" in the [README](README.md). Anything marked [VERIFY] could not be confirmed from code and must be checked on screen before recording.

## Before you record

- The media library is shared by the whole workspace. Do not record on a workspace that holds real client media.
- Use only photos and video you made yourself. Do not use stock or brand material you are not licensed to show.
- Put the files in one clearly named folder so the file picker looks tidy (no personal folders or names in the path).
- Delete any old files from **Media** so the first thing you show is the empty state.

## Shot list

### Step 1 (0:00 to 0:12, 12 s): Open Media

**On screen**

1. On the Calendar page click **Media** in the left menu. The page title is **Media**.
2. The library is empty: the message **You don't have any media yet** shows, with **Select or upload pictures (maximum 1 GB per upload).** and **You can also drag & drop pictures.** and an **Upload** button.

**Labels used**

- `Media`: translation key `media` (en/translation.json), used in `layout/top.menu.tsx`
- `You don't have any media yet`: translation key `you_dont_have_any_media_yet` (en/translation.json), used in `media/media.component.tsx`
- `Select or upload pictures (maximum 1 GB per upload).`: fixed or default text in `media/media.component.tsx` (no entry in translation.json)
- `You can also drag & drop pictures.`: translation key `you_can_drag_drop_pictures` (en/translation.json), used in `media/media.component.tsx`
- `Upload`: translation key `upload` (en/translation.json), used in `media/media.component.tsx`

**Narration:** The media library keeps every picture and video in one place, so you upload a file once and reuse it in as many posts as you like.

**Caption:** Upload once. Reuse everywhere.

**Notes**

- The "1 GB per upload" figure is in the app text. Docs media.md also says images up to 10 MB and MP4 video up to 1 GB, and nothing else (no audio).

### Step 2 (0:12 to 0:30, 18 s): Upload files

**On screen**

1. Click **Upload**. In the file dialog select `latte.jpg`, `pumpkin-loaf.png` and `pour.mp4` together and confirm.
2. A thin progress bar runs across the top while they upload. Three tiles appear. The video tile shows a still frame.

**Labels used**

- `Upload`: translation key `upload` (en/translation.json), used in `media/media.component.tsx`

**Narration:** Click Upload and choose your files. Images can be up to ten megabytes. Videos must be MP4, up to a gigabyte. You can pick several files at once.

**Caption:** Images up to 10 MB. MP4 video up to 1 GB.

**Notes**

- Accepted formats: JPEG, PNG, GIF, WebP, AVIF, BMP, TIFF and MP4 (docs media.md). Speed up the progress bar in the edit if it is slow.

### Step 3 (0:30 to 0:40, 10 s): Drag and drop

**On screen**

1. Drag one more image from the folder window straight onto the page. A drop target appears and the file uploads.

**Narration:** You can also just drag files from your computer and drop them onto the page.

**Caption:** Or drag and drop

- [VERIFY] The look of the drop target. The DropFiles component handles the drop (media.component.tsx); the composer text for the same idea is "Drop your files here to upload" (tk:drop_files_here_to_upload). Confirm which overlay appears on the Media page.

### Step 4 (0:40 to 1:00, 20 s): Search, preview and delete

**On screen**

1. Click the search box (placeholder **Search by file name**), type `latte`. Only matching tiles stay. Clear the box.
2. Hover a tile. You see the file name along the bottom, an expand icon in the middle and a small delete circle at the top right.
3. Click the expand icon to open a large preview, then close it.
4. On a spare tile click the delete circle. The dialog says **Are you sure you want to delete the image?** Click **Yes, delete it!** (the other button is **No, cancel!**).

**Labels used**

- `Search by file name`: fixed or default text in `media/media.component.tsx` (no entry in translation.json)
- `Are you sure you want to delete the image?`: translation key `are_you_sure_you_want_to_delete_the_image` (en/translation.json), used in `media/media.component.tsx`
- `Yes, delete it!`: translation key `yes_delete_it` (en/translation.json), used in `libraries/react-shared-libraries/src/helpers/delete.dialog.tsx`
- `No, cancel!`: translation key `no_cancel` (en/translation.json), used in `libraries/react-shared-libraries/src/helpers/delete.dialog.tsx`

**Narration:** Search by file name to find a file fast. Hover a picture to preview it or delete it. Deleting asks you to confirm first. The library lists newest files first.

**Caption:** Search by name. Hover to preview or delete.

**Notes**

- Docs media.md: newest files first, 18 per page. A page control appears under the grid when there are more than 18 files.
- Deleting a file here does not remove it from posts that already used it. Do not claim otherwise.

### Step 5 (1:00 to 1:18, 18 s): Use media in a post

**On screen**

1. Go to **Calendar**, click **Create Post** and pick the demo channel.
2. Under the editor click **Insert Media**. The window **Media Library** opens with the same files.
3. Click `latte.jpg`, then `pour.mp4`. Each gets a numbered purple badge in the order you clicked. Click **Add selected media**.
4. Mention the other button, **Cancel**, and the **Upload** button inside this window.

**Labels used**

- `Create Post`: translation key `create_new_post` (en/translation.json), used in `launches/new.post.tsx`
- `Insert Media`: translation key `insert_media` (en/translation.json), used in `media/media.component.tsx`
- `Media Library`: translation key `media_library` (en/translation.json), used in `media/media.component.tsx`
- `Add selected media`: translation key `add_selected_media` (en/translation.json), used in `media/media.component.tsx`
- `Cancel`: translation key `cancel` (en/translation.json), used in `media/media.component.tsx`
- `Upload`: translation key `upload` (en/translation.json), used in `media/media.component.tsx`

**Narration:** In a post, click Insert Media to open the same library. Click the files you want, in the order you want them, then choose Add selected media.

**Caption:** Insert Media opens the same library

**Notes**

- Bluesky allows 4 images or 1 video per post, not both. Selecting one image and one video will be refused by the validation when you try to save. For this demo pick two images instead, or one video alone.

- [VERIFY] Which combination to show. Docs channels/bluesky.md says images and video cannot be mixed on Bluesky. Use two images (`latte.jpg` and `pumpkin-loaf.png`) on camera and keep the video for a separate YouTube clip if you want it.

### Step 6 (1:18 to 1:40, 22 s): Reorder and add alt text

**On screen**

1. Under the editor the chosen files appear as small squares. Drag one by its small corner handle to swap the order.
2. Hover a square: a small settings icon appears. Click it. The window **Media Settings** opens.
3. In the field **Alt Text (for accessibility)** (placeholder "Describe the image/video content...") type `A latte with maple-leaf foam art`.
4. Click **Save Changes**.
5. Also show the purple bar at the bottom of the editor, **Thumbnails & alt text**, with its line "Click a media item to set its alt text, or its thumbnail if it is a video." (this is the same thing from a second place).

**Labels used**

- `Media Settings`: translation key `media_settings` (en/translation.json), used in `media/media.component.tsx`
- `Alt Text (for accessibility)`: fixed or default text in `launches/helpers/media.settings.component.tsx` (no entry in translation.json)
- `Save Changes`: fixed or default text in `launches/helpers/media.settings.component.tsx` (no entry in translation.json)
- `Thumbnails & alt text`: translation key `thumbnails_and_alt_text` (en/translation.json), used in `new-launch/media.settings.section.tsx`
- `Click a media item to set its alt text, or its thumbnail if it is a video.`: translation key `media_settings_section_description` (en/translation.json), used in `new-launch/media.settings.section.tsx`

**Narration:** Drag a picture to change the order. Hover it and open its settings to add alt text, a short description for people who use screen readers. For a video you can also choose a thumbnail.

**Caption:** Add alt text so everyone can follow along

**Notes**

- Docs media.md: thumbnails are sent to every channel that supports them; YouTube may ignore one on Shorts and needs a phone-verified channel for custom thumbnails.

- [VERIFY] Where the Thumbnails & alt text bar sits. manage.modal.tsx renders it inside a collapsible purple bar at the bottom of the editor that is labelled **Settings** in global mode. Confirm that you have to open that bar first.

### Step 7 (1:40 to 1:54, 14 s): Which files can go in a post

**On screen**

1. Graphic: a short list. "Library accepts: JPEG, PNG, GIF, WebP, AVIF, BMP, TIFF, MP4." "Posts accept: .png .jpg .jpeg .gif .webp .mp4."
2. Optional insert (3 seconds): drag `notes.txt` onto the Media page. A red message appears saying the file type is not allowed.

**Narration:** One thing to know. The library stores a few more formats than a post can use. For posts, stick to PNG, JPEG, GIF, WebP, or MP4.

**Caption:** Posts accept png, jpg, jpeg, gif, webp, mp4

**Notes**

- Docs media.md callout: AVIF, BMP and TIFF can be stored in the library but cannot be attached to a post.

- [VERIFY] The rejected-file message. media/new.uploader.tsx builds: File type "..." is not allowed for file "...". Allowed types: ... Show it only if it appears as described, otherwise keep just the graphic.

### Step 8 (1:54 to 2:00, 6 s): Close and clean up the demo post

**On screen**

1. Click the X at the top right of the composer, confirm **Yes, close it!** (nothing is saved).

**Labels used**

- `Yes, close it!`: translation key `yes_close_it` (en/translation.json), used in `new-launch/manage.modal.tsx`

**Narration:** That is the media library. Next, working together with a team and your clients.

**Caption:** Next: teams and customers

### Step 9 (2:00 to 2:05, 5 s): End card

**On screen**

1. End card with the logo, `app.postdelegate.com`, and the next video title.

**Narration:** Thanks for watching.

**Caption:** Docs: postdelegate.com/docs/media

## Voice-over read-through

Read this straight through for the voice recording. Timecodes are where each line starts on the picture.

**0:00** The media library keeps every picture and video in one place, so you upload a file once and reuse it in as many posts as you like.

**0:12** Click Upload and choose your files. Images can be up to ten megabytes. Videos must be MP4, up to a gigabyte. You can pick several files at once.

**0:30** You can also just drag files from your computer and drop them onto the page.

**0:40** Search by file name to find a file fast. Hover a picture to preview it or delete it. Deleting asks you to confirm first. The library lists newest files first.

**1:00** In a post, click Insert Media to open the same library. Click the files you want, in the order you want them, then choose Add selected media.

**1:18** Drag a picture to change the order. Hover it and open its settings to add alt text, a short description for people who use screen readers. For a video you can also choose a thumbnail.

**1:40** One thing to know. The library stores a few more formats than a post can use. For posts, stick to PNG, JPEG, GIF, WebP, or MP4.

**1:54** That is the media library. Next, working together with a team and your clients.

**2:00** Thanks for watching.

## On-screen captions

- 0:00 to 0:12: Upload once. Reuse everywhere.
- 0:12 to 0:30: Images up to 10 MB. MP4 video up to 1 GB.
- 0:30 to 0:40: Or drag and drop
- 0:40 to 1:00: Search by name. Hover to preview or delete.
- 1:00 to 1:18: Insert Media opens the same library
- 1:18 to 1:40: Add alt text so everyone can follow along
- 1:40 to 1:54: Posts accept png, jpg, jpeg, gif, webp, mp4
- 1:54 to 2:00: Next: teams and customers
- 2:00 to 2:05: Docs: postdelegate.com/docs/media

## End card

- Headline: Upload once, reuse everywhere
- Call to action: Try it at app.postdelegate.com. Docs: postdelegate.com/docs/media.
- Next video: Video 5: Teams and customers
- Keep the card on screen for 5 seconds (the last step of the shot list is this card).

## YouTube

**Title** (58 characters): PostDelegate media library: upload, search and reuse files

**Description**

```text
See how the PostDelegate media library works. Upload images and MP4 video, drag and drop, search by file name, preview and delete, then reuse the same files in any post and add alt text for accessibility.

Chapters
0:00 The Media page
0:40 Find, preview and delete
1:00 Use media in a post

Links
Open PostDelegate: https://app.postdelegate.com
Media library guide: https://postdelegate.com/docs/media
Previous video: [LINK to video 3]
Next video: [LINK to video 5]

Questions? support@postdelegate.com
```

**Tags:** PostDelegate, media library, upload images and video, alt text, social media scheduler, content library

**Chapter check:** 3 chapters, first at 0:00, each at least 10 seconds. Timestamps above are computed from the step durations, so re-time them if you change a step.

## Docs page summary (one line)

> Upload images and MP4 video once, search them, add alt text and reuse them in any post.

## [VERIFY] checklist for this video

- [ ] Step 3: The look of the drop target. The DropFiles component handles the drop (media.component.tsx); the composer text for the same idea is "Drop your files here to upload" (tk:drop_files_here_to_upload). Confirm which overlay appears on the Media page.
- [ ] Step 5: Which combination to show. Docs channels/bluesky.md says images and video cannot be mixed on Bluesky. Use two images (`latte.jpg` and `pumpkin-loaf.png`) on camera and keep the video for a separate YouTube clip if you want it.
- [ ] Step 6: Where the Thumbnails & alt text bar sits. manage.modal.tsx renders it inside a collapsible purple bar at the bottom of the editor that is labelled **Settings** in global mode. Confirm that you have to open that bar first.
- [ ] Step 7: The rejected-file message. media/new.uploader.tsx builds: File type "..." is not allowed for file "...". Allowed types: ... Show it only if it appears as described, otherwise keep just the graphic.

## Clean-up after recording

- [ ] Delete the demo files from **Media** unless they belong in the permanent demo library.
- [ ] Delete any demo post that was saved while testing.
- [ ] Remove `notes.txt` from disk.
