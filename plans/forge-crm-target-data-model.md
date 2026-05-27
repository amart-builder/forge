# Forge CRM Target Data Model

**Date:** 2026-04-05
**Status:** Design locked for next implementation phase

## Goal

Define the target Convex data model for Forge's CRM transplant so that:
- Forge can become the canonical CRM after import
- CRM can feel DenchClaw-grade without inheriting DenchClaw's DuckDB/filesystem architecture
- Email triage can create/update relationship records instead of living as an isolated inbox system
- Attio, CSV, and optional Supabase migration paths have a clean landing zone

---

## 1. Core decisions

### 1. Keep these product-level boundaries
- **Tasks stays separate** from CRM and keeps its own `columns` + `tasks` tables.
- **Email stays separate at the UI layer**, but its backend data model gets stronger CRM linkage.
- **CRM becomes first-class** rather than a simple contact list.

### 2. Forge becomes the source of truth
After import:
- Forge / Convex is canonical
- Attio is a migration source, not the live primary system
- CSV is a migration source
- Supabase is optional migration infrastructure, not required architecture

### 3. Companies must become first-class entities
Current Forge stores company as a string on contacts. That is too weak for the new CRM. We need real company entities plus explicit contact/company linkage.

### 4. Email must write into CRM
Every meaningful email triage pass should be able to:
- resolve sender → contact
- create contact if missing
- resolve/create company if inferable
- append relationship activity
- update last-contact metadata

---

## 2. Current schema: what stays vs changes

## Keep largely as-is
### `columns`
For the Tasks board only.

### `tasks`
For the Tasks board only.

### `appState`
Keep as a flexible place for UI state and operational flags.
Can also temporarily hold CRM preferences / saved-view state until those deserve dedicated tables.

## Keep but expand
### `emailItems`
Keep table, but add CRM linkage and richer source metadata.

### `emailActions`
Keep table, but make actions CRM-aware.

### `contacts`
Keep table name, but normalize around company relations and import metadata.

### `contactActivities`
Keep table, but broaden it into the core relationship timeline.

### `meetingNotes`
Keep table initially, but make it reference company and source email where useful.

---

## 3. Target tables

## A. `companies` (new)
Purpose: first-class organization records.

### Fields
- `name: string`
- `domain?: string`
- `website?: string`
- `linkedin?: string`
- `industry?: string`
- `description?: string`
- `location?: string`
- `tags: string[]`
- `notes: string`
- `ownerContactId?: Id<"contacts">` (optional internal owner / primary relationship lead)
- `lastInteractionAt?: number`
- `createdAt: number`
- `updatedAt: number`

### Import metadata
- `sourceSystem?: "attio" | "csv" | "supabase" | "manual" | "email"`
- `sourceId?: string`
- `sourcePayload?: string` (JSON snapshot when useful)

### Indexes
- `by_name`
- `by_domain`
- `by_source_system_source_id` (compound if useful)

### Why
DenchClaw-style CRM breaks if company is just display text. This table unlocks company-aware views, grouping, and proper contact relationships.

---

## B. `contacts` (expand)
Purpose: people records.

### Keep existing fields
- `name`
- `email?`
- `phone?`
- `role?`
- `linkedin?`
- `location?`
- `tier`
- `tags`
- `howWeMet?`
- `notes`
- `lastContactDate?`
- `createdAt`
- `updatedAt`

### Replace / evolve
#### Replace
- `company?: string`

#### With
- `primaryCompanyId?: Id<"companies">`
- `companyNameCached?: string` (optional denormalized display/cache during migration)

### Add
- `status?: "lead" | "active" | "warm" | "cold" | "archived"`
- `ownerUserId?: Id<"users"> | string` (depending on auth model needs later)
- `lastInboundAt?: number`
- `lastOutboundAt?: number`
- `lastInteractionAt?: number`
- `sourceSystem?: "attio" | "csv" | "supabase" | "manual" | "email"`
- `sourceId?: string`
- `sourcePayload?: string`

### Indexes
- existing `by_name`
- existing `by_tier`
- add `by_email`
- add `by_primary_company`
- add `by_last_interaction`
- add `by_source_system_source_id`

### Why
Contacts remain central, but now they can participate in a real relational CRM model.

---

## C. `contactCompanies` (new, optional but recommended)
Purpose: support many-to-many relationships between people and companies when needed.

### Why this exists
At minimum, each contact needs a primary company. But real CRM cases often require:
- former employer vs current employer
- investor linked to multiple vehicles/firms
- advisor with several affiliations
- founder linked to company + fund + SPV

### Fields
- `contactId: Id<"contacts">`
- `companyId: Id<"companies">`
- `relationshipType?: "primary" | "founder" | "employee" | "investor" | "advisor" | "customer" | "partner" | "other"`
- `title?: string`
- `isPrimary: boolean`
- `createdAt: number`
- `updatedAt: number`

### Indexes
- `by_contact`
- `by_company`
- `by_contact_company`

### MVP note
If we need to move faster, we can launch with `primaryCompanyId` on contacts first and add this table in the second pass.

**Recommendation:**
- implement `primaryCompanyId` immediately
- reserve `contactCompanies` for pass 2 unless import complexity forces it sooner

---

## D. `emailItems` (expand)
Purpose: triaged inbox items and drafts.

### Keep existing fields
- `threadId?`
- `messageId?`
- `senderName?`
- `senderEmail?`
- `subject?`
- `summary?`
- `context?`
- `recommendedAction`
- `draftResponse?`
- `priority`
- `status`
- `actionedAt?`
- `createdAt`

### Add CRM linkage
- `contactId?: Id<"contacts">`
- `companyId?: Id<"companies">`
- `triageSource?: "cron" | "manual" | "import"`
- `gmailThreadUrl?: string`
- `receivedAt?: number`
- `lastSyncedAt?: number`

