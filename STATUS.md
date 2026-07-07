# Forge - STATUS

<!-- BEGIN repo-identity -->
## Repo Identity
- **group_id:** forge
- **canonical_repo:** projects/astack/forge
- **macbook_path:** /Users/alexanderjmartin/Atlas/projects/astack/forge
- **mac_mini_path:** /Users/alexandermartin/Desktop/Atlas/projects/astack/forge
- **github:** nested app repo, clean on `main` as of 2026-05-27 commit `a05395f`
- **default_branch:** main
- **owned_by:** shared
- **deploy:** http://localhost:3200 on the Mac Mini; Alex's MacBook URL is http://alexander-mac-mini.taildd6a98.ts.net:3200/tasks
- **never_commit:** .env*, data/forge.db*, secrets, private email/task/contact exports
- **push:** use the repo safe-push flow when this repo is clean enough to commit; never raw git push
<!-- END repo-identity -->

<!-- BEGIN active-session -->
## Active Session
- **system:** cowork
- **device:** Alexanders-MacBook-Pro-2
- **since:** 2026-07-06T20:44:11-0400
- **task:** wire nudge + schedule + dress rehearsal
<!-- END active-session -->

---

**Last updated:** 2026-07-03 (card browser-verified; swap-spiral root-caused + fixed)
**State:** Two tracks now. (1) Alex's live Forge still runs on the Mac Mini in Supabase mode over Tailscale, unchanged. (2) Jarvis Pro track: Forge is being productized to run fully local on a client's own MacBook (local SQLite, no login, bookmarked localhost:3200, auto-start LaunchAgent). 2026-06-30: the local-first foundation landed and was verified; the Tasks step (natural-language capture skill + native/text reminders) is built, verified, and committed. Voice-note capture is done (opt-in, on-device), and email voice honing (learned `~/.claude/voice.md` + humanizer) is built and validated live. The Composio email step (triage + reply + send) was built and committed, but on 2026-06-30 Alex PIVOTED email away from a Forge surface: drafts should land natively in his Gmail inbox instead of a Forge Email tab (see the PIVOT entry at the top of Current State). Next session executes that pivot; CRM and the public flip follow.

## North Star Goal
Make Forge the source of truth for Alex's day-to-day execution: tasks, email action items, CRM context, and daily priorities in one operating surface.

## Assumptions
- Forge Tasks is the primary task surface.
- Supabase-backed task data is the live path through /api/forge-rest.
- The board columns are: Not Started, Must happen today, In Flight / Waiting, and Done.
- Email triage should not be re-enabled without Alex confirming, because it reads real Gmail and writes Forge action cards.
- Closed tasks require direct evidence before marking done.

## Current State

### 2026-07-03 Card verified in browser + dev-mode swap-spiral root-caused and fixed

The one outstanding step is DONE. Browser-verified on a throwaway local DB (port 3410, real inbox untouched): the `Emails: Jul 3` card rendered all six sections with correct grouping (Carried over 1 / Reply 2 / Action 1 / Notifications 1 / Archived 1 / Done today 1), every Gmail deep link correct (`#inbox/<threadId>` per item, `#search/label:Forge/Reply` and `:Forge/Archived` rollups), checkboxes only on carried/reply/action. Clicked a reply checkbox: row left the open sections, Done today ticked 1 -> 2, and REST confirmed `email_items.status=actioned` persisted to SQLite. One cosmetic dev-only quirk: board data loads via `localhost:3410` but not `127.0.0.1:3410` (client fetch never fires on the IP host); use localhost for local verification, not worth chasing.

