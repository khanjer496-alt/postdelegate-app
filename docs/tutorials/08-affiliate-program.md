# Video 8: The PostDelegate affiliate program: links, codes and payouts

Find your referral links, read the stats and statuses, set a custom code, add payout details, and understand the rules of the program. No income claims.

| | |
| --- | --- |
| Target runtime | 1:51 (111 s), about 243 spoken words (about 131 words per minute) |
| Needs | Any signed-in account (the Affiliates page shows for every role). A demo workspace where you are happy to set a custom code, because it can be set only once. |
| Account to record on | The "Acme Coffee" demo workspace. Do not set a custom code or payout email on an account you will keep using for real referrals. |
| Series | [Back to the series list](README.md) |

Label citations: see "How to read the label citations" in the [README](README.md). Anything marked [VERIFY] could not be confirmed from code and must be checked on screen before recording.

## Before you record

- The custom code can be chosen once and cannot be changed (tk:affiliates_vanity_locked). Either use the demo workspace and accept the code is used up, or show the typing and leave without clicking **Save**.
- Do not type a real PayPal address. The PayPal email is personal data, stored as plain text, and only used to pay the affiliate (tk:affiliates_payout_privacy). Show the empty field.
- The program figures are read from server settings. The in-app text fills in the numbers; the code defaults are 30 percent, 12 months, 30 day hold, 60 day tracking and a 50 USD minimum payout (affiliate.config.ts). The affiliate terms page is still marked as a draft for owner review (deploy/postdelegate/legal-public/affiliate-terms.html). Confirm the numbers on screen match what the narration says before you record.
- Do not promise or imply earnings. Say what the program pays, not what viewers will make. Check the final script against the published affiliate terms.
- Your referral code and links are shareable on purpose, but if the demo workspace code will be used for real referrals, blur it.

## Shot list

### Step 1 (0:00 to 0:08, 8 s): Intro

**On screen**

1. Calendar page, then click **Affiliates** in the left menu (bottom group, above **Review**).

**Labels used**

- `Affiliates`: translation key `affiliates` (en/translation.json), used in `layout/top.menu.tsx`

**Narration:** If you like PostDelegate, you can earn a commission by sharing it. Here is how the affiliate program works.

**Caption:** Share PostDelegate. Earn a commission.

### Step 2 (0:08 to 0:20, 12 s): The affiliate page

**On screen**

1. The page title is **Affiliate program** with the line "Earn 30% of every payment from the customers you refer, for 12 months." (the numbers are filled in by the app).
2. Slowly move down the page: links, six number tiles, **Custom code** and **Payout details**, **Commissions**, **How it works**.

**Labels used**

- `Affiliate program`: translation key `affiliates_title` (en/translation.json), used in `affiliates/affiliates.component.tsx`
- `Earn {{percent}}% of every payment from the customers you refer, for {{months}} months.`: translation key `affiliates_intro` (en/translation.json), used in `affiliates/affiliates.component.tsx`

**Narration:** Open Affiliates from the left menu. You earn thirty percent of every payment from the customers you refer, for twelve months. Everything you need is on this one page.

**Caption:** 30% of each payment, for 12 months (check on screen)

- [VERIFY] The percentage and months shown on production. They are env settings (AFFILIATE_COMMISSION_PERCENT, AFFILIATE_COMMISSION_MONTHS). Replace "thirty percent" and "twelve months" in the narration if the screen differs.

### Step 3 (0:20 to 0:36, 16 s): Your referral links

**On screen**

1. Card **Your referral links**: three rows, **Website link**, **Sign-up link** and **Your code**. Each has a **Copy** button.
2. Click **Copy** on **Sign-up link**. A toast confirms. Do not paste it on camera.

**Labels used**

- `Your referral links`: translation key `affiliates_links` (en/translation.json), used in `affiliates/affiliates.component.tsx`
- `Website link`: translation key `affiliates_landing_link` (en/translation.json), used in `affiliates/affiliates.component.tsx`
- `Sign-up link`: translation key `affiliates_register_link` (en/translation.json), used in `affiliates/affiliates.component.tsx`
- `Your code`: translation key `affiliates_your_code` (en/translation.json), used in `affiliates/affiliates.component.tsx`
- `Copy`: translation key `affiliates_copy` (en/translation.json), used in `affiliates/affiliates.component.tsx`

