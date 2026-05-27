# Forge CRM Transplant Audit

**Date:** 2026-04-05
**Purpose:** File-level inventory of what to port from DenchClaw into Forge, what to adapt, and what to ignore.

---

## 1. Current Forge baseline

### Current CRM surface
- `src/components/crm/CRMView.tsx`
- `src/components/crm/ContactList.tsx`
- `src/components/crm/ContactDetail.tsx`
- `src/components/crm/ImportModal.tsx`
- `src/app/crm/page.tsx`

### Current CRM data model in Convex
- `convex/schema.ts`
- `convex/contacts.ts`
- `convex/contactActivities.ts`
- `convex/meetingNotes.ts`
- `convex/emails.ts`
- `convex/emailActions.ts`
- `convex/http.ts`

### Current gap summary
Forge CRM is still a custom lightweight CRM. It has the beginnings of a useful model (contacts, activities, notes, email items), but it does **not** yet have:
- a true DenchClaw-style table workflow
- company-first modeling
- reusable table/view infrastructure
- richer saved views / filters / column controls
- a migration-oriented import architecture

---

## 2. DenchClaw source surface inspected

### Core web UI files
- `apps/web/app/components/workspace/object-table.tsx`
- `apps/web/app/components/workspace/data-table.tsx`
- `apps/web/app/components/workspace/entry-detail-panel.tsx`
- `apps/web/app/components/workspace/view-type-switcher.tsx`
- `apps/web/app/components/workspace/object-filter-bar.tsx`
- `apps/web/app/workspace/workspace-content.tsx`
- `apps/web/app/components/workspace/workspace-sidebar.tsx`

### CRM skill/runtime files
- `skills/crm/SKILL.md`
- `skills/crm/sync.sh`
- additional child skills under `skills/crm/*`

### Observed DenchClaw pattern
DenchClaw's CRM is not a narrow CRM tab. It is a broader workspace/object system. The useful assets are the table/detail interaction model and some reusable controls. The dangerous part is the surrounding runtime: generic workspace shell, DuckDB-centric data model, and broader app infrastructure.

---

## 3. Port / adapt / ignore inventory

## A. Port with adaptation

### 1. `apps/web/app/components/workspace/data-table.tsx`
**Decision:** Port with adaptation

**Why:**
- This is the strongest source for the CRM table UX we want.
- It already includes the right interaction primitives: sorting, filtering, selection, column visibility, column sizing, toolbar actions, row clicks, and dense table behavior.
- Forge should not import it raw because it depends on DenchClaw UI primitives and generic workspace assumptions.

**Target in Forge:**
- create a Forge-shared CRM table helper / component
- use it inside `src/components/crm/ContactList.tsx`
- keep Forge styling/tokens while adopting DenchClaw interaction patterns

**Likely files touched later:**
- `src/components/crm/ContactList.tsx`
- new shared table component (likely `src/components/crm/CRMTable.tsx` or similar)
- `src/app/globals.css`

---

### 2. `apps/web/app/components/workspace/object-table.tsx`
**Decision:** Port with heavy adaptation

**Why:**
- It contains the object-level composition pattern on top of the table.
- Useful for how DenchClaw thinks about fields, relations, and cell rendering.
- Too generic and workspace-dependent to drop in raw.

**What to take:**
- object/table composition ideas
- cell rendering patterns
- relation display conventions
- toolbar density

**What not to take directly:**
- generic object runtime assumptions
- field metadata model as-is
- workspace navigation glue

**Target in Forge:**
- inform the architecture of the new CRM table layer
- not a direct copy/paste file

---

### 3. `apps/web/app/components/workspace/entry-detail-panel.tsx`
**Decision:** Port with adaptation

**Why:**
- This is the clearest model for the right-hand detail panel behavior.
- Forge already has a detail panel, but DenchClaw's version is denser and more operational.

**What to take:**
- field grouping style
- denser inline editing patterns
- relationship display ideas
- activity/metadata presentation patterns

**Target in Forge:**
- `src/components/crm/ContactDetail.tsx`
- potentially new shared subcomponents for field rows / badges / relation chips

---

