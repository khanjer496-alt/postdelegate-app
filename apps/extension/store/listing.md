# Chrome Web Store listing: Share to PostDelegate

Copy each section into the matching field of the Chrome Web Store developer dashboard.

## Store listing tab

**Name**

Share to PostDelegate

**Summary (short description, max 132 characters, 126 used)**

Share any page, selection or image to your PostDelegate channels. Post now, schedule, or save a draft without leaving the tab.

**Description**

Share to PostDelegate puts your PostDelegate workspace one click away from any web page.

Reading something worth sharing? Open the extension, pick your channels, and post it, schedule it or save it as a draft. No copy and paste, no switching tabs.

What it does
- Pre-fills a post from the page you are on: your selected text (if any), the page title and the link. Edit it before sending.
- Share from the right-click menu: "Share page to PostDelegate", "Share selection to PostDelegate" and "Share image to PostDelegate".
- Pick one or more of your connected PostDelegate channels. The extension remembers your last choice.
- Optionally attach the page's preview image (or the image you right-clicked).
- Post now, schedule for a date and time in your own timezone, or save as a draft to finish in the PostDelegate calendar.
- Clear messages if something needs your attention, such as an expired API key or a rate limit.

How to connect
1. Open PostDelegate at app.postdelegate.com and copy your workspace API key (Settings, Public API).
2. Click the extension icon and paste the key. It is checked with PostDelegate and stored only in this browser.

Your privacy
- The extension runs only when you click its icon or use its right-click menu. It does not read pages in the background.
- Your API key is stored locally in your browser (never synced) and is only ever sent to app.postdelegate.com.
- Page URL, title, selected text and image URL are sent to PostDelegate only when you press Post now, Schedule or Save as draft.
- No analytics, no tracking, no ads, no remote code.

You need a PostDelegate account with at least one connected channel. Learn more at https://postdelegate.com.

**Category**

Productivity (alternative: Social & Communication)

**Language**

English

**Official URL / Homepage**

https://postdelegate.com

**Support URL / email**

support@postdelegate.com

## Privacy tab

**Single purpose description**

Share the web page, selected text or image the user is viewing to the user's own PostDelegate channels (post now, schedule or save as a draft) using the user's PostDelegate API key.

**Permission justifications**

- `activeTab`: Used only when the user opens the extension or picks one of its right-click menu items. It gives temporary access to the current tab's title and URL so the post can be pre-filled, and lets the extension read the selected text and preview image of that one tab. No access to other tabs, and no access once the user navigates away.
- `scripting`: Used together with `activeTab` to run one small, bundled, read-only function in the current tab that returns the selected text and the page's `og:image` / `twitter:image` preview image URL. It does not modify the page and no remote code is injected. It runs only after a user action.
- `contextMenus`: Adds three right-click items ("Share page to PostDelegate", "Share selection to PostDelegate", "Share image to PostDelegate") that open the share popup pre-filled.
- `storage`: Stores the user's PostDelegate API key, workspace name and last selected channels in `chrome.storage.local` on the device (never `chrome.storage.sync`). A short-lived "pending share" (what the user right-clicked) is kept in `chrome.storage.session` for up to one minute so the popup can pre-fill, then deleted.
- Host permission `https://app.postdelegate.com/*`: Needed to call the PostDelegate public API (list channels, upload an image from a URL, create the post) with the user's API key. The extension contacts no other host.

**Remote code**

No. All code is bundled in the package. No `eval`, no remotely hosted scripts.

**Data usage disclosures (check boxes)**

Collected data types, because the extension handles them on the user's behalf:
- Authentication information: YES. The user's PostDelegate API key. Stored locally only and sent only to app.postdelegate.com in the `Authorization` header of API requests.
- Website content: YES. The URL, title, selected text and image URL of a page, sent to app.postdelegate.com only when the user explicitly presses Post now, Schedule or Save as draft.
- Personally identifiable information, health, financial, authentication of other services, personal communications, location, web history, user activity (keystrokes, clicks): NO.

Certifications (all three must be ticked):
- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to the item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

**Privacy policy URL**

https://app.postdelegate.com/legal/privacy

## Screenshot plan

Requirements: at least 1, up to 5 screenshots, 1280x800 (preferred) or 640x400, PNG or JPEG, no alpha, full bleed. Capture in a clean Chrome profile with a demo workspace (use demo channels, not customers' real accounts).

1. **Popup on an article** (hero): a well known, neutral article page in the background, the popup open with pre-filled quote + title + URL, channels listed with avatars, "Post now" visible. Caption: "Share what you are reading in seconds".
2. **Right-click menu**: select a sentence on a page, right-click so the three "Share ... to PostDelegate" items show. Caption: "Share a page, a selection or an image from the right-click menu".
3. **Schedule**: popup with the date and time picker filled in and the "Schedule" button highlighted. Caption: "Schedule for later in your own timezone".
4. **Connect screen**: first-run screen with the API key field and the "Where do I find it?" link. Caption: "Connect once with your API key".
5. **Success state**: the "Scheduled" confirmation with the "Open calendar" button, next to the PostDelegate calendar in the background tab. Caption: "See it in your PostDelegate calendar".

Optional promo assets: small promo tile 440x280 (required to be featured; use the PostDelegate mark on the brand dark background #0e0e0e with the purple #5035bd accent and the text "Share to PostDelegate"), marquee 1400x560 (optional).

Store icon: 128x128 is in the package (`icon-128.png`).