**Narration:** You get a link to the website, a link straight to sign-up, and a personal code. Copy whichever fits where you are sharing. Someone who signs up within sixty days of opening your link counts as your referral.

**Caption:** Share your link. 60-day tracking window.

**Notes**

- Sixty days is the tracking window in tk:affiliates_terms_cookie ("Someone who signs up within {{days}} days of opening your link is attributed to you.") and affiliate.cookie.ts (DEFAULT_AFFILIATE_COOKIE_DAYS = 60). The first link a person uses is the one that counts (draft affiliate terms).

- [VERIFY] The day count shown in the **How it works** box on production.

### Step 4 (0:36 to 0:56, 20 s): Read the numbers

**On screen**

1. Point at the six tiles in order: **Signups referred**, **Paying customers**, **Pending**, **Approved**, **Paid**, **Reversed**.
2. Hover each money tile and say what it means (see narration).

**Labels used**

- `Signups referred`: translation key `affiliates_signups` (en/translation.json), used in `affiliates/affiliates.component.tsx`
- `Paying customers`: translation key `affiliates_paying` (en/translation.json), used in `affiliates/affiliates.component.tsx`
- `Pending`: translation key `affiliates_pending` (en/translation.json), used in `affiliates/affiliates.component.tsx`
- `Approved`: translation key `affiliates_approved` (en/translation.json), used in `affiliates/affiliates.component.tsx`
- `Paid`: translation key `affiliates_paid` (en/translation.json), used in `affiliates/affiliates.component.tsx`
- `Reversed`: translation key `affiliates_reversed` (en/translation.json), used in `affiliates/affiliates.component.tsx`

**Narration:** Signups shows how many people joined from your link, and paying customers how many started paying. A commission starts as Pending. After a thirty day hold, in case of refunds, it becomes Approved. Paid means we sent it. Reversed means a payment was refunded.

**Caption:** Pending > Approved > Paid. Reversed if refunded.

**Notes**

- Hold period: tk:affiliates_terms_hold ("Commissions are held for {{days}} days in case of refunds, then approved."). Reversal: tk:affiliates_reversed_note.
- A fresh demo account shows zeros, which is fine. Do not photoshop numbers.

- [VERIFY] The hold period (30 days by default, AFFILIATE_HOLD_DAYS) on production.

### Step 5 (0:56 to 1:10, 14 s): Choose a custom code

**On screen**

1. Card **Custom code**. Read the line "Choose a short code for your links, 3 to 24 letters, numbers or hyphens. You can do this once."
2. Type `acme-coffee` in the field (placeholder shows your current code). Click **Save** only on the demo workspace. A toast says **Code saved**.
3. After saving, the card reads "Your custom code is set and cannot be changed."

**Labels used**

- `Custom code`: translation key `affiliates_vanity_title` (en/translation.json), used in `affiliates/affiliates.component.tsx`
- `Choose a short code for your links, 3 to 24 letters, numbers or hyphens. You can do this once.`: translation key `affiliates_vanity_description` (en/translation.json), used in `affiliates/affiliates.component.tsx`
- `Save`: translation key `affiliates_save` (en/translation.json), used in `affiliates/affiliates.component.tsx`
- `Code saved`: translation key `affiliates_code_saved` (en/translation.json), used in `affiliates/affiliates.component.tsx`
- `Your custom code is set and cannot be changed.`: translation key `affiliates_vanity_locked` (en/translation.json), used in `affiliates/affiliates.component.tsx`

**Narration:** Want something easier to remember? Choose a custom code, three to twenty four letters, numbers or hyphens. You can only do this once, so pick one you like.

**Caption:** Custom code: 3 to 24 characters. One time only.

**Notes**

- The code is saved lower case (affiliates.component.tsx trims and lowercases it).

### Step 6 (1:10 to 1:22, 12 s): Payout details

**On screen**

1. Card **Payout details**. Show the line "Payouts are sent manually through PayPal once your approved balance reaches $50."
2. Show the empty field **PayPal email** and the privacy line under it. Leave it empty, or type a clearly fake address only if the field validates. Do not click **Save** with a real address.

