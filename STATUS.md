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
- **system:** none
- **device:** —
- **since:** —
- **task:** —
<!-- END active-session -->

---

**Last updated:** 2026-05-27
**State:** Live Forge is being used as Alex's task command center. The Tasks board is reachable from Alex's MacBook at http://alexander-mac-mini.taildd6a98.ts.net:3200/tasks and from the Mini at http://localhost:3200/tasks.

## North Star Goal
Make Forge the source of truth for Alex's day-to-day execution: tasks, email action items, CRM context, and daily priorities in one operating surface.

## Assumptions
- Forge Tasks is the primary task surface.
- Supabase-backed task data is the live path through /api/forge-rest.
- The board columns are: Not Started, Must happen today, In Flight / Waiting, and Done.
- Email triage should not be re-enabled without Alex confirming, because it reads real Gmail and writes Forge action cards.
- Closed tasks require direct evidence before marking done.

## Current State
- Live /tasks returns 200.
- The Tasks code now has a small check/circle control on every non-Done task card. Clicking it moves the task to the Done column and persists `status=done`, so the board and database agree.
- Local verification passed on 2026-05-27: `npm run lint` (same six pre-existing warnings), `npm run build`, and a browser smoke test on `http://127.0.0.1:3210/tasks` that moved a temporary task from Not Started to Done, confirmed the Supabase row was `status=done`, then deleted the temporary row.
- Dirty tree cleanup completed on 2026-05-27: MacBook Forge is clean at `a05395f` and pushed to GitHub. The Mini clone was preserved with backup branch `backup/mini-main-before-a05395f-20260527` plus stash `codex-2026-05-27 mini dirty tree before origin-main sync`, then aligned cleanly to `origin/main`.
- Live Mini verification passed on 2026-05-27: rebuilt Forge on the Mini, restarted `com.atlas.forge-web`, confirmed the Tailscale URL returned 200, and browser-smoked the one-click Done control with a temporary task that was deleted afterward.
- On 2026-05-26, Alex made the Edge AI website the only Must happen today task. The board now has 33 tasks total and exactly 1 active task in Must happen today: "Build Edge AI website and call-request form."
- Previously seeded GOALS.md priorities remain in the backlog but are not due today.
- Existing stale April/May tasks remain in place until verified. Do not bulk-close them without evidence.

## Completed
- [x] Verified the live Forge Tasks page.
- [x] Seeded the current operating priorities into Forge.
- [x] Normalized tasks already in the Done column to status=done.
- [x] Set the Edge AI website as the only task due today and moved all other active today-tagged/due-today tasks back to Not Started.
- [x] Added a one-click Done control to task cards and made drag/detail moves update `status` based on the destination column.
- [x] Cleaned and pushed the Forge dirty tree, aligned the Mini clone to the pushed commit, and redeployed Forge on port 3200.

## Roadmap
### Now
- [ ] Use Forge as the default capture surface for new tasks.
- [ ] Build the clean Edge AI website with a schedule/request-call CTA and a business intake form.
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