### Add operational metadata
- `autoCreatedContact: boolean`
- `autoCreatedCompany: boolean`
- `triageModel?: string`
- `triageRunId?: string`

### Indexes
- existing `by_status`
- add `by_contact`
- add `by_company`
- add `by_sender_email`

### Why
This lets the Email tab and CRM tab talk about the same underlying relationship entities.

---

## E. `emailActions` (expand)
Purpose: action log for inbox operations.

### Keep existing fields
- `emailItemId`
- `actionType`
- `description?`
- `createdAt`

### Add
- `contactId?: Id<"contacts">`
- `companyId?: Id<"companies">`
- `performedBy?: "user" | "agent" | "system"`
- `metadata?: string`

### Why
Email actions become part of the CRM relationship history, not just inbox bookkeeping.

---

## F. `contactActivities` (expand)
Purpose: canonical timeline of relationship activity.

### Current fields
- `contactId`
- `activityType`
- `title?`
- `content?`
- `metadata?`
- `createdAt`

### Expand with
- `companyId?: Id<"companies">`
- `emailItemId?: Id<"emailItems">`
- `direction?: "inbound" | "outbound" | "internal"`
- broaden `activityType` to include:
  - `email_received`
  - `email_sent`
  - `meeting`
  - `note`
  - `call`
  - `import`
  - `status_change`
  - `relationship_update`

### Why
This becomes the universal CRM timeline powering the detail panel.

---

## G. `meetingNotes` (keep, lightly expand)
Purpose: structured meeting summaries and action items.

### Keep existing fields
- `contactId`
- `date?`
- `attendees`
- `summary?`
- `actionItems`
- `sourceEmailId?`
- `createdAt`

### Add
- `companyId?: Id<"companies">`
- `title?: string`
- `rawSource?: string`

### Why
Meeting notes remain useful as a structured subtype instead of collapsing everything into generic activities.

---

## H. `crmViews` (new, optional later)
Purpose: saved CRM filters / column visibility / sort presets.

### Fields
- `name: string`
- `scope: "contacts" | "companies" | "email"`
- `config: string` (JSON)
- `isDefault: boolean`
- `createdAt: number`
- `updatedAt: number`

### MVP note
We can store this in `appState` first.
No need to create immediately unless UI work needs persistence.

---

## 4. Table-by-table migration decisions

## Contacts
### Current
`company` is a string.

### Target
- introduce `primaryCompanyId`
- preserve `companyNameCached` temporarily during migration
- backfill companies from distinct string company names
- resolve contacts onto those company records

## Email items
### Current
No relational link to contacts/companies.

### Target
- triage run resolves sender → contact
- if no contact exists, create one
- if email domain maps to a company, resolve or create company
- email item stores those ids

## Activities
### Current
mostly simple contact timeline

### Target
becomes the relationship event stream across email, meetings, notes, and imports

---

## 5. Email ↔ CRM write rules

## Rule 1 — sender resolution
When `/api/triage` receives a batch:
1. lookup contact by sender email
2. if found, attach `contactId`
3. if not found, create contact with source `email`

## Rule 2 — company resolution
If sender email has a business domain:
1. normalize domain
2. lookup company by domain
3. if not found, optionally create lightweight company from domain / inferred company name
4. attach `companyId`

## Rule 3 — relationship activity
For each triaged email:
- create/update `emailItem`
- append `contactActivities` event
- update contact `lastInboundAt` and `lastInteractionAt`
- update company `lastInteractionAt` if company linked

## Rule 4 — send action
When a draft is sent:
- update email status/action log
- append outbound contact activity
- update contact `lastOutboundAt` and `lastInteractionAt`
- update company `lastInteractionAt`

---

## 6. Import model

## Required import metadata on imported records
Every imported contact/company should carry:
- `sourceSystem`
- `sourceId`
- optional `sourcePayload`

### Why
This gives us:
- dedupe anchors
- safer re-import behavior
- provenance for debugging messy imports

## Attio landing behavior
- companies import first
- contacts import second
- contacts link to company records
- notes / relationship context become activities or notes fields

## CSV landing behavior
- CSV importer maps known columns into contacts and companies
- unknown columns can go into notes/sourcePayload initially
- importer should create missing companies automatically

## Supabase migration behavior
- treated as optional migration pathway for Alex's existing Atlas data
- same landing shape as Attio/CSV

---

## 7. Recommended implementation order

### Phase 1 — schema foundation
1. add `companies`
2. expand `contacts`
3. expand `emailItems`
4. expand `emailActions`
5. expand `contactActivities`

### Phase 2 — CRM UI landing
1. denser table
2. stronger detail panel
3. company-aware display

### Phase 3 — importers
1. Attio
2. CSV
3. optional Supabase

### Phase 4 — email linkage
1. triage contact/company resolution
2. action log ↔ CRM timeline
3. last-contact metadata updates

---

## 8. What we are explicitly not doing

- adopting DenchClaw's DuckDB workspace model
- embedding DenchClaw's full workspace shell into Forge
- keeping Attio as permanent source of truth
- overbuilding generic objects before the CRM is useful

---

## 9. Final recommendation

### Immediate schema moves to implement next
1. `companies` table
2. `contacts.primaryCompanyId`
3. import metadata on contacts + companies
4. `emailItems.contactId` and `emailItems.companyId`
5. `contactActivities.companyId` and `contactActivities.emailItemId`

### Deferred but likely
- `contactCompanies`
- `crmViews`
- richer owner/user assignment

This gives Forge the minimum viable relational CRM shape needed to support a DenchClaw-grade CRM UI without dragging in DenchClaw's full architecture.