**Labels used**

- `Payout details`: translation key `affiliates_payout_title` (en/translation.json), used in `affiliates/affiliates.component.tsx`
- `Payouts are sent manually through PayPal once your approved balance reaches {{amount}}.`: translation key `affiliates_payout_description` (en/translation.json), used in `affiliates/affiliates.component.tsx`
- `PayPal email`: translation key `affiliates_payout_email` (en/translation.json), used in `affiliates/affiliates.component.tsx`
- `This email is personal data. It is stored as plain text and used only to pay you.`: translation key `affiliates_payout_privacy` (en/translation.json), used in `affiliates/affiliates.component.tsx`

**Narration:** Add your PayPal email under Payout details. Payments are sent by hand through PayPal once your approved balance reaches fifty dollars. That email is only used to pay you.

**Caption:** Payouts via PayPal from $50 approved

- [VERIFY] The minimum payout amount shown (AFFILIATE_MIN_PAYOUT_USD, default 50).

### Step 7 (1:22 to 1:30, 8 s): The commissions table

**On screen**

1. Scroll to **Commissions**. A table with the columns **Date**, **Customer**, **Commission**, **Status**. On a new account it shows "No commissions yet. They show up here when a customer you referred pays."

**Labels used**

- `Commissions`: translation key `affiliates_commissions` (en/translation.json), used in `affiliates/affiliates.component.tsx`
- `Date`: translation key `affiliates_date` (en/translation.json), used in `affiliates/affiliates.component.tsx`
- `Customer`: translation key `affiliates_customer` (en/translation.json), used in `affiliates/affiliates.component.tsx`
- `Commission`: translation key `affiliates_amount` (en/translation.json), used in `affiliates/affiliates.component.tsx`
- `Status`: translation key `affiliates_status` (en/translation.json), used in `affiliates/affiliates.component.tsx`
- `No commissions yet. They show up here when a customer you referred pays.`: translation key `affiliates_no_commissions` (en/translation.json), used in `affiliates/affiliates.component.tsx`

**Narration:** Every commission shows up here with its date, the customer, the amount, and its status.

**Caption:** Every commission, listed

### Step 8 (1:30 to 1:46, 16 s): The rules

**On screen**

1. Scroll to the box **How it works**. Read the five bullet lines slowly, including the one that begins "Self-referrals, spam and paid search ads on our brand name are not allowed."
2. Point at the link **Read the full affiliate terms** and click it. The terms page opens in a new tab (address `/legal/affiliate-terms`). Scroll for two seconds, then close it.

**Labels used**

- `How it works`: translation key `affiliates_terms_title` (en/translation.json), used in `affiliates/affiliates.component.tsx`
- `Self-referrals, spam and paid search ads on our brand name are not allowed.`: translation key `affiliates_terms_rules` (en/translation.json), used in `affiliates/affiliates.component.tsx`
- `Read the full affiliate terms`: translation key `affiliates_terms_link` (en/translation.json), used in `affiliates/affiliates.component.tsx`

**Narration:** Two rules to know. You can not refer yourself, and spam and paid search ads on the PostDelegate name are not allowed. Read the full affiliate terms before you start. Thanks for watching.

**Caption:** No self-referrals, spam or brand-name search ads

**Notes**

- Do not mention how much anyone can make. State the percentage only as the program rate.
- If you want a short disclosure line on screen, use: "Affiliate terms apply."

- [VERIFY] That /legal/affiliate-terms is live and final on the day you publish. The copy in the repo (deploy/postdelegate/legal-public/affiliate-terms.html) is marked "DRAFT for owner review". Do not publish this video until the terms are approved and linked.

### Step 9 (1:46 to 1:51, 5 s): End card

**On screen**

1. End card with the logo, `app.postdelegate.com` and "Affiliate terms apply."

**Narration:** Find it under Affiliates in your PostDelegate account.

**Caption:** Affiliate terms apply.

## Voice-over read-through

Read this straight through for the voice recording. Timecodes are where each line starts on the picture.

**0:00** If you like PostDelegate, you can earn a commission by sharing it. Here is how the affiliate program works.