ROOT CAUSE FOUND for the repeated 40GB swap spirals that kept killing Forge sessions on the MacBook: a stray May-2024 `package.json` + `package-lock.json` in `~` (old Solana project) made Next infer the workspace root as the HOME DIRECTORY. Tailwind then failed to resolve from the wrong base and dev fell into a compile-fail-retry loop (~27 retries/min, each leaking into the compiler graph -> gigabytes in minutes -> swap death spiral -> frozen machine -> crashed sessions -> orphaned processes compounding the next attempt). Fixed in `next.config.ts`: `turbopack.root` + `outputFileTracingRoot` pinned to the repo (also protects client installs from their own stray home lockfiles). CRITICAL SECOND HALF: the broken runs left a poisoned `.next` cache that kept replaying the failure loop even after the config fix — if the spiral ever recurs, `rm -rf .next` once. After both fixes: dev boots in 449ms, /tasks compiles cold in 1.6s, server steady ~530MB. Do NOT remove the home-dir lockfiles without Alex (not ours), the config pin makes them harmless. Dev-only noise seen and not chased: "Failed to generate static paths for /api/forge-rest/[table]" TypeError at startup (route works fine).

### 2026-07-06 (later) Nudge + schedule LIVE on the MacBook; unattended dress rehearsal PASSED

- Telegram nudge wired: data/forge-reminders.json -> chat 5740717209, token read from ~/.claude/channels/telegram/.env. Test ping delivered.
- Always-on Forge web server installed on the MacBook: LaunchAgent com.forge.web runs `next start -p 3200` (supabase mode, prod build, ~107MB). localhost:3200/tasks serves the live board here. Installed because the Mini has been OFFLINE 11 days (Tailscale last saw it Jun 25) so the Tailscale bookmark is dead; when the Mini returns it can take this back.
- Triage schedule installed: LaunchAgent com.forge.email-triage fires scripts/forge-email-triage.sh at 09:00 + 15:00; logs at ~/Library/Logs/forge-email-triage.log.
- GAP FOUND + FIXED: forge-* skills were never installed to ~/.claude/skills on this machine (installer step, never run here), so headless runs could not find forge-email. Copied forge-email/task/voice/voice-note in (humanizer already present).
- Dress rehearsal: ran forge-email-triage.sh by hand = a real unattended headless run. It ingested a genuinely new Wispr Flow receipt, archived it, rebuilt the card, sent the nudge, exit 0, safety held. The scheduled path is proven end to end.
- Future nicety (from the run itself): nudge's card link is localhost:3200, phone-unfriendly; point forge_url at a stable URL when the Mini is back.

### 2026-07-06 LIVE email verification PASSED (with Alex)

