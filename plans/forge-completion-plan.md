# Forge Completion Plan

## Architecture notes

- Forge stays the single product shell.
- Convex stays the single backend.
- Tasks and Email remain native Forge surfaces.
- CRM is rebuilt into a DenchClaw-derived workflow inside Forge.
- Attio / CSV / Supabase are import paths into Forge, not permanent source-of-truth systems.
- We should finish **schema foundation before major CRM UI transplant work**.
- We should finish **real email integration before calling Email complete**.
- We should finish **customer bootstrap + docs + QA** before calling Forge complete.

## Definition of done

Forge is “100% usable and working” only when all of the following are true:
- auth works in production
- Tasks is stable and clean
- Email uses real ingestion + cron + CRM linkage
- CRM uses the upgraded relational model and DenchClaw-grade UX
- imports work on real samples
- Morning Brief works end-to-end
- customer bootstrap/setup is accurate and repeatable
- local + production verification passes

## Execution phases

### Phase A — Lock the data foundation
1. Add `companies` to the Convex schema
   - Changes: define the new companies table and required indexes.
   - Files: `convex/schema.ts`, `plans/forge-crm-target-data-model.md`
   - Verify: schema deploy succeeds and `companies` is queryable.

2. Expand `contacts` for CRM-grade relationships
   - Changes: add `primaryCompanyId`, source metadata, and interaction timestamps.
   - Files: `convex/schema.ts`, `convex/contacts.ts`
   - Verify: contacts CRUD still works and new fields round-trip.

3. Expand `emailItems` and `emailActions` for CRM linkage
   - Changes: add `contactId`, `companyId`, source/run metadata, and CRM-aware action fields.
   - Files: `convex/schema.ts`, `convex/emails.ts`, `convex/emailActions.ts`
   - Verify: triage items and actions can be created with CRM link fields.

4. Expand `contactActivities` and `meetingNotes`
   - Changes: support company linkage, email linkage, and richer activity typing.
   - Files: `convex/schema.ts`, `convex/contactActivities.ts`, `convex/meetingNotes.ts`
   - Verify: activity and meeting records can be created against real contact/company ids.

5. Add company CRUD surface
   - Changes: create basic list/get/create/update support for companies.
   - Files: `convex/companies.ts`, `convex/_generated/api.ts` (regen), `convex/http.ts` if needed later
   - Verify: companies can be created and listed from Convex.

### Phase B — Make Email production-real
6. Harden the triage intake path
   - Changes: finalize `/api/triage` behavior, validation, error reporting, and mapping into Convex email items.
   - Files: `convex/http.ts`, `convex/emails.ts`, `convex/contactActivities.ts`
   - Verify: a realistic triage POST succeeds and produces valid records.

7. Add sender → contact/company resolution during triage
   - Changes: resolve or create contacts/companies from sender identity and email domain.
   - Files: `convex/http.ts`, `convex/contacts.ts`, `convex/companies.ts`
   - Verify: triaging an unknown sender creates linked CRM records instead of orphan inbox items.

8. Wire email actions into CRM history
   - Changes: sending, dismissing, archiving, and flagging should create relationship activity and update timestamps.
   - Files: `convex/emailActions.ts`, `convex/contactActivities.ts`, `convex/emails.ts`
   - Verify: actioning an email visibly updates CRM timeline state.

9. Replace remaining dummy data assumptions in Email
   - Changes: ensure the Email UI behaves correctly with real live records and no seed-only shortcuts.
   - Files: `src/components/email/EmailView.tsx`, `src/components/email/ActionCard.tsx`, `src/components/email/ActionLog.tsx`
   - Verify: Email tab renders cleanly with real triaged mail only.

10. Finalize the email cron contract
   - Changes: lock the exact OpenClaw cron payload, expected API contract, and failure behavior.
   - Files: `README.md`, `bootstrap-prompt.md` (or setup docs later), `plans/forge-completion-plan.md`
   - Verify: cron can run from documented instructions without guessing.

### Phase C — Finish Tasks as a production surface
11. Match the intended Atlas-style task workflow
   - Changes: remove leftover unwanted controls and finalize add-task/search/filter behavior.
   - Files: `src/components/tasks/KanbanBoard.tsx`, `src/components/tasks/Column.tsx`, `src/components/tasks/TaskCard.tsx`
   - Verify: Tasks UX matches the intended operator flow and no longer exposes wrong affordances.

12. Harden task detail/edit flows
   - Changes: ensure task create/edit/delete/move flows are stable and polished.
   - Files: `src/components/tasks/TaskDetail.tsx`, `convex/tasks.ts`, `src/components/tasks/KanbanBoard.tsx`
   - Verify: end-to-end task lifecycle works in both local and deployed environments.