**0:08** Open Affiliates from the left menu. You earn thirty percent of every payment from the customers you refer, for twelve months. Everything you need is on this one page.

**0:20** You get a link to the website, a link straight to sign-up, and a personal code. Copy whichever fits where you are sharing. Someone who signs up within sixty days of opening your link counts as your referral.

**0:36** Signups shows how many people joined from your link, and paying customers how many started paying. A commission starts as Pending. After a thirty day hold, in case of refunds, it becomes Approved. Paid means we sent it. Reversed means a payment was refunded.

**0:56** Want something easier to remember? Choose a custom code, three to twenty four letters, numbers or hyphens. You can only do this once, so pick one you like.

**1:10** Add your PayPal email under Payout details. Payments are sent by hand through PayPal once your approved balance reaches fifty dollars. That email is only used to pay you.

**1:22** Every commission shows up here with its date, the customer, the amount, and its status.

**1:30** Two rules to know. You can not refer yourself, and spam and paid search ads on the PostDelegate name are not allowed. Read the full affiliate terms before you start. Thanks for watching.

**1:46** Find it under Affiliates in your PostDelegate account.

## On-screen captions

- 0:00 to 0:08: Share PostDelegate. Earn a commission.
- 0:08 to 0:20: 30% of each payment, for 12 months (check on screen)
- 0:20 to 0:36: Share your link. 60-day tracking window.
- 0:36 to 0:56: Pending > Approved > Paid. Reversed if refunded.
- 0:56 to 1:10: Custom code: 3 to 24 characters. One time only.
- 1:10 to 1:22: Payouts via PayPal from $50 approved
- 1:22 to 1:30: Every commission, listed
- 1:30 to 1:46: No self-referrals, spam or brand-name search ads
- 1:46 to 1:51: Affiliate terms apply.

## End card

- Headline: Share PostDelegate
- Call to action: Sign in at app.postdelegate.com and open Affiliates. Affiliate terms apply.
- Next video: Back to the series: Video 1, Get started
- Keep the card on screen for 5 seconds (the last step of the shot list is this card).

## YouTube

**Title** (55 characters): PostDelegate affiliate program: links, code and payouts

**Description**

```text
A walkthrough of the PostDelegate affiliate page: your referral links and code, the statuses from Pending to Paid, how to set a custom code, how payouts work, and the rules of the program.

Chapters
0:00 What the program is
0:20 Your links and stats
1:30 The rules

Links
Open PostDelegate: https://app.postdelegate.com
Affiliate terms: https://postdelegate.com/legal/affiliate-terms [VERIFY the public address before publishing]
Previous video: [LINK to video 7]

Questions? support@postdelegate.com

Affiliate terms apply. Commissions are not guaranteed.
```

**Tags:** PostDelegate, affiliate program, referral link, social media scheduler, affiliate payouts

**Chapter check:** 3 chapters, first at 0:00, each at least 10 seconds. Timestamps above are computed from the step durations, so re-time them if you change a step.

## Docs page summary (one line)

> Find your referral links, read your commission statuses, set a custom code and add payout details.

## [VERIFY] checklist for this video

- [ ] Step 2: The percentage and months shown on production. They are env settings (AFFILIATE_COMMISSION_PERCENT, AFFILIATE_COMMISSION_MONTHS). Replace "thirty percent" and "twelve months" in the narration if the screen differs.
- [ ] Step 3: The day count shown in the **How it works** box on production.
- [ ] Step 4: The hold period (30 days by default, AFFILIATE_HOLD_DAYS) on production.
- [ ] Step 6: The minimum payout amount shown (AFFILIATE_MIN_PAYOUT_USD, default 50).
- [ ] Step 8: That /legal/affiliate-terms is live and final on the day you publish. The copy in the repo (deploy/postdelegate/legal-public/affiliate-terms.html) is marked "DRAFT for owner review". Do not publish this video until the terms are approved and linked.

## Clean-up after recording

- [ ] The custom code cannot be changed once saved. If you set one on the demo workspace, note it in the demo notes.
- [ ] Clear any PayPal email you typed while testing (leave the field empty).
- [ ] Delete copied referral links from the clipboard.
