# Forge CRM Transplant Spec

## What we're building

We are rebuilding Forge's CRM tab using DenchClaw as the source code and product reference, while keeping Forge's existing app shell intact. Tasks and Email remain native Forge tabs. CRM becomes a DenchClaw-derived experience inside Forge, backed by Forge's own Convex data model and auth. Attio, Supabase, and CSV become migration sources, not long-term dependencies.

## Who it's for

- Alex, as the first operator and product owner
- Project Deploy customers / consulting clients who need a founder-friendly CRM + email triage system they can self-host with OpenClaw
- Future founders who should be able to clone the repo, connect Gmail, import contacts, and start using Forge without needing Attio afterward

## Key behaviors

1. User opens Forge and sees the same top-level product shell: Tasks, Email, CRM.
2. CRM tab feels like DenchClaw: dense, spreadsheet-style, fast, operational, and professional.
3. CRM supports a table-first workflow with:
   - sortable columns
   - column visibility control
   - row selection
   - search and filters
   - detail panel for the selected contact/company/person
4. CRM data lives in Forge's Convex backend and becomes the canonical source of truth after import.
5. Existing contact systems can be imported into Forge via:
   - Attio import
   - CSV import
   - optional Supabase export/import path
6. Email triage can create/update CRM records instead of living as an isolated inbox workflow.
7. Founders can install Forge from GitHub, connect Gmail, import contacts, generate voice/context files, and use it locally with minimal manual setup.

## Constraints

- Keep Forge as the single product shell and deployment target.
- Do not embed the entirety of DenchClaw as a nested app inside Forge.
- Reuse DenchClaw ideas/components selectively; avoid duplicating DenchClaw's full runtime, workspace, or app shell.
- Keep Convex as the backend unless a concrete blocker forces a change.
- Preserve existing Forge Tasks and Email tabs as working product surfaces.
- CRM port must not break current auth, deployment, or existing triage flows.
- UI should move toward DenchClaw's table/detail workflow and visual density, but stay coherent inside Forge.
- The resulting system must support eventual founder self-serve onboarding via OpenClaw bootstrap.

## Success criteria

- Forge still loads as a 3-tab app: Tasks, Email, CRM.
- CRM no longer feels like a basic list/detail mockup; it uses a DenchClaw-style table + detail workflow.
- CRM runs on Forge auth + Convex, not a second embedded app or second auth system.
- A migration path is defined for Attio and CSV, with Supabase treated as optional.
- Email and CRM share data cleanly enough that triage can create/update contacts in Forge.
- The implementation plan clearly separates what to port from DenchClaw, what to rewrite for Forge, and what to ignore.
- The repo remains founder-friendly: one GitHub repo, one install story, one backend, one auth flow.

## Non-goals

- Porting DenchClaw's entire monorepo into Forge
- Replacing Forge Tasks and Email with DenchClaw equivalents
- Preserving Attio as a permanent dependency
- Building every DenchClaw workspace feature (file browser, full workspace runtime, generic object system) in the first CRM transplant pass

## Reference audit notes

### DenchClaw pieces worth learning from
- `apps/web/app/components/workspace/object-table.tsx`
- `apps/web/app/components/workspace/data-table.tsx`
- `apps/web/app/components/workspace/entry-detail-panel.tsx`
- `apps/web/app/workspace/workspace-content.tsx`
- `skills/crm/*`

### DenchClaw pieces we should not blindly port
- Full workspace shell / route structure
- Generic object runtime not needed for Forge MVP
- Broad integrations/runtime glue outside CRM use cases
- Duplicate auth/session architecture
