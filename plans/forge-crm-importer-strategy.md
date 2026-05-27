# Forge CRM Importer Strategy

**Date:** 2026-04-05
**Status:** Planning complete for importer phase

## Goal

Define how Forge ingests CRM data from external systems into its own Convex-backed CRM model, with:
- Attio as the highest-priority migration source
- CSV as the lowest-friction import path
- Supabase as an optional migration path for Alex's existing Atlas data
- strong dedupe and provenance rules so imports are idempotent and safe

This strategy assumes the target CRM data model in `plans/forge-crm-target-data-model.md`.

---

## 1. Importer principles

### Principle 1 — Forge becomes canonical after import
Importers are **landing pipes**, not permanent sync engines.

That means:
- import into Forge
- normalize into Forge schema
- preserve source metadata for debugging/re-imports
- do not architect around a long-lived dependency on Attio/Supabase

### Principle 2 — Importers must be idempotent
If we run an importer twice, it should:
- update existing records when the source identity matches
- avoid creating duplicate companies/contacts
- preserve imported provenance

### Principle 3 — Company-first normalization
Wherever possible:
1. create/resolve companies first
2. create/resolve contacts second
3. link contacts to companies
4. create activities/notes third

### Principle 4 — Preserve provenance
Every imported record should carry enough metadata to answer:
- where did this come from?
- what source record did it map from?
- was it imported manually, from CSV, or from an API?

### Principle 5 — Human review beats silent corruption
If a mapping is ambiguous, prefer:
- flagging the record
- preserving raw source payload
- surfacing it for review
instead of making overconfident destructive guesses

---

## 2. Import source priority

## A. Attio — primary migration path
Use when the customer already runs their relationships in Attio and wants the best migration quality.

**Why first:**
- structurally rich CRM source
- contact/company relationships are more likely to exist
- best signal for relationship history, notes, and company data

## B. CSV — universal fallback
Use when the customer exports data from Google Contacts, another CRM, or a spreadsheet.

**Why second:**
- lowest-friction path
- works for nearly everyone
- weakest data quality, so needs the strongest mapping guardrails

## C. Supabase — optional Alex/Atlas migration path
Use when we need to migrate existing Atlas/Forge-ish data already living in Supabase/Postgres.

**Why optional:**
- useful for internal migration work
- not a core customer onboarding assumption
- should not become a requirement for Forge customers

---

## 3. Target landing shape

All importers should eventually normalize into the same Forge entities:
- `companies`
- `contacts`
- `contactActivities`
- `meetingNotes` (when structured meeting data exists)
- optional linkage into `emailItems` only when email-derived records are being imported

### Required provenance fields
For imported `companies` and `contacts`:
- `sourceSystem`
- `sourceId`
- `sourcePayload` (JSON string when useful)

### Additional recommended import metadata
Either inside each record or as a shared import-run entity later:
- `importedAt`
- `importRunId`
- `importedBy`
- `mappingVersion`

**Recommendation:**
For MVP, use record-level fields plus `appState` for latest run metadata.
A dedicated `importRuns` table can come later.

---

## 4. Dedupe / identity rules

## Company dedupe precedence
When importing a company, match in this order:
1. `sourceSystem + sourceId`
2. normalized domain
3. normalized company name

### Domain normalization rules
- lowercase
- strip protocol
- strip `www.`
- keep root domain when possible

### Company-name normalization rules
- lowercase
- trim whitespace
- collapse repeated spaces
- optionally strip punctuation for fuzzy fallback

## Contact dedupe precedence
When importing a contact, match in this order:
1. `sourceSystem + sourceId`
2. normalized email
3. normalized `(name + company)` heuristic

### Email normalization rules
- lowercase
- trim whitespace

### Name+company heuristic
Use only when email is absent.
Treat as medium-confidence, not perfect identity.

## Conflict behavior
If an existing record matches:
- update missing/empty fields from source
- prefer richer source data over blank internal data
- do **not** overwrite strong existing user-edited notes blindly unless explicitly allowed

### Safe merge rule
Prefer this precedence for mutable text fields:
1. explicit user edits in Forge
2. richer source values when Forge field is empty
3. append source-only notes into activity log or raw payload instead of overwriting

---

## 5. Attio importer strategy

## What we import from Attio
Priority order:
1. companies
2. people / contacts
3. relationship metadata
4. notes / interactions / custom fields where mappable

## Attio landing behavior
### Companies
Map Attio company records to Forge `companies`:
- name
- domain / website
- linkedin if available
- industry if available
- notes/description if available
- tags if available
- source metadata

### Contacts
Map Attio person records to Forge `contacts`:
- name
- email
- phone
- role/title
- linkedin
- location
- notes
- tags
- source metadata
- resolved `primaryCompanyId`

### Activities / notes
If Attio exposes note/timeline-like objects:
- import them into `contactActivities`
- preserve original timestamps where available
- preserve raw payload in `metadata` when mapping is partial

## Attio importer execution model
### Recommended shape
- server-side importer module in Forge repo
- authenticated import action/mutation sequence
- dry-run mode before write mode

### Phases
1. fetch Attio records
2. normalize into Forge staging objects
3. dry-run report
4. execute import
5. return summary: created / updated / skipped / conflicted

## Attio dry-run report should show
- companies to create
- companies to update
- contacts to create
- contacts to update
- unresolved conflicts
- fields dropped / preserved only in sourcePayload

## Attio-specific risk
Attio schemas can vary between customers.

**Design response:**
- use a mapping layer, not hardcoded assumptions only
- preserve unknown fields in `sourcePayload`
- expose unmapped field counts in dry-run output

---

## 6. CSV importer strategy

## Current state
Forge currently has:
- a textarea-based CSV paste flow in `ImportModal.tsx`
- a `contacts.importCSV` mutation
- only basic fields: `name, email, phone, company, role, location`

