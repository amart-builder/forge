---
name: forge-email
description: >-
  Triage the user's email into Forge and send the replies they approve. Use when
  the user wants to check, process, or clear their inbox ("check my email",
  "triage my inbox", "any important email", "what needs me"), or to send replies
  they approved in Forge ("send my approved emails", "send that reply"). Pulls
  mail from the connected Gmail (via Composio), classifies it, drafts replies in
  the user's voice, and writes cards to the Forge Email tab. Draft only: nothing
  sends without the user's approval.
---

# Forge email

Forge's Email tab is a triage queue, not a mailbox. It shows the emails that
actually need the user, each with a short summary and a ready-to-edit draft
reply. This skill fills that queue from their real inbox and sends the replies
they approve. Email is connected through Composio (Gmail). **Nothing sends
without the user's approval.**

If `data/forge-email.json` does not exist, email is not set up yet: tell the
user to run the Email step in `SETUP.md` (connect Gmail through Composio), then
come back. That file holds `{ provider, account_email, connector,
connected_account_id }`; use its `account_email` as the Gmail account.

## A. Triage the inbox (pull new mail into Forge)

### 1. Get new mail
Use the Composio Gmail tools (run `COMPOSIO_SEARCH_TOOLS` for "fetch Gmail
emails", then `COMPOSIO_MULTI_EXECUTE_TOOL`):

- Read the cursor from `data/forge-email-state.json` (field `last_triaged_at`,
  an ISO date). If the file is missing, default to the last 2 days.
- Call `GMAIL_FETCH_EMAILS` with `query` = `in:inbox after:YYYY/MM/DD` (the
  cursor date), `verbose=true`, `max_results=25`. Follow `nextPageToken` if set.
- Get the message_ids already in Forge once, up front:
  `GET /api/forge-rest/email_items?select=message_id&order=created_at.desc&limit=300`.
  Skip any fetched message whose `messageId` is already in that set. Gmail's
  `after:` is date-granular, so each run re-fetches the cursor day; this dedupe
  is what prevents duplicates, so keep the cursor a date, not a timestamp.
- `sender` comes back as `Name <email>`; split it into `sender_name` and
  `sender_email`.

### 2. Classify each email
Put each one in exactly one bucket:

- **action_item**: needs the user to do something, decide something, or reply.
  Draft a reply (step 3).
- **tiding**: they should KNOW but need not act (a real FYI, a reply they are
  waiting on, a receipt that matters). No draft.
- **log_only**: newsletters, marketing, automated noise. Do not clutter the
  queue; mark it handled and, if the user likes a clean inbox, archive it in
  Gmail (remove the `INBOX` label via `GMAIL_MODIFY_THREAD_LABELS`).

How to judge, fast:
- Is it from a real person or an automated sender? Automated and promotional is
  almost always `log_only`.
- Does it actually ask the user for something, or just inform? Asks → action.
- Could the user act on it in under 30 seconds, or does it need real thought?
  Set `priority` 1 (high), 2 (medium), 3 (low) accordingly.
- Weigh importance against the user's priorities in their `~/.claude/CLAUDE.md`
  and who they care about in `GET /api/forge-rest/contacts`. Mail tied to a
  known contact or a stated priority ranks higher.

### 3. Draft a reply (for action_items that need one)
Write the reply in the **user's** voice:

- Read `~/.claude/voice.md` (built by the `forge-voice` skill) and follow it
  exactly.
- If it does not exist yet, fall back to their `~/.claude/CLAUDE.md` tone, or
  read their last 2 to 3 sent emails to this person and match that. Then suggest
  they run the `forge-voice` skill so drafts get sharper.
- Apply the **humanizer** skill's rules to every draft as you write it: no em
  dashes, no AI vocabulary, vary the rhythm, plain words. In a batch you do not
  need to invoke the humanizer as a separate pass on each email; for an important
  reply you can run that one draft through it. If the humanizer skill is not
  installed, apply its core rules anyway.

Do not invent facts or commitments. This is a draft for them to review, never
sent here.

### 4. Write it into Forge (local REST API, no auth)
For each triaged email, `POST /api/forge-rest/email_items`:

```json
{
  "message_id": "<messageId>",
  "thread_id": "<threadId>",
  "classification": "action_item | tiding | log_only",
  "status": "pending",
  "sender_name": "<name>",
  "sender_email": "<email>",
  "subject": "<subject>",
  "body_excerpt": "<first ~300 chars>",
  "summary": "<one-line: what it is and what it wants>",
  "recommended_action": "reply",
  "priority": 1,
  "received_at": "<messageTimestamp, ISO>",
  "account_email": "<the connected Gmail address>",
  "source_payload": { "full_body": "<full message text>" }
}
```

`priority` is an integer here (1 high, 3 low). Set `recommended_action` to one
of these exact values so the card renders the right label: `reply`,
`follow_up`, `delegate`, `flag`, `review`, `archive`. Use `reply` whenever you
drafted a reply, `archive` for `log_only`, and `review` for tidings or for
action items that need an offline step instead of an email.

If you drafted a reply, take the new email_item `id` from the POST response and
`POST /api/forge-rest/drafts`:

```json
{ "email_item_id": "<id>", "subject": "<re: subject>", "body": "<draft>", "status": "needs_review" }
```

After the batch, `POST /api/forge-rest/email_triage_runs` with a one-line
`summary` (e.g. "Triaged 6: 2 need you, 3 FYI, 1 filed"). Then update
`data/forge-email-state.json` so `last_triaged_at` is now.

### 5. Tell the user
One line: what needs them and what is just FYI, then point them to the Email tab
to review and approve. Keep it human, no em dashes.

## B. Sending
Sending happens in the Forge Email tab, not from chat. On each card the user
reviews the draft, edits it if needed, and clicks **Send**; Forge sends the
reply through their Gmail (Composio) and marks the item handled. You do not send
anything as part of triage.

If the user explicitly asks you in chat to send a specific reply ("send my reply
to Joe"), you may do it with the Composio Gmail tools: `GMAIL_REPLY_TO_THREAD`
with the `thread_id`, `recipient_email` = the original sender, and the draft
body. Then mark that draft `sent` and its email_item `actioned` over REST. Only
ever send a reply the user has clearly told you to send.

## Rules
- **Draft only during triage.** You write drafts; the user sends them. Never
  send mail on your own initiative.
- Sound like the user, not a generic assistant. Never use an em dash.
- One Gmail account per client. If a fetch or send fails with an auth error,
  the Composio Gmail connection has dropped; have the user reconnect it (Email
  step in `SETUP.md`).
