# Publishing "Share to PostDelegate" to the Chrome Web Store

Owner checklist. Nothing here is automated: the extension is only published when you press Submit in the dashboard.

## 1. Build the zip

From the repository root:

```bash
pnpm install
pnpm --filter ./apps/extension run build      # builds apps/extension/dist
pnpm --filter ./apps/extension run zip        # creates apps/extension/postdelegate-extension-1.0.0.zip
```

Or in one step: `pnpm --filter ./apps/extension run package` (same as `pnpm run package:extension` from the root).

The zip is created from inside `dist/` so `manifest.json` is at the root of the archive, which is what the Web Store requires. Source maps are excluded. Check it:

```bash
unzip -l apps/extension/postdelegate-extension-1.0.0.zip   # manifest.json, popup.html, background.js, icons, assets/
```

Before building a new release, bump `version` in `apps/extension/package.json` (the manifest version is taken from there). Every upload must have a higher version than the one already in the store.

Optional: test the build locally first. Open `chrome://extensions`, turn on Developer mode, click "Load unpacked" and choose `apps/extension/dist`. Paste an API key, share a page.

## 2. One-time developer account

1. Go to https://chrome.google.com/webstore/devconsole and sign in with the Google account that should own the extension (use a company or role account, it cannot be transferred easily).
2. Accept the developer agreement and pay the one-time US$5 registration fee.
3. Under Account, set a contact email (support@postdelegate.com) and verify it. If you want the "verified publisher" badge, verify the domain postdelegate.com in the same place.

## 3. Create the item and upload

1. In the dashboard click "New item", upload `apps/extension/postdelegate-extension-1.0.0.zip`.
2. The dashboard parses the manifest. Fix any error it shows (it should show none).

## 4. Fill the listing from `store/listing.md`

All text to paste is in `apps/extension/store/listing.md`.

- Store listing tab: name, summary, description, category, language, homepage URL, support email. Upload the 128x128 icon (`apps/extension/public/icon-128.png`), the screenshots from the screenshot plan, and the small promo tile.
- Privacy tab: single purpose, each permission justification (activeTab, scripting, contextMenus, storage, host permission), "No remote code", the data usage boxes and the three certifications exactly as listed, privacy policy URL `https://app.postdelegate.com/legal/privacy`.
- Distribution tab: visibility Public, all regions, free of charge.

## 5. Submit

1. Click "Submit for review". Leave "Publish automatically after approval" ticked, or untick it to publish manually once approved.
2. Review typically takes from a few hours to a few days. Extensions that use `scripting` plus a host permission can take longer. Reviewers may email questions to the contact address, reply with the explanations from the permission justifications.
3. When approved, copy the store URL and add it to the PostDelegate site and app (for example a "Browser extension" link in the docs and in Settings, Public API). Do not link to it before it is live.

## 6. Updating later

Bump the version, rebuild and re-zip, open the item in the dashboard, "Package" tab, "Upload new package", review the listing if anything changed (permissions changes force a re-review and show a warning to existing users) and submit again.

## Rejection quick fixes

- "Use of permissions": re-read the justification text, it must match what the code does (read-only selection and og:image, nothing stored besides the API key).
- "Privacy policy": the policy page must be publicly reachable and mention the extension's data handling. Ask the legal page owner to add a short "Browser extension" paragraph if the reviewer asks.
- Do not add host permissions or new permissions without updating listing.md and the disclosures.