This is useful but too thin for the CRM transplant.

## Target CSV importer behavior
### Input modes
1. paste CSV text
2. upload CSV file
3. eventually drag-and-drop file into modal

### Required supported columns
- `name`
- `email`

### High-value optional columns
- `phone`
- `company`
- `role`
- `location`
- `linkedin`
- `tags`
- `tier`
- `notes`
- `website`
- `domain`

### Mapping behavior
- company-like fields create/resolve `companies`
- contact rows create/resolve `contacts`
- unknown columns get preserved into `sourcePayload`
- tags support comma-separated or semicolon-separated values

## CSV importer UX
### Step 1 — parse and preview
Show:
- detected columns
- number of rows
- mapping preview
- warnings for missing required columns

### Step 2 — dry-run summary
Show:
- contacts to create/update
- companies to create/update
- rows with missing name/email
- rows with ambiguous mapping

### Step 3 — import
Execute only after preview/confirmation.

## CSV-specific risk
CSV is messy:
- inconsistent headers
- commas in quoted values
- duplicate rows
- missing emails

**Design response:**
- replace current naive `split(',')` parser with a real CSV parser
- support quoted fields
- support header aliases
- support a review step before mutation

### Header aliases to support
For example:
- `full name` → `name`
- `email address` → `email`
- `company name` → `company`
- `job title` → `role`
- `city` / `hq` → `location`

---

## 7. Supabase migration strategy

## Use case
This is primarily for Alex/internal migration where some relationship data may already exist in Supabase-backed Atlas systems.

## Recommended approach
Do **not** make Forge depend on Supabase at runtime.
Instead:
1. read/export data from Supabase
2. normalize into the same internal importer shape as Attio/CSV
3. import into Forge

## Execution options
### Option A — one-off export + import
- export tables/views from Supabase
- convert to normalized JSON/CSV
- import into Forge

### Option B — direct migration script
- read from Supabase using service credentials
- map rows into Forge staging records
- perform dry run then import

**Recommendation:**
Start with Option A for clarity and safety.
Only build direct Supabase import if it meaningfully reduces work.

## Supabase-specific risk
Atlas data may reflect older schemas or mixed-quality records.

**Design response:**
- treat Supabase path as migration tooling, not end-user onboarding
- allow more manual review
- preserve all raw source payloads for traceability

---

## 8. Import run lifecycle

Every importer should follow the same lifecycle:

### 1. Extract
Read source records.

### 2. Normalize
Transform into Forge staging shape:
- normalized companies
- normalized contacts
- normalized activities/notes

### 3. Resolve identities
Match against existing Forge records using dedupe rules.

### 4. Dry-run
Produce a summary before writing.

### 5. Apply
Create/update Forge records.

### 6. Report
Return counts and unresolved issues.

---

## 9. Recommended staging shape

Before writing to Convex, all importers should normalize into a shared in-memory structure like:

```ts
{
  companies: NormalizedCompany[],
  contacts: NormalizedContact[],
  activities: NormalizedActivity[],
  meetings: NormalizedMeeting[],
  warnings: ImportWarning[],
}
```

### Why
This gives us:
- one dedupe engine
- one dry-run engine
- one reporting model
- importer-specific extractors feeding a shared import pipeline

---

## 10. Recommended implementation order

## Step 1 — CSV importer upgrade
Why first:
- fastest way to improve real customer onboarding
- exercises shared normalization pipeline
- replaces current fragile parser

## Step 2 — shared dedupe + normalization layer
Why second:
- both Attio and Supabase benefit
- avoids copy/pasting merge logic into each importer

## Step 3 — Attio importer
Why third:
- higher-value migration source
- more complex, but now sits on shared pipeline

## Step 4 — optional Supabase migration tooling
Why fourth:
- useful internally
- not blocking customer readiness

---

## 11. Concrete implementation recommendations

## New modules to add
Likely under `src/lib/importers/` or `convex/importers/`:
- `normalize.ts`
- `dedupe.ts`
- `csv.ts`
- `attio.ts`
- `supabase.ts` (optional later)
- `types.ts`

## Convex/API surfaces to add
- `contacts.importCSVPreview`
- `contacts.importCSVApply`
- `contacts.importAttioPreview`
- `contacts.importAttioApply`
- optional `contacts.importSupabasePreview`
- optional `contacts.importSupabaseApply`

### Why split preview/apply
Dry-run becomes first-class instead of implicit.

---

## 12. UI recommendations

## Import modal should evolve into source picker
Instead of one plain CSV textarea, the importer UI should become:
- Import from Attio
- Import from CSV
- Import from Supabase (optional/internal)

### Attio tab
- connect credentials / token guidance
- fetch preview
- import summary
- apply button

### CSV tab
- upload/paste
- mapping preview
- dry-run summary
- apply button

### Supabase tab
- internal/admin-only initially
- connection info or uploaded export

---

## 13. What we preserve from source systems

For every imported record we should preserve:
- source system name
- source record id
- raw payload (when useful)
- import timestamp

For every import run we should preserve or report:
- created counts
- updated counts
- skipped counts
- conflict counts
- warnings

---

## 14. Final recommendations

### Highest-confidence sequence
1. **Upgrade CSV importer first**
2. **Build shared normalize + dedupe layer**
3. **Build Attio importer on top**
4. **Add Supabase migration tooling only if needed**

### Most important design guardrails
- never import straight into final tables without normalization
- never overwrite good user data blindly
- always preserve source metadata
- always support dry-run before apply

### Bottom line
Attio is the best migration source, CSV is the best universal onboarding path, and Supabase is an optional internal bridge. All three should land in the same shared normalization + dedupe pipeline so Forge can become the clean, canonical CRM after import.
