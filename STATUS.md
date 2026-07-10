# Forge - STATUS

<!-- BEGIN repo-identity -->
## Repo Identity
- **group_id:** forge
- **canonical_repo:** projects/astack/forge
- **macbook_path:** /Users/alexanderjmartin/Atlas/projects/astack/forge
- **mac_mini_path:** /Users/alexandermartin/Desktop/Atlas/projects/astack/forge
- **github:** public `amart-builder/forge`, clean on `main` as of 2026-07-10 commit `63ac66d`
- **default_branch:** main
- **owned_by:** shared
- **deploy:** http://localhost:3200 on the Mac Mini; Alex's MacBook URL is http://alexander-mac-mini.taildd6a98.ts.net:3200/tasks
- **never_commit:** .env*, data/forge.db*, secrets, private email/task/contact exports
- **push:** use the repo safe-push flow when this repo is clean enough to commit; never raw git push
<!-- END repo-identity -->

<!-- BEGIN active-session -->
## Active Session
- **system:** none
- **device:** —
- **since:** —
- **task:** —
<!-- END active-session -->

---

**Last updated:** 2026-07-10 (Morning Arrival Claude planning and execution layer live locally)
**State:** The MacBook's loopback-only `com.forge.web` now serves the wide Morning Arrival with bounded Claude refinement, explicit execution modes, durable background runs, and reviewable results. `com.forge.claude-worker` is installed and healthy for prompt refinement and plan sessions. Autonomous execution remains disabled until an allowlisted project is deliberately configured. The 8 a.m. trigger is still not installed. Email triage remains a separate Mini service and was not changed.

## North Star Goal
Make Forge the source of truth for Alex's day-to-day execution: tasks, email action items, CRM context, and daily priorities in one operating surface.

## Assumptions
- Forge Tasks is the primary task surface.
- Supabase-backed task data is the live path through /api/forge-rest.
- The board columns are: Not Started, Must happen today, In Flight / Waiting, and Done.
- Email triage should not be re-enabled without Alex confirming, because it reads real Gmail and writes Forge action cards.
- Closed tasks require direct evidence before marking done.

## Current State

### 2026-07-10 Morning Arrival Claude execution layer implemented and dogfood-ready

- Morning Arrival now includes a live Claude prompt below the three priorities. Claude can propose and atomically apply only title, outcome, definition of done, owner, and order changes. Evidence, deadlines, task IDs, execution settings, and underlying Supabase tasks remain outside that boundary.
- Claude and Together cards require an explicit execution mode before anything launches. Plan mode creates a real resumable Claude session with no file tools. Together always uses Plan. Autonomous is available only after selecting an allowlisted clean Git project, setting a capped budget, and enabling the separate execution switch; it has no Bash or network tool and stops at Awaiting review.
- Assistant turns, execution configuration, and run state live in separate SQLite tables. Exact brief and authorization hashes bind a run to its approved mode, model, workspace, and budget. Configuration changes cancel stale queued work, failed or cancelled runs can be retried as a new attempt, duplicate clicks remain idempotent, and Start My Day queues ready cards atomically while reporting unready ones.
- The supervised `com.forge.claude-worker` LaunchAgent is installed locally with a fresh heartbeat, private 0600 logs, cancellation, stale-process recovery, TERM-to-KILL escalation, and truthful Queued / Working / Plan ready / Ready to join / Awaiting review states. The browser API omits local paths and process IDs.
- Successful Claude output is stored as a bounded public result summary and rendered for review on the card. Exit 0 never marks the underlying task complete.
- Real isolated acceptance passed against Claude Code 2.1.202: bounded prompt refinement applied an owner change, a resumable Plan session reached Plan ready, and an Autonomous run in a throwaway clean repository created only its requested marker file and stopped at Awaiting review. No live Forge task or Atlas repository was used for these runs.
- Production build and local services are healthy. Browser QA at 1440 by 900 confirmed all three cards, the prompt composer, and Start My Day fit in one screen with no horizontal overflow or console errors. The live plan was not mutated during browser verification.
- Verification is green with 98 tests, TypeScript, scoped/full ESLint with only two unrelated existing warnings, installer syntax, host rejection, service heartbeat checks, and independent security re-review.

Next gate: use the prompt and Plan kickoff on one real morning task, review the returned plan in Forge, and observe whether the controls feel too dense. Do not enable Autonomous for a real project until that repository is clean, explicitly allowlisted, and the task has a concrete definition of done. A direct one-click Terminal resume action remains optional polish; the resumable session and plan are already created and the bounded result is visible in Forge.