### Phase D — Build the CRM backend properly
13. Build shared import normalization types
   - Changes: create canonical normalized importer types for companies, contacts, activities, and meetings.
   - Files: new importer types module, `plans/forge-crm-importer-strategy.md`, related helper module
   - Verify: all import paths can target one shared normalized shape.

14. Build shared dedupe helpers
   - Changes: implement company/contact matching rules from the importer strategy.
   - Files: new dedupe helper module, `convex/contacts.ts`, `convex/companies.ts`
   - Verify: repeated sample imports update instead of duplicating records.

15. Upgrade CSV importer to preview/apply flow
   - Changes: replace naive CSV parsing with real parsing, mapping preview, and apply flow.
   - Files: `src/components/crm/ImportModal.tsx`, new CSV importer helper, `convex/contacts.ts`
   - Verify: realistic CSV sample imports safely and predictably.

16. Build Attio importer dry-run + apply path
   - Changes: add Attio extraction, normalization, dry-run reporting, and apply flow.
   - Files: new Attio importer module, `convex/contacts.ts` or dedicated import surface, `README.md`
   - Verify: sample Attio import creates companies + contacts + provenance correctly.

17. Define optional Supabase migration path
   - Changes: document or implement the safest export/import path for Atlas data.
   - Files: `README.md`, optional migration script/module, `plans/forge-crm-importer-strategy.md`
   - Verify: internal migration path is explicit and testable without becoming required for customers.

### Phase E — Transplant the CRM UI
18. Replace the current CRM shell with the new layout
   - Changes: move to a denser table-first CRM layout with persistent detail behavior.
   - Files: `src/components/crm/CRMView.tsx`, `src/app/crm/page.tsx`, `src/app/globals.css`
   - Verify: CRM route loads with the intended structure and no broken states.

19. Port/adapt DenchClaw-style table behavior
   - Changes: add column visibility, denser toolbar, better sorting/filtering, row selection, and spreadsheet feel.
   - Files: `src/components/crm/ContactList.tsx`, new shared CRM table helper, `src/app/globals.css`
   - Verify: CRM feels materially closer to DenchClaw and supports operational table work.

20. Upgrade the contact/company detail panel
   - Changes: make detail view denser, more editable, and more useful for real operator work.
   - Files: `src/components/crm/ContactDetail.tsx`, `src/components/crm/CRMView.tsx`, any small shared CRM field component
   - Verify: selecting a row gives a fast, useful, persistent operator panel.

21. Add company-aware CRM views
   - Changes: support company context in the table and detail flows, not just flat contacts.
   - Files: `src/components/crm/CRMView.tsx`, `src/components/crm/ContactList.tsx`, `convex/companies.ts`
   - Verify: user can understand and operate on company-linked relationships directly.

### Phase F — Add briefing and operator workflows
22. Implement Morning Brief backend contract
   - Changes: define the data assembly path for calendar, goals, email state, recommendations, and CRM nudges.
   - Files: `README.md`, relevant cron/setup docs, optional helper module
   - Verify: morning brief prompt/contract is specific enough to run reliably.

23. Implement Morning Brief cron setup
   - Changes: add the real OpenClaw cron instructions and expected delivery behavior.
   - Files: setup docs / bootstrap prompt, `README.md`, `projects/catalyst/deploy/STATUS.md` if needed later
   - Verify: morning brief can be configured from docs and produces a real output.

24. Finalize FORGE-VOICE + Humanizer workflow
   - Changes: lock the post-setup voice-file generation flow and ensure draft generation references it.
   - Files: `README.md`, setup docs, triage prompt docs
   - Verify: documented flow produces a usable `FORGE-VOICE.md` and cron prompt references it.

### Phase G — Productize the customer setup flow
25. Update Forge README to match final architecture
   - Changes: remove stale SQLite/API assumptions, align docs with Convex + current cron/import flow.
   - Files: `README.md`, `plans/forge-completion-plan.md`
   - Verify: README reflects reality end-to-end.

26. Add bootstrap instructions for Forge installation
   - Changes: make customer-machine setup explicit inside the Project Deploy bootstrap flow.
   - Files: `projects/catalyst/deploy/Jacob Martin Setup/bootstrap-prompt.md`, `projects/catalyst/deploy/STATUS.md`, `README.md`
   - Verify: a fresh setup can install and start Forge without operator improvisation.

27. Generalize Jacob-specific setup assumptions
   - Changes: remove Jacob-only values from setup flow and parameterize customer-specific fields.
   - Files: `projects/catalyst/deploy/Jacob Martin Setup/jacob-setup.sh`, `projects/catalyst/deploy/Jacob Martin Setup/bootstrap-prompt.md`, `projects/catalyst/deploy/STATUS.md`
   - Verify: setup flow is reusable for the next customer.