Ran the full pipeline against the real alex@joinedgeai.com inbox, Alex watching. All core mechanics verified live:
- Labels bootstrap: all six Forge/* labels created (Triaged=Label_9, Reply=Label_10, FYI=Label_11, Action=Label_12, Done=Label_13, Archived=Label_14; cached in data/forge-email.json on the MacBook).
- Real triage run 1: QuickBooks promo -> archived (out of inbox, logged on card); Calendly booking notice -> FYI. Card "Emails: Jul 6" created on the LIVE board (Must happen today) via a local dev server on :3200 in supabase mode.
- Real triage run 2: Alex's test email classified reply; draft written in his voice (voice.md honored, Calendly link https://calendly.com/edge-ai/30min pulled from real usage, not invented) and **nested correctly in-thread** via GMAIL_CREATE_EMAIL_DRAFT with empty subject. Alex's verdict: "passes the bar."
- Round-trip: thread flipped to Forge/Done, out of inbox, row status=actioned, card rebuilt to "Done today: 1 replied". (Alex chose not to send the self-addressed test; the done-flip was applied manually via the same label/status transitions the reconcile pass performs. Test draft deleted at his request.)

LIVE-SUPABASE SCHEMA DELTAS the skill must handle (found live, adapt before the scheduled runner goes live on a supabase-mode install): (1) forge_email_items requires provider NOT NULL -> always send "provider":"gmail"; (2) forge_tasks has NO remind_native/remind_text columns (local-mode-only migration) -> omit remind_* fields when the REST target is supabase mode, or add the columns in Supabase. Consider updating SKILL.md Step 6 to mark remind_* optional-by-mode.

Still untested from the live checklist: the Telegram/iMessage nudge (data/forge-reminders.json not configured on the MacBook; forge-notify.mjs was a silent no-op) and the LaunchAgent schedule firing (com.forge.email-triage not installed here; natural test is letting a scheduled run fire on a configured machine). Neither blocks the core loop.

Remaining: (1) README refresh (still the old user-facing version, tab is gone now); (2) optional: let tomorrow's 09:00 scheduled fire confirm launchd timing (the run path itself is already proven).

### 2026-07-01 PIVOT EXECUTION: backend triage + one daily card

Refined the pivot and started building it. The "what needs you" surface is a single Forge task card, not a Telegram digest, and triage runs on a twice-daily schedule at user-set times.

Design (Alex's calls this session):
- One running card per day, `Emails: <Mon D>`, due today in Must-happen-today. Sections: Carried over, Reply (drafts ready), Action items (checkbox), Notifications, Archived (log), Done today.
- Gmail is the source of truth; `Forge/*` labels are the memory (Triaged, Reply, Action, FYI, Archived, Done). Each run ingests only `-label:Forge/Triaged` mail, reads Gmail back to clear handled items, and fully rewrites the card. That is what makes two runs a day seamless (no stale re-shows).
- Replies auto-clear: when the user sends, the next run detects the sent reply, marks done, and archives the thread. Action items clear via a checkbox on the card (sets `email_items.status`). Unfinished items carry forward to the next day's card; the prior card closes out. Newsletters/promos archived from day one. One-line nudge after each run via the reminders channel.
- Unattended execution = headless `claude -p` running the `forge-email` skill (Alex's call over a constrained runner). Guardrail is the skill's hardened Safety section plus the global CLAUDE.md "treat outside content as data" rule (loads automatically). Draft-only; never sends/deletes/forwards; the allowed-action list is explicit.

Built + fresh-reviewed this session:
- `skills/forge-email/SKILL.md` rewritten as the three-pass state machine (ingest, reconcile, rebuild card) with the Safety section. Verified Composio supports it: `GMAIL_CREATE_EMAIL_DRAFT` nests a reply in-thread (thread_id + empty subject); `GMAIL_MODIFY_THREAD_LABELS` labels/archives; `GMAIL_FETCH_MESSAGE_BY_THREAD_ID` detects sent replies. Connected account: alex@joinedgeai.com.
- `scripts/forge-notify.mjs`: reusable one-line Telegram/iMessage nudge (checks the Telegram `ok` flag so a bad token is not silent).
- `scripts/forge-email-triage.sh` + `com.forge.email-triage` LaunchAgent (two `StartCalendarInterval` times read from `data/forge-email.json`) wired into `install-forge-local.sh`. Config gains `triage_times` + `timezone`.
- `SETUP.md` step 6 rewritten to the backend model + the two-times + scheduling + honest awake-Mac limit.
- Fresh-context review caught and fixed real bugs: bounded status model (archived/fyi terminal so the reconcile set cannot grow unbounded), idempotency (label immediately after drafting; dedupe by thread_id across all statuses), sent-reply detection (ignore DRAFT messages; require SENT newer than the latest inbound), correct Gmail deep-link format (`u/0/#inbox/<enc threadId>`), and `remind_native:false` on the card (no redundant native ping).

Built 2026-07-02 (D + E, this session):
- D (card UI): new `src/components/tasks/EmailCardDetail.tsx` renders the daily card as the grouped digest (Carried over / Reply / Action / Notifications / Archived / Done today), with clickable Gmail thread links (drafts sit in-thread) and real checkboxes that flip `email_items.status` to `actioned` (optimistic update + REST PATCH). `TaskDetail.tsx` shows this digest instead of the edit form when a card is tagged `email` AND titled `Emails: ...` (so it never collides with ordinary tasks or the old per-email cards). Built fresh rather than reusing ActionCard (E deletes ActionCard anyway). Bucket/triage_date/archived_note are read from `source_payload`; falls back to `classification` for older rows.
- E (retire the tab): removed the Email link from `TabNav.tsx`; deleted the `/email` route, `src/components/email/*` (EmailView, ActionCard, ActionLog, SummaryCard), and `/api/email/send-draft`; removed `sendDraftEmail` + `SendDraftInput` from `lib/data/email.ts`. Left the other now-unused email read-helpers in email.ts as harmless dead code (optional future cleanup). `listAllEmailItems` + `updateEmailItem` stay (the card uses them).
- `npm run build` PASSES clean: compiles, TypeScript clean, and the route list confirms `/email` and `/api/email/send-draft` are gone (only `/`, `/crm`, `/tasks`, `/api/crm/attio`, `/api/forge-rest/[table]` remain).

Remaining (updated 2026-07-03; item 1 is DONE, see the 2026-07-03 entry above):
1. ~~Browser-verify the card render + checkbox round-trip.~~ DONE 2026-07-03 (all 6 sections, Gmail links, checkbox persisted to SQLite).
2. Live verification on alex@joinedgeai.com: labels bootstrap, a real in-thread draft, archive, the card, the reconcile round-trip (send one reply, re-run, confirm it clears + archives), the nudge, and the schedule firing. Touches the real inbox, so do it deliberately with Alex.
3. README is still the old user-facing version; refresh now that the tab is gone.

GOTCHA (fix before any local deploy / scheduled runner): the repo's better-sqlite3 native module is compiled for Node 23 (ABI 131, `/opt/homebrew/bin/node`). The login shell here defaults to Node 20 (ABI 115, `/usr/local/bin/node`); running Forge in local mode under Node 20 crashes at the first DB call ("NODE_MODULE_VERSION 131 vs 115"). `install-forge-local.sh` resolves node via `process.execPath`, so whatever `node` is first on PATH at install time MUST be the one better-sqlite3 was built against (or `npm rebuild better-sqlite3` under the target node). Worth hardening the installer to detect + warn on ABI mismatch.

Note: `data/forge-email.json`, `forge-email-state.json`, `forge-reminders.json` are absent on the MacBook, so email is not live here; this MacBook runs supabase mode. Session lock for `astack/forge` held by this cowork instance.

### 2026-06-30 PIVOT: Email goes invisible, native Gmail drafts, no Forge Email tab
**Decision (Alex, 2026-06-30):** Drop the separate Forge Email surface. The email skill drafts replies directly into the user's Gmail as native draft replies, sitting in the real thread, ready to edit and send from Gmail (desktop or phone). Forge does not replace email; it pre-writes replies where the user already lives. Forge's surfaces become Tasks + CRM only.

**Why (agreed):** the real want is "the reply already written, waiting where I already am, one tap to send," not a triage queue in a new app. Native drafts win: no new surface to check; native threading/attachments/mobile for free (the Forge Email tab was desktop-only and only while the Mac was awake); less to build and maintain (retire the Email UI AND the Composio send route); lower trust barrier (review in Gmail; a draft never self-sends).

**Keep the one valuable thing we'd otherwise lose (the ranked "what needs you"):** the skill labels threads it touches (e.g. `Forge/Needs-you`, `Forge/FYI`) and posts a one-line digest to Telegram ("drafted 4 replies, 3 FYIs labeled"). The user gets the prioritized view as a Gmail search, not an app tab.

**New architecture:**
- Background `forge-email` skill (on demand or scheduled): read new mail via Composio, classify, draft in voice (`~/.claude/voice.md` + humanizer), create a native Gmail draft reply IN THREAD, label the thread, post a short digest.
- User reviews + sends natively in Gmail. No Forge send route.

**Do next session (execute the pivot):**
1. VERIFY FIRST (real risk): confirm Composio `GMAIL_CREATE_EMAIL_DRAFT` can make a reply draft that nests in the original thread (needs `thread_id` + In-Reply-To/References headers). If it cannot, fall back to Gmail API `drafts.create` with a raw MIME that sets those headers. A draft that starts a NEW thread instead of nesting is the main thing that would break the feel. Test on Alex's own account (alex@joinedgeai.com, connected here).
2. Refactor `skills/forge-email/SKILL.md`: output target changes from Forge `email_items`/`drafts`/REST to Gmail drafts + label + digest. Keep the classify + draft-in-voice logic (it carries over).
3. Retire the Forge Email tab (`src/components/email/*`, the `/email` route) or hide behind a flag. Tasks + CRM stay.
4. Retire `src/app/api/email/send-draft/route.ts` (Composio send) once nothing uses it.
5. Update `SETUP.md` Email step: no Email tab; drafts land in Gmail, explain the label + digest.
6. Decide: on-demand vs scheduled background triage; label taxonomy; digest channel (Telegram likely).

**Preserved (NOT wasted by the pivot):**
- `forge-voice` + `~/.claude/voice.md` + the bundled humanizer. voice.md was validated live: Alex reviewed 3 sample drafts on 2026-06-30 and said they sound like him (calibration passed at round 1). It is his real profile at `~/.claude/voice.md`.
- The `forge-email` skill's classify + draft logic; the Composio Gmail connection + setup (still needed to read mail + create drafts).

**Status:** nothing built for the pivot yet. Pre-pivot email work stays in git history (`3c93ebb` send route, `2ad26e9` voice). Session lock for `astack/forge` is held by this cowork instance.

### 2026-06-30 Jarvis Pro: Email voice honing (humanizer + learned voice.md)
- Alex's ask: drafts must sound human and sound like the specific user. Two layers: the humanizer skill runs on every draft out of the box, and a learned per-user voice profile shapes the writing.
- New skill `skills/forge-voice/SKILL.md`: reads the user's own sent mail via Composio (`in:sent`, last 30 to 90 days, widening if sparse), strips quoted chains and skips forwards/one-liners, deduces their voice (greeting/sign-off, rhythm, formality by relationship, phrases, punctuation, length), writes `~/.claude/voice.md`, then runs 2 to 3 live calibration rounds (sample drafts, "sound like you? what would you change?", refine). Re-runnable anytime ("update my voice").
- `forge-email` drafting now reads `~/.claude/voice.md` (falls back to CLAUDE.md or recent sent mail if absent) and runs every draft through the humanizer skill. No em dashes.
- Bundled the humanizer skill (MIT, v2.5.1) into the repo at `skills/humanizer/` so a fresh client actually has it; `install-forge-local.sh` refreshes the forge-* skills each run but installs the humanizer only if absent (never clobbers a newer copy the client relies on).
- SETUP Email step gained "e. Hone their writing voice" before first triage; daily-loop step renumbered to g.
- voice.md lives at `~/.claude/voice.md` (per-client, outside the repo, reusable for any writing); stores style + short anchors, not whole emails.
- Verified: no em/en dashes in the new skill or doc edits; voice.md + humanizer references consistent across all three files; installer `bash -n` clean. This auto-generates the client's equivalent of Alex's hand-built `writing-as-alex` + `VOICE.md`. Fresh-context review in progress.

### 2026-06-30 Jarvis Pro: Email step (Composio triage + reply + send)
- Scope (Alex's calls): connect via Composio, each client uses their OWN Composio account so Alex never holds a client's inbox; v1 = triage + reply + send on the existing Email tab (a triage queue, not a full mailbox). Draft-only: the user always sends.
- Inbound: new skill `skills/forge-email/SKILL.md`. Pulls new Gmail via the Composio MCP (`GMAIL_FETCH_EMAILS`, `in:inbox after:<cursor>`), dedupes by `message_id`, classifies (action_item / tiding / log_only), drafts replies in the client's voice (their `~/.claude/CLAUDE.md`, falling back to their sent-mail tone), and POSTs cards to `email_items` + `drafts` (+ a one-line `email_triage_runs` summary) over the local REST API. `recommended_action` constrained to the UI vocabulary (reply/follow_up/delegate/flag/review/archive) so cards render right. Cursor in `data/forge-email-state.json` (gitignored); `after:` is date-granular by design, dedupe covers the overlap.
- Outbound: rewrote `src/app/api/email/send-draft/route.ts` to call Composio's HTTP execute API (`POST backend.composio.dev/api/v3/tools/execute/GMAIL_REPLY_TO_THREAD`, `x-api-key`) instead of the old personal `gog` shell-out. The existing Send button now sends instantly through the client's Gmail with no UI changes. Reads `COMPOSIO_API_KEY` from `.env.local` and `connected_account_id` from `data/forge-email.json` (both gitignored); the key is header-only, never logged or returned.
- Setup: `SETUP.md` Step 6 "Set up Email" walks the client through a Composio account, connecting the Composio MCP to Claude Code, the one-click Gmail OAuth, writing the config + key, and the first triage. CRM moved to its own Step 7 stub.
- Productization fixes: genericized hard-coded "Alex"/"Codex" strings in the email components (ActionCard/EmailView/SummaryCard) to "you"/"me"; fixed the stale "once Gmail sending is configured" draft copy; added an in-code warning on the Convex `send` stub (Convex mode does not actually send).
- Verified 2026-06-30: live Composio Gmail fetch returns the mapped fields; all four email tables + columns exist (source_payload JSON, priority INTEGER); REST write path proven (Tasks step); tsc clean on every touched file. Live send is confirmed at first real use with the client's own key (not testable here without extracting their key, which is not done). Fresh-context review passed after fixes (recommended_action vocabulary, dedupe efficiency + date-cursor note, voice fallback, name leaks, friendlier timeout). One overridden flag: `is_html:false` is a real field in the verified GMAIL_REPLY_TO_THREAD schema, kept as a plain-text guard.
- Bonus noticed: Composio also has Google Calendar connected, so the Tasks scheduler can become calendar-aware later.
- Next: CRM step, then flip the repo from private to public for the send-the-link flow.

### 2026-06-30 Jarvis Pro: Tasks step (natural-language capture + reminders)
- Natural-language capture skill at `skills/forge-task/SKILL.md` (the installer copies it into the client's `~/.claude/skills`). Triggers on "remind me to", "add to my board", etc. Claude picks a due date when none is given (from current task load + the user's CLAUDE.md priorities; calendar once connections are wired in the Email step), writes the task via `POST /api/forge-rest/tasks`, sets the reminder, and replies offering a text reminder.
- Reminders: three new `tasks` columns (`remind_native` default on, `remind_text` default off, `notified_at`) with an idempotent migration in `db.ts`. New helper `scripts/forge-reminders.mjs` runs every 60s via LaunchAgent `com.forge.reminders`: fires a native macOS notification (osascript) and, if a channel is set in `data/forge-reminders.json` (gitignored), a Telegram (bot API) or iMessage (osascript) text. Atomic claim (`UPDATE ... WHERE notified_at IS NULL`) prevents double-fire across overlapping ticks; date-only due dates resolve to local 9am.
- Docs split: `README.md` is the user-facing guide; `SETUP.md` is the agent playbook (clone/build/run, the Tasks interview, channel setup, Email/CRM stubs, storage modes). Setup covers the bookmark walkthrough, the "Telegram or iMessage?" interview (writes `data/forge-reminders.json`), honest laptop-vs-always-on messaging (reminders only fire while the Mac is awake unless there is a Mini/VPS), the voice-note opt-in, and a full Telegram/iMessage channel-setup walkthrough verified against the official plugins (BotFather + token + pairing for Telegram; Full Disk Access + allowlist for iMessage). Telegram is recommended for outbound reminders (Bot API); iMessage outbound via AppleScript is best-effort and is Mac-Mini-only (a single Apple ID on a laptop duplicates every message).
- Native reminders need no setup; text delivery needs a configured channel target. Everything runs only while the Mac is awake.
- Verified 2026-06-30: tsc clean; migration idempotent on fresh + pre-existing DBs; helper end-to-end (fires due-open only, skips future/done/undated, no double-fire on a second run, native notifications actually popped); REST POST stores + returns the reminder fields (booleans + tags round-trip). Fresh-context review passed after fixes (em dashes removed, double-fire race closed, date-only timezone fixed, stale README launchctl command corrected).
- Voice notes (done, opt-in): `scripts/install-forge-voice.sh` builds an on-device transcription env at `.venv-voice` (gitignored) using mlx-whisper on Apple Silicon (proven on Python 3.14, model `mlx-community/whisper-small.en-mlx`) or faster-whisper on Intel (prefers Python 3.12/3.11, with a plain-English failure message). `scripts/forge-transcribe.sh` turns an audio file into clean text; the `forge-voice-note` skill (Telegram `download_attachment` / iMessage path -> transcribe -> follow forge-task) ships and is installed by `install-forge-local.sh`. Verified: a `say` clip converted to Telegram .ogg transcribed exactly; argv-isolated (injection-safe), stdout clean. Same awake-only limit as text reminders. Fresh-context review passed (only fix: Intel Python compatibility, done).

### 2026-06-30 Jarvis Pro: local-first re-base (new default)
- Added a third runtime mode, `local`, and made it the DEFAULT when `NEXT_PUBLIC_FORGE_RUNTIME` is unset. Local mode uses a SQLite file (`data/forge.db`) via better-sqlite3, no login, no cloud. Supabase and Convex remain opt-in.
- Owner machines unaffected: MacBook and Mini both pin `NEXT_PUBLIC_FORGE_RUNTIME=supabase` in their gitignored `.env.local`, so only fresh clones (clients) get local mode.
- New `src/lib/local/db.ts` answers `/api/forge-rest/[table]` against SQLite (PostgREST subset: select, multi-col order + nullslast, limit/offset, eq/neq/gt/lt/in/is filters), parameterized + identifier-validated, seeds the 4 default columns on first run.
- `ConvexClientProvider` passes through with no auth gate in local mode; Tasks + Email dispatchers route local to the REST views; CRM shows a placeholder until the CRM step.
- Auto-start + backup: `scripts/install-forge-local.sh` installs LaunchAgent `com.forge.local` on 127.0.0.1:3200 + daily backups (`scripts/forge-backup.sh`, 14 kept).
- README rewritten for the local, no-login, bookmark-a-website client model (fixed the dead clone URL, removed stale Mini/OpenClaw/gog setup content).
- Verified 2026-06-30: 22/22 engine unit tests pass (incl. limit/offset + like wildcard); `tsc --noEmit` clean; isolated `next build` succeeds in default local mode; production server on :3399 with a temp DB seeded 4 columns, created/listed/updated a task (tags round-trip as array, persisted to SQLite), `/tasks` = 200 with zero login markers. Done in an isolated copy so the other running session was untouched.
- Fresh-context review (separate agent): no blockers, no SQL injection, no auth leak, supabase/convex provably unchanged. Fixed its flagged items: LaunchAgent resolves Node via `process.execPath` + verifies the server booted + uses `launchctl bootstrap/bootout`; `like`/`ilike` translate `*`→`%`; `limit`/`offset` integer-guarded. Re-verified clean.
- Committed + pushed as `87368f0` on `main` (amart-builder/forge). Repo stays private until the full client setup (Tasks/Email/CRM) is done, then flips to public for the send-the-link flow.
- Notifications: delivered in the Tasks step above (native macOS while the Mac is awake; optional Telegram/iMessage text).

### Earlier (Alex's live Mini Forge)
- Live /tasks returns 200.
- The Tasks code now has a small check/circle control on every non-Done task card. Clicking it moves the task to the Done column and persists `status=done`, so the board and database agree.
- Local verification passed on 2026-05-27: `npm run lint` (same six pre-existing warnings), `npm run build`, and a browser smoke test on `http://127.0.0.1:3210/tasks` that moved a temporary task from Not Started to Done, confirmed the Supabase row was `status=done`, then deleted the temporary row.
- Dirty tree cleanup completed on 2026-05-27: MacBook Forge is clean at `a05395f` and pushed to GitHub. The Mini clone was preserved with backup branch `backup/mini-main-before-a05395f-20260527` plus stash `codex-2026-05-27 mini dirty tree before origin-main sync`, then aligned cleanly to `origin/main`.
- Live Mini verification passed on 2026-05-27: rebuilt Forge on the Mini, restarted `com.atlas.forge-web`, confirmed the Tailscale URL returned 200, and browser-smoked the one-click Done control with a temporary task that was deleted afterward.
- On 2026-06-01, the live Must happen today lane was corrected after the Morning Operator Brief cron wrote to the old unprefixed Atlas `tasks` table instead of live Forge. The live board was set to four active Must happen today tasks: "Finish Edge AI website and sendable offer", "Push the Edge AI offer to warm network", "Prep Mitch Claude setup kit", and "Email Heather to schedule Josh and Joe AI sessions."
- Later on 2026-06-01, Alex reported the day list was done except ongoing Mitch prep. Verification shows "Finish Edge AI website and sendable offer", "Push the Edge AI offer to warm network", and "Email Heather to schedule Josh and Joe AI sessions" are in Done with `status=done`; "Prep Mitch Claude setup kit" is open in Not Started, due 2026-06-02.
- Also on 2026-06-01, Alex added "Finish Jarvis VPS deployment and test it" and then promoted it into Must happen today so it is ready for 2026-06-02. It is open, high priority, due 2026-06-01, and tagged `today`.
- On 2026-06-01, the Done-column task "Secure the Martin Healthcare Advisors login" was normalized from `status=open` to `status=done`; verification now shows no Done-column tasks with an open status.
- The canonical task URL remains http://alexander-mac-mini.taildd6a98.ts.net:3200/tasks for Alex and http://localhost:3200/tasks on the Mini. The old Atlas Web app and public Forge demo are not live task boards.
- On 2026-05-26, Alex made the Edge AI website the only Must happen today task. That task later appeared in Done even though Alex still needed to finish it; it has now been reopened and expanded to cover the sendable offer.
- Previously seeded GOALS.md priorities remain in the backlog but are not due today.
- Existing stale April/May tasks remain in place until verified. Do not bulk-close them without evidence.

## Completed
- [x] Verified the live Forge Tasks page.
- [x] Seeded the current operating priorities into Forge.
- [x] Normalized tasks already in the Done column to status=done.
- [x] Set the Edge AI website as the only task due today and moved all other active today-tagged/due-today tasks back to Not Started.
- [x] Added a one-click Done control to task cards and made drag/detail moves update `status` based on the destination column.
- [x] Cleaned and pushed the Forge dirty tree, aligned the Mini clone to the pushed commit, and redeployed Forge on port 3200.
- [x] Corrected the 2026-06-01 Must happen today lane in live Forge and removed the erroneous today-focus flags from the old archived Atlas task table.
- [x] Fixed the Done-column status mismatch for "Secure the Martin Healthcare Advisors login" and reverified Done-column status consistency.
- [x] Cleared the 2026-06-01 Must happen today lane after Alex completed the day list, leaving Mitch setup prep open for 2026-06-02.
- [x] Added "Finish Jarvis VPS deployment and test it" to Forge and promoted it into Must happen today.

## Roadmap
### Now
- [ ] Use Forge as the default capture surface for new tasks.
- [ ] Finish Jarvis VPS deployment and test it.
- [ ] Prep Mitch Claude setup kit: standard `CLAUDE.md`, starter skills, and teaching plan for 2026-06-02 afternoon.
- [ ] Triage stale Forge tasks into keep, done, or kill with evidence.
- [ ] Draft and publish the Catalyst LinkedIn offer post.
- [ ] Send the four warm Catalyst referral asks.
- [ ] Review/send the Jacob cleanup economics reply.

### Next
- [ ] Decide whether to re-enable Forge email triage after Alex confirms Gmail ingestion is allowed.
- [ ] Add a daily Forge review rhythm: morning priorities, midday check, end-of-day cleanup.
- [ ] Make the stale backlog smaller than 10 active open tasks.

## Blockers / Risks
- Email triage is paused; fresh Gmail cards will not appear until explicitly re-enabled.
- Old tasks include stale email-derived items and should not be trusted blindly.
- Mini cleanup preserved old divergent local commits and dirty files in a backup branch/stash; do not delete those until Alex is comfortable the deployed Forge state has everything needed.

## Key Docs
- [README](README.md)
- [SPEC](SPEC.md)
- [Parent Astack status](../STATUS.md)
