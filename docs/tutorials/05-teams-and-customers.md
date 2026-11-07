# Video 5: Teams and customers: work together and keep clients apart

Invite a teammate with the right role, understand the workspace switcher, then group channels by customer so each client's posts and channels stay together.

| | |
| --- | --- |
| Target runtime | 2:16 (136 s), about 256 spoken words (about 113 words per minute) |
| Needs | A plan that includes team members (Team, Pro or Ultimate; Starter does not, see docs billing.md). An admin or owner login. At least two connected channels (for example two demo Bluesky accounts) so there are two customers to separate. |
| Account to record on | "Acme Coffee" demo workspace on a Team plan or higher. Use a mailbox you control for the invite, or copy the link instead of sending an email. |
| Series | [Back to the series list](README.md) |

Label citations: see "How to read the label citations" in the [README](README.md). Anything marked [VERIFY] could not be confirmed from code and must be checked on screen before recording.

## Before you record

- Connect two demo channels (for example two throwaway Bluesky accounts). Name them clearly: "Acme Cafe Demo" and "Acme Bakery Demo".
- Use fictional customer names: **North Pier Bakery** and **Willow Tea House**. Check that nothing uses a real company name or logo.
- Never show the invitation link or an invited person's real email. Use `teammate@example.com`, a reserved example address, and turn **Send invitation via email?** off.
- Prepare a second demo user only if you want to film the workspace switcher with a real second workspace.
- Check the Settings page has the **Teams** tab on this plan. It is hidden for the User role and on plans without team members.

## Shot list

### Step 1 (0:00 to 0:10, 10 s): What this video covers

**On screen**

1. Calendar page with two connected channels in the **Channels** column.

**Labels used**

- `Channels`: translation key `channels` (en/translation.json), used in `launches/launches.component.tsx`

**Narration:** When more people join in, you need two things: a way to invite them, and a way to keep clients apart. Let us do both.

**Caption:** Teammates and clients, kept tidy

### Step 2 (0:10 to 0:20, 10 s): Open Settings, then Teams

**On screen**

1. Click **Settings** at the bottom of the left menu.
2. In the list on the left of the Settings page, click **Teams**. The tab list reads **Global Settings**, **Agents / Dev**, **Teams**, **Webhooks**, and more.

**Labels used**

- `Settings`: translation key `settings` (en/translation.json), used in `layout/top.menu.tsx`
- `Global Settings`: translation key `global_settings` (en/translation.json), used in `layout/settings.component.tsx`
- `Agents / Dev`: translation key `agents_dev` (en/translation.json), used in `layout/settings.component.tsx`
- `Teams`: translation key `teams` (en/translation.json), used in `layout/settings.component.tsx`
- `Webhooks`: translation key `webhooks_1` (en/translation.json), used in `layout/settings.component.tsx`

**Narration:** Open Settings, then Teams. If you do not see Teams, your plan does not include team members yet.

**Caption:** Settings > Teams

**Notes**

- The Teams tab shows only when the plan includes team members and your role is not User (settings.component.tsx list). Starter has no team members (pricing.ts).

### Step 3 (0:20 to 0:30, 10 s): The member list

**On screen**

1. The page title is **Team Members** with the line **Invite your assistant or team member to manage your account**.
2. The list shows you (name taken from the email, blur it) with the role **Super Admin**.

**Labels used**

- `Team Members`: translation key `team_members` (en/translation.json), used in `settings/teams.component.tsx`
- `Invite your assistant or team member to manage your account`: translation key `invite_your_assistant_or_team_member_to_manage_your_account` (en/translation.json), used in `settings/teams.component.tsx`
- `Super Admin`: translation key `super_admin` (en/translation.json), used in `settings/teams.component.tsx`

**Narration:** This is your team. You are the Super Admin, the owner of the workspace.

**Caption:** You are the Super Admin

**Notes**

- The list shows the part of each email before the @ (teams.component.tsx), so blur it.

### Step 4 (0:30 to 0:54, 24 s): Invite someone

**On screen**

1. Click **Add another member** (this label is shown even before you have teammates, because you are already in the list).
2. The window **Add Member** opens. In the **Email** field (placeholder **Enter email**) type `teammate@example.com`.
3. Open the **Role** list (first option **Select Role**) and choose **User**. Mention **Admin** too.
4. Switch **Send invitation via email?** off. The button changes from **Send Invitation Link** to **Copy Link**.
5. Click **Copy Link**. A toast says **Link copied to clipboard**. Do not paste the link anywhere on camera.

