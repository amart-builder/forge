# Forge V2 Sprint Spec

## Context
Alex reviewed the app and gave 3 pieces of feedback:
1. Tasks kanban needs to match Atlas web app style (fixed columns, no add/delete column, proper add task button)
2. Email needs to be connected to real Edge Fund email with a working cron
3. CRM needs to look like DenchClaw (table-based, file browser sidebar, chat panel, rich data)

Plus: overall design should adopt DenchClaw's warm, clean aesthetic throughout.

## Reference UIs

### Atlas Web App Tasks (https://atlas-web-flame.vercel.app/tasks)
- Fixed columns: Not Started, In Progress, Blocked, Completed
- No add/delete column buttons
- Single "+ Add" button in header
- Tasks show: project tag (emoji + name), sub-category, due date, title, description, time estimate, priority badge
- Project filter tabs at top (All, Atlas, Edge Fund, Health, Life, etc.)
- Search bar
- View mode toggles (grid/star/calendar/list)
- Overdue count indicator
- Tasks are expandable cards (not modal)

### DenchClaw CRM (dench.com/claw screenshot)
- 3-panel layout: left sidebar (file browser), center (data table), right (chat panel)
- Left sidebar: tree view with tables (companies, contact, customer, founders), workspace files (AGENTS, HEARTBEAT, IDENTITY, SOUL, TOOLS, USER), plus Skills/Memories/Cron sections
- Center: spreadsheet-like table with columns (Full Name, Company, LinkedIn, Notes, Education) — sortable, checkboxes, "+ Add" button, "Columns" button, search, field count, entry count, relation count
- Right: Chat panel with streaming responses, DuckDB queries, pipeline visualization
- Company names are colored links, data is dense but readable
- Warm beige/cream aesthetic, subtle borders, no heavy shadows

## Sprint Tasks

### 1. Tasks Board Overhaul
**Goal:** Match Atlas web app kanban

Changes:
- Fixed 4 columns: Not Started, In Progress, Blocked, Done — hardcoded, no add/delete/rename
- Remove "Add Column" button, remove "×" delete column button, remove double-click rename
- Add single "+ Add Task" button in header (opens inline form or modal asking for title, priority, optional due date, optional description)
- Don't show "+" add task button on Done column (tasks move there via drag, not created there)
- Task cards show: title, description (truncated), priority badge (color-coded), due date if set, tags
- Task detail stays as modal on click (already works)
- Remove Column.tsx delete/rename functionality, simplify to pure display

Schema changes: None needed (columns table stays, just seeded with fixed 4).

### 2. CRM → DenchClaw Style
**Goal:** Transform CRM from basic list+detail into DenchClaw-style 3-panel layout

Changes:
- **Left sidebar:** File/table browser tree showing: contacts (grouped by tier or tag), companies (extracted from contacts), recent activity
- **Center panel:** Spreadsheet-style table with sortable columns (Name, Company, Email, LinkedIn, Notes, Tags, Last Contact, Tier)
- Column visibility toggle ("Columns" button)
- Inline "+ Add" button in header
- Entry count, field count display
- Checkbox selection on rows
- Click row to populate right panel
- **Right panel:** Contact detail view (replaces current side panel) OR chat interface for natural-language CRM queries
- For now: right panel shows contact detail (name, all fields, activity timeline, notes, edit capability)
- Dense but readable — DenchClaw aesthetic

Schema changes: None needed.

### 3. Email → Live Connection
**Goal:** Connect to real Edge Fund Gmail, run triage cron, show real data

This is the cron/backend piece. The email UI is actually decent already (summary card, action cards, action log). Main changes:
- Wire up the `gog gmail` CLI to fetch real emails for alex@edge-fund.io
- Build a cron job (OpenClaw cron, not app-internal) that runs 3x/day on workdays (9am, 1pm, 5pm PT)
- Cron fetches unread emails via gog, sends to Convex triage endpoint, updates summary
- The triage endpoint already works (tested with real email data)
- Add "Refresh" button to manually trigger a triage run
- Email actions (Reply, Archive, Flag, Dismiss) should work — Reply opens draft, Archive marks read in Gmail

**Note:** Email cron will be set up separately on Alex's machine (not in the app code). The app just needs to receive data from the triage API.

### 4. Design Overhaul — DenchClaw Aesthetic
**Goal:** Warm, clean, professional look throughout

- Color palette: warm white/cream backgrounds, subtle warm grays for borders, accent colors for interactive elements
- Typography: clean sans-serif, proper hierarchy
- Minimal shadows, use borders instead
- Dense but breathable — no wasted space but not cramped
- Consistent card/cell styling across all tabs
- Tab navigation should feel integrated, not floating pills

## Approach
Build with Claude Code. Focus on tasks 1, 2, 4 together (they're all frontend). Task 3 is backend/cron setup that happens after the UI sprint.

## Out of Scope
- DenchClaw chat panel (requires significant AI query infrastructure)
- DuckDB integration
- File browser for workspace files (DenchClaw-specific, not relevant for Forge)
