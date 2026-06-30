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
- **since:** 2026-06-30T11:18:57-0400
- **task:** Re-base Forge: local SQLite default + no-login local hosting
<!-- END active-session -->

---

**Last updated:** 2026-06-30
**State:** Two tracks now. (1) Alex's live Forge still runs on the Mac Mini in Supabase mode over Tailscale, unchanged. (2) Jarvis Pro track: Forge is being productized to run fully local on a client's own MacBook (local SQLite, no login, bookmarked localhost:3200, auto-start LaunchAgent). 2026-06-30: the local-first foundation landed and was verified; setup README rewritten. Email and CRM client setup are the next steps.

## North Star Goal
Make Forge the source of truth for Alex's day-to-day execution: tasks, email action items, CRM context, and daily priorities in one operating surface.

## Assumptions
- Forge Tasks is the primary task surface.
- Supabase-backed task data is the live path through /api/forge-rest.
- The board columns are: Not Started, Must happen today, In Flight / Waiting, and Done.
- Email triage should not be re-enabled without Alex confirming, because it reads real Gmail and writes Forge action cards.
- Closed tasks require direct evidence before marking done.

## Current State

### 2026-06-30 — Jarvis Pro: local-first re-base (new default)
- Added a third runtime mode, `local`, and made it the DEFAULT when `NEXT_PUBLIC_FORGE_RUNTIME` is unset. Local mode uses a SQLite file (`data/forge.db`) via better-sqlite3, no login, no cloud. Supabase and Convex remain opt-in.
- Owner machines unaffected: MacBook and Mini both pin `NEXT_PUBLIC_FORGE_RUNTIME=supabase` in their gitignored `.env.local`, so only fresh clones (clients) get local mode.
- New `src/lib/local/db.ts` answers `/api/forge-rest/[table]` against SQLite (PostgREST subset: select, multi-col order + nullslast, limit/offset, eq/neq/gt/lt/in/is filters), parameterized + identifier-validated, seeds the 4 default columns on first run.
- `ConvexClientProvider` passes through with no auth gate in local mode; Tasks + Email dispatchers route local to the REST views; CRM shows a placeholder until the CRM step.
- Auto-start + backup: `scripts/install-forge-local.sh` installs LaunchAgent `com.forge.local` on 127.0.0.1:3200 + daily backups (`scripts/forge-backup.sh`, 14 kept).
- README rewritten for the local, no-login, bookmark-a-website client model (fixed the dead clone URL, removed stale Mini/OpenClaw/gog setup content).
- Verified 2026-06-30: 22/22 engine unit tests pass (incl. limit/offset + like wildcard); `tsc --noEmit` clean; isolated `next build` succeeds in default local mode; production server on :3399 with a temp DB seeded 4 columns, created/listed/updated a task (tags round-trip as array, persisted to SQLite), `/tasks` = 200 with zero login markers. Done in an isolated copy so the other running session was untouched.
- Fresh-context review (separate agent): no blockers, no SQL injection, no auth leak, supabase/convex provably unchanged. Fixed its flagged items: LaunchAgent resolves Node via `process.execPath` + verifies the server booted + uses `launchctl bootstrap/bootout`; `like`/`ilike` translate `*`→`%`; `limit`/`offset` integer-guarded. Re-verified clean.
- NOT yet committed or pushed (awaiting Alex's go). Open product decision: how to distribute the repo so a client's agent can clone it (the repo is currently private).
- Notifications (native macOS, even when Forge is closed) planned for the Tasks step.

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