**Labels used**

- `Add another member`: translation key `add_another_member` (en/translation.json), used in `settings/teams.component.tsx`
- `Add Member`: translation key `top_title_add_member` (en/translation.json), used in `settings/teams.component.tsx`
- `Email`: fixed or default text in `settings/teams.component.tsx` (no entry in translation.json)
- `Enter email`: translation key `enter_email` (en/translation.json), used in `settings/teams.component.tsx`
- `Role`: fixed or default text in `settings/teams.component.tsx` (no entry in translation.json)
- `Select Role`: translation key `select_role` (en/translation.json), used in `settings/teams.component.tsx`
- `Send invitation via email?`: translation key `send_invitation_via_email` (en/translation.json), used in `settings/teams.component.tsx`
- `Send Invitation Link`: translation key `send_invitation_link` (en/translation.json), used in `settings/teams.component.tsx`
- `Copy Link`: translation key `copy_link` (en/translation.json), used in `settings/teams.component.tsx`
- `Link copied to clipboard`: translation key `link_copied_to_clipboard` (en/translation.json), used in `settings/teams.component.tsx`

**Narration:** Click Add another member. Enter their email and choose a role. User can work on posts and channels. Admin can also manage the team. You can email the invitation, or switch that off and copy the link to send it yourself.

**Caption:** User = work on posts. Admin = also manage the team.

**Notes**

- Docs team.md: Admin manages the workspace including inviting and removing members within plan limits; User works on posts and channels and does not see the Teams tab.
- Docs team.md says the button is "Add another member once you already have some". In the app it is always **Add another member**. Report to docs owner.

- [VERIFY] That copying a link with the toggle off creates no pending invitation you must delete later (the Teams list only shows accepted members). If a pending invite is recorded, remove it after recording.

### Step 5 (0:54 to 1:04, 10 s): Removing a member

**On screen**

1. Show a member row (use a second demo member if you have one). A small **Remove** button sits at the right of rows below your own level.
2. Click **Remove** and show the question **Are you sure you want to remove this team member?** Click **No, cancel!**.

**Labels used**

- `Remove`: translation key `remove` (en/translation.json), used in `settings/teams.component.tsx`
- `Are you sure you want to remove this team member?`: translation key `are_you_sure_remove_team_member` (en/translation.json), used in `settings/teams.component.tsx`
- `No, cancel!`: translation key `no_cancel` (en/translation.json), used in `libraries/react-shared-libraries/src/helpers/delete.dialog.tsx`

**Narration:** To remove someone, use Remove next to their name. You can only remove people at a lower level than yours.

**Caption:** Remove: only people below your level

**Notes**

- If no second member exists, show this as a graphic from a prepared screenshot. Do not remove a real teammate on camera.

### Step 6 (1:04 to 1:16, 12 s): Switching workspaces

**On screen**

1. Cut to a second demo user who has been invited to Acme Coffee and also owns a workspace of their own.
2. In the top bar a building icon with the workspace name appears. Hover it. A list of the other workspaces opens. Click one and the page reloads in that workspace.
3. If you cannot film a second workspace, use a prepared screenshot with a caption.

**Narration:** People you invite join your workspace. If someone belongs to more than one, a workspace switcher shows at the top. Hover it, pick a workspace, and the page reloads there.

**Caption:** Belong to more than one workspace? Switch at the top.

- [VERIFY] The switcher only renders when the user belongs to more than one workspace (layout/organization.selector.tsx returns nothing for exactly one). It also needs the invited person to accept the invite first. The step ties together the invite flow and has not been traced end to end in code. Test with a second account before recording.

### Step 7 (1:16 to 1:30, 14 s): Move a channel into a customer

**On screen**

1. Back on the Calendar page. In the **Channels** column hover "Acme Cafe Demo" and click the three-dot menu at its right.
2. Click **Move / add to group**. The window **Move / add to group** opens.
3. The field **Select Customer** (placeholder **Start typing...**). Type `North Pier Bakery`.
4. Click **Save**. A toast says **Customer Updated**.

**Labels used**

- `Channels`: translation key `channels` (en/translation.json), used in `launches/launches.component.tsx`
- `Move / add to group`: translation key `move_add_to_group` (en/translation.json), used in `launches/menu/menu.tsx`
- `Select Customer`: translation key `select_customer_label` (en/translation.json), used in `launches/customer.modal.tsx`
- `Start typing...`: translation key `start_typing` (en/translation.json), used in `launches/customer.modal.tsx`
- `Save`: translation key `save` (en/translation.json), used in `launches/customer.modal.tsx`
- `Customer Updated`: translation key `customer_updated` (en/translation.json), used in `launches/menu/menu.tsx`