### 2026-07-10 Local Morning Command Center dogfood gate prepared

- Rebuilt `codex/morning-command-center` and rebootstrapped the existing MacBook `com.forge.web` service without running the broad installer. The service now binds only to `127.0.0.1:3200` and sets `FORGE_DAY_PLAN_ACCESS_MODE=loopback`.
- Runtime verification passed: `/tasks` and the local day-plan route return 200, a public Host header returns 403, and the loaded LaunchAgent contains the expected bind and access mode.
- The MacBook email-triage, reminders, duplicate `com.forge.local`, and arrival-trigger agents remained absent. The retired email-triage plist was not touched.
- Supervised dry-run pulses passed for valid config, before-time suppression, a due morning, quiet-date suppression, overlapping-run locking, and unavailable-server fail-closed behavior. No receipt, persistent config, browser open, or arrival LaunchAgent was created.
- The first live dogfood load exposed one real boundary mismatch: a 2,685-character task description exceeded the Day Plan API's 1,200-character outcome limit, so Arrival failed before opening. Candidate display prose now shortens to the API contract with an ellipsis while preserving the underlying task; oversized identity metadata falls back safely instead of collapsing tasks, and ritual initialization errors remain visible alongside other warnings.
- Fresh verification passed with 69 tests, TypeScript, scoped ESLint, production build, live candidate parsing, and an independent delta review. The first real Morning Arrival is now open locally with three task-backed recommendations.
- Second dogfood refinement: desktop Morning Arrival now shows all three priorities left-to-right in one wide pane. Collapsed cards contain the title, a bounded short summary, optional useful project pill, a drag handle, and Details. Full source task descriptions, owner controls, rationale, deadline, and Not today live behind Details. Suggested labels and Move up/down controls are gone.
- Browser acceptance passed at a 1440 by 900 desktop viewport and the narrower fallback: all three cards are simultaneously visible on desktop, the live 2,685-character description remains readable in Details, Escape closes Details and returns focus without bypassing the ritual, and keyboard drag persistence was verified before restoring the original priority order.
- Third dogfood refinement: the visible Details button is gone. Clicking a card's non-interactive surface now opens or closes its full details, while the dedicated drag handle and Me / Claude / Together controls keep their own interaction boundaries. Cards gain a subtle 1.01 scale, 4px lift, and stronger shadow on hover/focus, with transforms disabled for reduced-motion users and while dragging.
- Live acceptance confirmed whole-card disclosure, the complete 2,685-character source description, owner clicks that do not toggle details, unchanged ownership/order, and computed hover motion. Ownership truth remains explicit: Claude or Together selections say execution has not started.
- Recovery copies are retained at `~/Library/LaunchAgents/com.forge.web.plist.before-morning-command-center.20260710-135843` and `~/Library/Application Support/Forge/backups/.next.before-morning-command-center.20260710-135843` until dogfood is stable.

Next gate: use the refined Morning Arrival to start the first real planned day, then dogfood Morning Arrival and Day Settlement on four of five workdays. Measure time from laptop open to intentional first work and record any moment where Forge feels interruptive, unclear, or untrustworthy. Do not install the 8 a.m. trigger yet.

### 2026-07-10 Morning Command Center Phase 0 / 1A dogfood slice implemented

- Branch `codex/morning-command-center` now adds a durable SQLite Day Plan, append-only decision events, Day Snapshots, and a task-reconciliation ledger with expected-version and idempotency controls.
- Morning Arrival is a translucent guided layer over Living Current. It uses up to three current Today / In Flight tasks, explains the recommendation, shows project and ownership, supports pointer and keyboard reordering, expansion, Snooze, Skip, bypass, and a non-destructive Not today action. Cards remain `preselected` until Start My Day records the actual human confirmation.
- Start My Day gives one truthful transition and routes Living Current to a real Me / Together focus or an honest Claude handoff brief. No Claude execution, kickoff, overnight work, or fake working state exists in this slice.
- Day Settlement is manually available with Carry, Defer, and Drop. Drop explicitly archives the underlying task. Defer moves work to Not Started and durably schedules it to resurface in Today after seven days. Interrupted task reconciliation retries from the ledger. A missed prior-day Settlement opens before the next Morning Arrival rather than suppressing or misdating it.
- The macOS arrival trigger exists only as a reversible dry-run spike. It is not installed or wired into the main installer. It models an 08:00 LaunchAgent pulse, wake/login catch-up, workdays and quiet dates, receipts, snooze, prior-day recovery, and fail-closed behavior. Duplicate-tab behavior and live launch reliability still require supervised testing.
- Day-plan routes deny access when no server-owned access mode is configured. Local dogfood explicitly uses `FORGE_DAY_PLAN_ACCESS_MODE=loopback` while the server is bound to `127.0.0.1`. Non-loopback access requires session mode plus a separate proxy-injected secret in addition to trusted-host and CSRF checks; the browser does not inject that secret yet.
- Validation is green: 66 state/API/schedule tests, TypeScript, scoped ESLint, production builds, desktop and 390px browser QA, focus trapping, reload persistence, Not today preservation, Start My Day routing, Settlement reconciliation, overdue defer/resurface ordering, and missed-day recovery.
- QA incident: the first browser harness inherited the build's Supabase runtime and created three clearly named QA tasks in the live task API. Those exact three IDs were immediately deleted and verified absent; no existing task was edited. Later browser runs rebuilt in local mode and used isolated SQLite files.
- Not included yet: installed 8 a.m. launch behavior, scheduled Settlement, prompt-box refinement, direct Edit / Later controls, Claude session kickoff, autonomous runs, and overnight execution.