### 4. `apps/web/app/components/workspace/object-filter-bar.tsx`
**Decision:** Port selectively

**Why:**
- Good model for saved views and richer filters
- Forge CRM will need a lighter version, not the full generic filter engine on day one

**What to take first:**
- filter chip style
- saved view concept
- field-aware filtering UX

**What to defer:**
- full nested filter-group engine
- every Dench view type integration

---

### 5. `apps/web/app/components/workspace/view-type-switcher.tsx`
**Decision:** Maybe port later

**Why:**
- Helpful if Forge CRM grows into table / board / list / gallery views
- Not required for the first transplant pass

**Status:** backlog / optional

---

## B. Rewrite in Forge style

### 6. `apps/web/app/workspace/workspace-content.tsx`
**Decision:** Rewrite conceptually, do not port directly

**Why:**
- This file is the giant workspace orchestrator for DenchClaw.
- It is far too broad for Forge.
- But it tells us how DenchClaw composes object views, detail panels, and side panels.

**Use:**
- architecture reference only
- no direct transplantation

---

### 7. `apps/web/app/components/workspace/workspace-sidebar.tsx`
**Decision:** Ignore for initial CRM transplant

**Why:**
- It supports the full DenchClaw workspace shell.
- Forge does not need a file-browser/workspace sidebar inside the CRM tab for the first product pass.
- It would pull us toward embedding the whole DenchClaw app.

**Possible later use:**
- if we eventually add CRM object navigation beyond contacts/companies

---

## C. Ignore for now

### 8. `skills/crm/SKILL.md`
**Decision:** Ignore as runtime architecture; mine for ideas only

**Why:**
- It is deeply tied to DenchClaw's DuckDB + filesystem CRM model.
- Forge is on Convex, not DuckDB workspace projections.
- Useful conceptually for relation-first CRM modeling, but not as implementation guidance.

**Takeaway:**
- keep the “aggressive linking / relation-first CRM” mindset
- do not inherit the DuckDB/filesystem architecture

---

### 9. `skills/crm/sync.sh`
**Decision:** Ignore

**Why:**
- S3 sync of workspace.duckdb is specific to DenchClaw's persistence model
- irrelevant to Forge's Convex/Vercel architecture

---

## 4. Forge schema implications

## Current problem
Current Forge schema models only a flat `contacts` table with company as a string:
- `contacts.company: optional string`

That is not enough for a serious CRM transplant.

## Required likely additions
1. **Companies** table
   - company name
   - website / domain
   - industry
   - notes
   - tags
   - metadata

2. **Contact ↔ company relationship**
   - move from string company name to actual relation or normalized company id

3. **Import metadata**
   - source system (`attio`, `csv`, `supabase`, `manual`)
   - source record id
   - importedAt / syncedAt

4. **Activity enrichment**
   - stronger linkage between email actions and contact/company activity history

5. **Saved views / filters state**
   - likely stored in `appState` first, then promoted if needed

---

## 5. Recommended transplant order

### Step 1 — UX shell first
Rebuild CRM UI structure before importers:
- denser header
- proper table interactions
- stronger detail panel
- company-aware row model

### Step 2 — schema expansion
Add companies + relationships + import metadata in Convex.

### Step 3 — importers
Build:
1. Attio importer
2. CSV importer upgrade
3. optional Supabase migration path

### Step 4 — email integration
Make email triage update CRM entities and histories directly.

---

## 6. Bottom-line decisions

### Keep
- Forge shell
- Forge auth
- Convex backend
- Forge Tasks tab
- Forge Email tab

### Transplant
- DenchClaw CRM table/detail interaction model
- DenchClaw operational density and control patterns
- DenchClaw data-view ergonomics

### Do not transplant wholesale
- DenchClaw monorepo/app shell
- DuckDB workspace architecture
- full workspace sidebar/runtime
- S3 sync model

---

## 7. Immediate coding recommendation

First implementation slice should be:
1. introduce a Dench-inspired CRM table component
2. upgrade CRMView layout to a stronger table + detail composition
3. keep current contacts data source temporarily
4. then expand schema to companies/import metadata

That gives visible product movement fast without locking us into the wrong backend or app shell.