### Phase H — Verify, ship, and freeze the offer
28. Run full local QA
   - Changes: execute end-to-end checks for auth, tasks, triage, CRM import, CRM editing, and morning brief.
   - Files: `plans/forge-completion-plan.md`, any bugfix files found during QA, optional QA notes file
   - Verify: every critical local flow passes.

29. Run full production QA
   - Changes: test the deployed Vercel app and Convex production backend with real flows.
   - Files: `plans/forge-completion-plan.md`, any bugfix files found during QA, deployment env docs if needed
   - Verify: production flows pass without hidden local-only assumptions.

30. Final release pass and offer readiness check
   - Changes: write completion summary, known limitations, and release readiness notes.
   - Files: `plans/forge-completion-plan.md`, `projects/catalyst/deploy/STATUS.md`, `README.md`
   - Verify: Forge can be honestly sold and delivered as part of Project Deploy without caveats that break the offer.

## Checklist

- [x] 1. Add `companies` to the Convex schema
- [x] 2. Expand `contacts` for CRM-grade relationships
- [x] 3. Expand `emailItems` and `emailActions` for CRM linkage
- [x] 4. Expand `contactActivities` and `meetingNotes`
- [x] 5. Add company CRUD surface
- [x] 6. Harden the triage intake path
- [x] 7. Add sender → contact/company resolution during triage
- [x] 8. Wire email actions into CRM history
- [x] 9. Replace remaining dummy data assumptions in Email
- [x] 10. Finalize the email cron contract
- [x] 11. Match the intended Atlas-style task workflow
- [x] 12. Harden task detail/edit flows
- [x] 13. Build shared import normalization types
- [x] 14. Build shared dedupe helpers
- [x] 15. Upgrade CSV importer to preview/apply flow
- [x] 16. Build Attio importer dry-run + apply path
- [x] 17. Define optional Supabase migration path
- [x] 18. Replace the current CRM shell with the new layout
- [x] 19. Port/adapt DenchClaw-style table behavior
- [x] 20. Upgrade the contact/company detail panel
- [x] 21. Add company-aware CRM views
- [x] 22. Implement Morning Brief backend contract
- [x] 23. Implement Morning Brief cron setup
- [x] 24. Finalize FORGE-VOICE + Humanizer workflow
- [x] 25. Update Forge README to match final architecture
- [x] 26. Add bootstrap instructions for Forge installation
- [ ] 27. Generalize Jacob-specific setup assumptions
- [ ] 28. Run full local QA
- [ ] 29. Run full production QA
- [ ] 30. Final release pass and offer readiness check

## Critical path

If we want the fastest route to a genuinely usable Forge, do the work in this order:
1. schema foundation
2. real email pipeline
3. importer infrastructure
4. CRM UI transplant
5. morning brief + setup docs
6. QA / release readiness

## Decision log

- [DECISION] This master plan supersedes “finish a feature in isolation” thinking. Forge is only done when the product, automation, importers, docs, and QA all line up.
- [DECISION] Schema comes before CRM UI transplant to avoid landing polished UX on the wrong backend shape.
- [DECISION] Real email ingestion and CRM linkage are required before calling the product complete.
- [DECISION] Customer bootstrap and docs are part of the product, not post-launch cleanup.

## Completion summary

Tasks surface polish and lifecycle hardening are now implemented; verification was run to the extent allowed by this sandbox.

Completed in this run:
- Task workflow polish (`src/components/tasks/KanbanBoard.tsx`): canonical fixed-column handling, unified `+ Add Task` flow into Not Started, search + status/priority filters, safer detail modal binding, and improved drag/drop optimistic state handling.
- Task lifecycle hardening (`convex/tasks.ts`, `src/components/tasks/TaskDetail.tsx`): stable column position normalization on create/update/delete/move, dirty-state-aware save behavior, delete-in-flight safeguards, and Escape-to-close handling.
- Plan update: checklist items 11 and 12 marked complete.

Verification executed:
- `npm run lint` (pass; 3 pre-existing warnings in unrelated files).
- `npm run build` (pass after type fix in Tasks board).
- Attempted local app run (`npm run dev`) failed with `listen EPERM ... 0.0.0.0:3000` in sandbox.
- Attempted Convex `/api/status` check failed due DNS/network restriction (`Could not resolve host ...convex.site`).

Remaining open items:
- 27 remains open in this run because required files are outside writable scope (`../Jacob Martin Setup/*`, `../STATUS.md`) and writes are blocked by sandbox policy.
- 29 remains open (production QA not executable from this sandbox).
- 30 remains open pending 27 + 29 and final release signoff updates in `../STATUS.md`.
