# Forge CRM Transplant Plan

## Architecture notes

- Keep Forge as the only app shell.
- Keep Convex as the only backend.
- Port DenchClaw's CRM interaction model, not its entire application runtime.
- Treat Attio, Supabase, and CSV as import/migration paths into Forge.
- Favor small port slices that can be verified independently.

## Execution phases

### Phase A — Audit + target model
1. Audit DenchClaw CRM surface area
   - Changes: identify exact UI/data components worth porting from DenchClaw and bucket them into port / rewrite / ignore.
   - Files: `plans/forge-crm-transplant-spec.md`, `plans/forge-crm-transplant-plan.md`, audit notes file if needed.
   - Verify: written inventory exists with explicit decisions for object table, data table, detail panel, filters, and generic workspace shell.

2. Define Forge CRM target data model
   - Changes: decide which current Convex tables remain, which new CRM fields/entities are needed, and how email writes into CRM.
   - Files: `convex/schema.ts`, `plans/forge-crm-transplant-plan.md`, follow-up migration notes.
   - Verify: schema delta is documented and each new field/entity has a purpose.

3. Define importer strategy
   - Changes: specify Attio import path, CSV import path, and optional Supabase import path.
   - Files: `README.md`, importer plan notes, possible `plans/forge-importers-plan.md` split later.
   - Verify: import sources, required credentials, and output mapping are documented.

### Phase B — CRM UI transplant
4. Replace current CRM shell with DenchClaw-style layout
   - Changes: move CRM from basic list/detail into table-first layout with denser header controls and a persistent detail panel.
   - Files: `src/components/crm/CRMView.tsx`, `src/app/crm/page.tsx`, `src/app/globals.css`.
   - Verify: CRM route loads with table + controls + detail panel and no broken layout states.

5. Port/adapt DataTable behavior
   - Changes: add column visibility, denser toolbar, sortable headers, selection behavior, and row-first workflow inspired by DenchClaw.
   - Files: `src/components/crm/ContactList.tsx`, new shared table helper if needed, `src/app/globals.css`.
   - Verify: user can sort, search, toggle columns, select rows, and click into details.

6. Upgrade contact detail panel
   - Changes: make detail panel denser and more operational; support notes, activity timeline, tags, company context, and edit states.
   - Files: `src/components/crm/ContactDetail.tsx`, `src/components/crm/CRMView.tsx`, supporting shared components if created.
   - Verify: selecting a row updates the detail panel reliably and edits persist.

7. Add company-aware CRM views
   - Changes: support company grouping / company-derived views rather than only flat contacts.
   - Files: `convex/contacts.ts`, `src/components/crm/CRMView.tsx`, `src/components/crm/ContactList.tsx`.
   - Verify: user can see company context directly in CRM and not just raw contact rows.

### Phase C — CRM data + imports
8. Expand Convex schema for real CRM use
   - Changes: add missing fields/entities for relationship tracking, notes, last-contact metadata, and import metadata.
   - Files: `convex/schema.ts`, `convex/contacts.ts`, related Convex files.
   - Verify: schema deploy succeeds and CRUD flows still work.

9. Build Attio importer
   - Changes: fetch Attio records, normalize them, and write into Forge CRM.
   - Files: new importer module(s), `README.md`, possible setup script/docs.
   - Verify: sample import runs end-to-end and creates valid Forge records.

10. Build CSV importer upgrade
   - Changes: improve current import flow to map columns cleanly into the richer CRM model.
   - Files: `src/components/crm/ImportModal.tsx`, importer helper(s), Convex mutation(s).
   - Verify: CSV import works on a realistic sample without malformed records.

11. Add optional Supabase migration path
   - Changes: define export/import or direct migration path for Alex's existing Atlas contacts.
   - Files: migration notes or importer module, `README.md`.
   - Verify: path is documented and testable without being mandatory for customers.

### Phase D — Email ↔ CRM integration
12. Connect email triage outputs to CRM writes
   - Changes: email triage should create/update contacts and relationship context instead of only creating inbox items.
   - Files: `convex/http.ts`, `convex/emails.ts`, `convex/contacts.ts`.
   - Verify: triaging a new sender creates/updates CRM state correctly.

13. Add CRM-aware email actions
   - Changes: email actions should reference the linked CRM record and update activity history.
   - Files: `convex/emailActions.ts`, `convex/contactActivities.ts`, `src/components/email/*` as needed.
   - Verify: actioning an email creates visible CRM history.

### Phase E — Productization
14. Founder install flow docs
   - Changes: make setup story explicit: clone repo, connect Gmail, import contacts, generate voice/context files, run.
   - Files: `README.md`, bootstrap instructions, setup docs.
   - Verify: a new user can follow the docs without internal context.

15. Browser QA + deployment verification
   - Changes: test CRM, Email, Tasks in local and deployed environments; verify no auth/regression breakage.
   - Files: plan file completion summary, any bugfix files discovered during QA.
   - Verify: all major user flows pass in browser and API checks.

## Checklist

- [x] 1. Audit DenchClaw CRM surface area
- [x] 2. Define Forge CRM target data model
- [x] 3. Define importer strategy
- [ ] 4. Replace current CRM shell with DenchClaw-style layout
- [ ] 5. Port/adapt DataTable behavior
- [ ] 6. Upgrade contact detail panel
- [ ] 7. Add company-aware CRM views
- [ ] 8. Expand Convex schema for real CRM use
- [ ] 9. Build Attio importer
- [ ] 10. Build CSV importer upgrade
- [ ] 11. Add optional Supabase migration path
- [ ] 12. Connect email triage outputs to CRM writes
- [ ] 13. Add CRM-aware email actions
- [ ] 14. Founder install flow docs
- [ ] 15. Browser QA + deployment verification

## Decision log

- [DECISION] Keep Forge as the product shell; do not embed the entirety of DenchClaw as a nested app.
- [DECISION] Keep Convex as the backend unless a concrete blocker appears.
- [DECISION] Treat Attio/Supabase/CSV as migration sources; Forge becomes the canonical CRM after import.
- [DECISION] After Task 2 and Task 3, schema foundation should happen before major CRM UI transplant work. The UI should land on the right relational model instead of a soon-to-be-replaced flat schema.

## Immediate next move

Task 1 is complete via `plans/forge-crm-transplant-audit.md`.

Task 3 is complete via `plans/forge-crm-importer-strategy.md`.

Next up: start schema foundation work before the CRM UI transplant, specifically:
- add `companies`
- add `contacts.primaryCompanyId`
- add import metadata fields
- add email ↔ CRM linkage fields