**Narration:** A customer is a group of channels, perfect for agencies. Open a channel menu and choose Move to group. Type a customer name and save.

**Caption:** Customer = a group of channels

**Notes**

- In the app and docs a customer is also called a group (docs team.md). The API calls them groups.
- Typing a name that does not exist yet creates it. Typing an existing name shows it as a suggestion (the field uses a datalist, customer.modal.tsx).

### Step 8 (1:30 to 1:40, 10 s): Add the second customer

**On screen**

1. Repeat for the second channel: three-dot menu, **Move / add to group**, type `Willow Tea House`, **Save**.
2. The **Channels** column now shows two headings with the channel under each. Click the small arrow next to a heading to collapse it.

**Labels used**

- `Move / add to group`: translation key `move_add_to_group` (en/translation.json), used in `launches/menu/menu.tsx`
- `Save`: translation key `save` (en/translation.json), used in `launches/customer.modal.tsx`

**Narration:** Do the same for the next channel with a new customer name. Now your channels are grouped under each client.

**Caption:** Channels grouped under each client

### Step 9 (1:40 to 1:52, 12 s): Rename a customer and drag channels

**On screen**

1. Hover a customer heading. A small pencil appears. Click it. The window **Edit group name** opens with the field **Name**. Change the name and click **Save**.
2. Drag a channel and drop it onto the other customer's block to move it. The block lights up while you hover.
3. Undo it by dragging the channel back.

**Labels used**

- `Edit group name`: translation key `edit_group_name` (en/translation.json), used in `launches/launches.component.tsx`
- `Name`: translation key `group_name` (en/translation.json), used in `launches/launches.component.tsx`
- `Save`: translation key `save` (en/translation.json), used in `launches/launches.component.tsx`

**Narration:** Click the pencil to rename a customer. You can also drag a channel from one customer to another.

**Caption:** Rename a customer. Drag channels between customers.

- [VERIFY] Drag and drop of a channel onto a group (launches.component.tsx: MenuGroupComponent useDrop and changeItemGroup). Confirm it works with the mouse in your recording browser.

### Step 10 (1:52 to 2:10, 18 s): Work in one customer at a time

**On screen**

1. At the top of the calendar, in the filter row after **Today**, click the small person icon (tooltip **Select Customer**). A list titled **Customers** opens. Click **North Pier Bakery**. A toast says **Customer socials selected**.
2. The calendar now shows only that customer's channels and posts.
3. Click **Create Post**. In the composer the same person icon sits at the right end of the channel row. Choose the other customer and watch their channel get selected for you.
4. Close the composer with the X and **Yes, close it!**.

**Labels used**

- `Select Customer`: translation key `select_customer_tooltip` (en/translation.json), used in `launches/select.customer.tsx`
- `Customers`: translation key `customers` (en/translation.json), used in `launches/select.customer.tsx`
- `Customer socials selected`: fixed or default text in `launches/select.customer.tsx` (no entry in translation.json)
- `Create Post`: translation key `create_new_post` (en/translation.json), used in `launches/new.post.tsx`
- `Yes, close it!`: translation key `yes_close_it` (en/translation.json), used in `new-launch/manage.modal.tsx`

**Narration:** Pick a customer here to see only their channels and posts. In the composer the same picker selects all of a customer's channels for you. That makes it much harder to post to the wrong client.

**Caption:** Pick a customer. Fewer mistakes.

**Notes**

- The picker only appears when your channels belong to more than one customer group (select.customer.tsx returns nothing otherwise).
- To take a channel out of a customer later: three-dot menu, **Move / add to group**, **Remove from customer** (tk:remove_from_customer).
- Docs team.md says choosing a customer selects that customer's channels, which makes it harder to send a post to the wrong client.

- [VERIFY] That choosing a customer in the calendar filter hides other customers' posts, as described. filters.tsx passes the customer to the calendar query; confirm on screen with two posts.

### Step 11 (2:10 to 2:16, 6 s): End card

**On screen**

1. End card with the logo, `app.postdelegate.com`, and the next video title.

**Narration:** Next, connect your own AI assistant. Thanks for watching.

**Caption:** Next: connect Claude or ChatGPT