The server-only rebootstrap and supervised dry-run gate above supersede this section's original next step. Do not install the trigger or deploy this branch to clients before the four-of-five-day observation.

### 2026-07-10 Living Current T1-T3 deployed and canary-verified

- Merged PR #2 to `main` at `63ac66d` and deployed it to `com.atlas.forge-web` on the Mac Mini. Canonical live surface: http://alexander-mac-mini.taildd6a98.ts.net:3200/tasks.
- T1 makes state honest: the surface distinguishes committed work, Jarvis-held work, email briefs, loading, stale saved data, and retryable failures without implying work happened when it did not.
- T2 gives Later one deliberate return at the next local 5:00 AM seam, preserves refined wording, respects real expiry, handles legacy deferred records, and keeps undo idempotent.
- T3 hydrates a validated three-day arrival snapshot before paint, keeps optimistic work out of persistent storage, tracks server-confirmed mutation baselines, and refreshes without overwriting in-flight work.
- Request hardening now restricts Forge REST and Quiet Current to configured hosts, origins, and protocols. Live canary confirmed trusted requests return 200 and untrusted host requests return 403.
- Verification is green on both machines: 27 of 27 tests, lint with zero errors and two unrelated existing warnings, production build, desktop and mobile browser canary, no console errors, no horizontal overflow, and a 201 focus-change event.
- Fable 5's full review and a final fresh-context delta review found no P0 to P2 release blockers.
- Product gate: observe at least one real Jarvis Pro client using Forge without hands-on help before expanding into T4 delegation autonomy. Use that session to learn the actual morning ritual, switching behavior, and points of confusion.

### 2026-07-08 Mini is BACK and now owns email triage (Codex engine, VERIFIED LIVE)

The whole Mini queue from 07-07 is done and proven:

- **Mini repo synced**: the "dirty" files were Syncthing copies of already-pushed work (proven byte-identical to origin/main per file before touching anything); stashed as a safety net (`stash@{0}` on the Mini, droppable) and fast-forwarded d587be5 -> 2cf9668. Note: `~/Desktop/Atlas` on the Mini is now a SYMLINK to `~/Atlas` (moved 2026-07-07, presumably for the TCC/launchd problem); same repo, two paths.
- **Codex CLI installed on the Mini** (npm, codex-cli 0.143.0) and logged in WITHOUT re-auth by copying `~/.codex/auth.json` from the MBP (ChatGPT login). Flags verified against real `--help`: `-m`, `-c key=value`, `--dangerously-bypass-approvals-and-sandbox`, stdin `-` all parse. The runner's flag spellings were right.
- **Composio wired into Codex**: `~/.codex/config.toml` on the Mini points at the hosted Composio MCP (same API key header as the MBP's Claude config). Live smoke test: codex called COMPOSIO_SEARCH_TOOLS and got GMAIL_FETCH_EMAILS back.
- **Supabase-mode skill fixes landed** (2cf9668): email_items POST now includes `"provider":"gmail"` (NOT NULL on live table) and Step 6 documents the remind_* retry for supabase installs missing those columns.
- **Mini forge rebuilt + serving**: `.env.local` was MISSING on the Mini (first rebuild silently came up in local SQLite mode!); copied from the MBP, rebuilt, com.atlas.forge-web kickstarted, board at :3200 serves the real Supabase columns.
- **FIRST SUPERVISED CODEX TRIAGE PASSED** (gpt-5.5, xhigh, exit 0, ~116k tokens): real inbox run drafted a reply to Heather Martinelli in-thread (draft r-1252160083511349427), filed 2 action items (Jay Miller meeting notes to-do, Cloudflare domain expiry), archived 1 login link, rebuilt "Emails: Jul 8" on the live board, stamped the cursor. Telegram from the Mini verified with a delivered test ping.
- **Schedule moved**: com.forge.email-triage now on the Mini (09:00/13:00/17:00; weekdays guard lives in the script) with PATH incl. /opt/homebrew/bin (codex's node shebang needs it; manual runs must export it too). MBP's triage agent booted out, plist kept as `.retired-20260708`. MBP keeps com.forge.web so the laptop bookmark still works (both point at the same Supabase data).
- STILL OPEN: Alex to judge the Heather draft (only 1 reply draft in this run; calibration wants 2-3 before full trust); nudge card link still `localhost:3200` (phone-unfriendly); public-flip decision.

### 2026-07-07 CRM step BUILT + browser-verified (last surface before the public flip)

Local-mode CRM is live. New `src/components/crm/LocalCRMView.tsx` (two panes: searchable contact list + detail with notes/tier/tags/how-we-met, activity timeline, add-contact form with create-new-company) consumes the previously dead `src/lib/data/crm.ts` REST functions; `CRMView.tsx` local branch swapped from the placeholder (supabase/Attio and convex branches untouched, verified by diff). Built by an Opus subagent from spec; its fresh-context review fixed 3 real bugs (silent catch on the last-contact touch, crash on empty PATCH return, tag dedupe). Browser-verified end to end on the throwaway DB (port 3410): created Sarah Chen + Chen Plumbing through the UI form, how_we_met saved on blur, meeting activity posted + timeline rendered + `last_interaction_at` touched (list re-sorted), search matches company names and shows a clean empty state, all rows confirmed persisted via REST, zero console errors. tsc clean.

New `skills/forge-contact/SKILL.md`: natural-language capture (dedupe-first, resolve-or-create company, log activity + touch last contact, chain follow-ups into forge-task), "who is X" briefings, CSV import with confirm-the-mapping. Installer picks it up automatically (copies all skills/forge-*). SETUP.md step 7 rewritten from stub to the real client walkthrough (2-question interview, optional import, demo capture).

Skipped for v1 (deliberate): meeting_notes table, CSV-import API route (Claude imports via REST), editing companies in the UI. SPEC.md's /api/contacts/* routes are stale spec, not gaps.

NEXT: the public repo flip (needs Alex's explicit go). After that Forge is fully productized: Tasks + Email + CRM all built and verified.

### 2026-07-07 (later) Engine-aware triage (Codex option) + public-flip sweep CLEAN

- **Triage runner is now engine-aware**, for Alex's own machines (clients stay on Claude by default): `data/forge-email.json` gains `engine` ("claude" default | "codex"), `codex_model` (default "gpt-5.5"), `codex_reasoning` (default "xhigh"), and `weekdays_only` (guard in the script via `date +%u`, NOT launchd Weekday keys). `triage_times` takes N entries; Alex wants 3x weekdays at 09:00/13:00/17:00 PT. The Codex path pipes the repo's `skills/forge-email/SKILL.md` plus an unattended-safety preamble into `codex exec` on stdin. UNVERIFIED and blocking before the Codex schedule goes live: the codex CLI flag spellings (`-m`, `-c model_reasoning_effort=`, `--dangerously-bypass-approvals-and-sandbox`) were written from conventions, codex is not installed on the MBP. At Mini install time: run one live supervised `codex exec` triage, verify flags parse, and have Alex judge 2 to 3 GPT-5.5 drafts (voice recalibration) before trusting it unattended.
- **Public-flip secrets sweep: CLEAN TO FLIP.** Full 30-commit history swept: zero live secrets, no .env or db file ever committed, fixtures are synthetic @example.com personas, .gitignore solid. Recommendation to Alex (his call pending): publish via a fresh-history public mirror repo (e.g. amart-builder/forge-app) instead of flipping this repo, because this repo's STATUS.md history carries client names, a Telegram chat id, the Tailscale hostname, and internal ops narrative.
- **Queued for the Mini's return:** pull repo, install the runner + verify codex flags, supervised first Codex triage + draft calibration, move the triage schedule and `forge_url` off the laptop, retire the laptop's `com.forge.web` + `com.forge.email-triage` once the Mini owns them, restore jarvis-memory.

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