## Voice-over read-through

Read this straight through for the voice recording. Timecodes are where each line starts on the picture.

**0:00** When more people join in, you need two things: a way to invite them, and a way to keep clients apart. Let us do both.

**0:10** Open Settings, then Teams. If you do not see Teams, your plan does not include team members yet.

**0:20** This is your team. You are the Super Admin, the owner of the workspace.

**0:30** Click Add another member. Enter their email and choose a role. User can work on posts and channels. Admin can also manage the team. You can email the invitation, or switch that off and copy the link to send it yourself.

**0:54** To remove someone, use Remove next to their name. You can only remove people at a lower level than yours.

**1:04** People you invite join your workspace. If someone belongs to more than one, a workspace switcher shows at the top. Hover it, pick a workspace, and the page reloads there.

**1:16** A customer is a group of channels, perfect for agencies. Open a channel menu and choose Move to group. Type a customer name and save.

**1:30** Do the same for the next channel with a new customer name. Now your channels are grouped under each client.

**1:40** Click the pencil to rename a customer. You can also drag a channel from one customer to another.

**1:52** Pick a customer here to see only their channels and posts. In the composer the same picker selects all of a customer's channels for you. That makes it much harder to post to the wrong client.

**2:10** Next, connect your own AI assistant. Thanks for watching.

## On-screen captions

- 0:00 to 0:10: Teammates and clients, kept tidy
- 0:10 to 0:20: Settings > Teams
- 0:20 to 0:30: You are the Super Admin
- 0:30 to 0:54: User = work on posts. Admin = also manage the team.
- 0:54 to 1:04: Remove: only people below your level
- 1:04 to 1:16: Belong to more than one workspace? Switch at the top.
- 1:16 to 1:30: Customer = a group of channels
- 1:30 to 1:40: Channels grouped under each client
- 1:40 to 1:52: Rename a customer. Drag channels between customers.
- 1:52 to 2:10: Pick a customer. Fewer mistakes.
- 2:10 to 2:16: Next: connect Claude or ChatGPT

## End card

- Headline: Teams and clients, organised
- Call to action: Try it at app.postdelegate.com. Docs: postdelegate.com/docs/team.
- Next video: Video 6: Connect Claude or ChatGPT
- Keep the card on screen for 5 seconds (the last step of the shot list is this card).

## YouTube

**Title** (62 characters): PostDelegate teams and customers: invite people, group clients

**Description**

```text
Invite a teammate and choose their role, then group your channels by customer so each client stays separate. Includes the workspace switcher and how to post to the right client every time.

Chapters
0:00 Invite a teammate
1:04 Switching workspaces
1:16 Group channels by customer

Links
Open PostDelegate: https://app.postdelegate.com
Team and customers guide: https://postdelegate.com/docs/team
Plans: https://postdelegate.com/docs/billing
Previous video: [LINK to video 4]
Next video: [LINK to video 6]

Questions? support@postdelegate.com
```

**Tags:** PostDelegate, social media team, agency workflow, manage clients, team roles, social media scheduler

**Chapter check:** 3 chapters, first at 0:00, each at least 10 seconds. Timestamps above are computed from the step durations, so re-time them if you change a step.

## Docs page summary (one line)

> Invite teammates with the right role, and group channels by customer so client work stays separate.

## [VERIFY] checklist for this video

- [ ] Step 4: That copying a link with the toggle off creates no pending invitation you must delete later (the Teams list only shows accepted members). If a pending invite is recorded, remove it after recording.
- [ ] Step 6: The switcher only renders when the user belongs to more than one workspace (layout/organization.selector.tsx returns nothing for exactly one). It also needs the invited person to accept the invite first. The step ties together the invite flow and has not been traced end to end in code. Test with a second account before recording.
- [ ] Step 9: Drag and drop of a channel onto a group (launches.component.tsx: MenuGroupComponent useDrop and changeItemGroup). Confirm it works with the mouse in your recording browser.
- [ ] Step 10: That choosing a customer in the calendar filter hides other customers' posts, as described. filters.tsx passes the customer to the calendar query; confirm on screen with two posts.

## Clean-up after recording

- [ ] Remove the demo teammate if the invite was accepted (**Settings > Teams > Remove**).
- [ ] Remove the demo customers from channels (**Move / add to group > Remove from customer**) if the demo workspace should look neutral.
- [ ] Delete the second demo channels you connected only for this video (the channel must have no posts first).
