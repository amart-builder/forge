# Forge — Full Build Specification

## What to Build

A local web app called **Forge** that runs on a Mac Mini via `npx` or a local dev server. Three tabs: Tasks, Email, CRM. Apple-quality design with DenchClaw-inspired branding.

## Tech Stack

- **Next.js 14** (App Router) with TypeScript
- **Tailwind CSS** for styling
- **SQLite** via `better-sqlite3` for local data persistence (no external DB dependency)
- **React DnD Kit** (`@dnd-kit/core`, `@dnd-kit/sortable`) for drag-and-drop kanban
- No auth required (local-only app, single user)

## Design Language

- **Apple-inspired:** Clean white backgrounds, subtle gray borders, generous whitespace, SF-style typography (system font stack: -apple-system, BlinkMacSystemFont, Inter)
- **DenchClaw branding compatible:** Warm cream/white tones, understated UI, table-based data views for CRM
- **Tab navigation:** Top of screen, pill-style tabs, easily switchable. Order: Tasks | Email | CRM
- **Responsive but optimized for desktop** (primary use case is MacBook Pro accessing Mac Mini)

## Tab 1: Tasks (Kanban Board)

### Layout
- Full drag-and-drop kanban board
- Default columns: To Do | In Progress | Done
- User can add/rename/delete/reorder columns

### Task Cards
- Card shows: title, priority badge (High/Med/Low), due date (if set), tags
- Click card → opens full task detail modal/panel:
  - Title (editable)
  - Description (rich text or markdown)
  - Priority selector
  - Due date picker
  - Tags (add/remove)
  - Column/status
  - Created date, last modified
  - Notes/comments section
- Cards are draggable between columns and within columns (reorderable)

### Features
- Create new task: button at top of each column OR global "New Task" button
- Quick-add: press Enter in column header area to add a task fast
- Filter by tag, priority, or search
- Empty state: friendly message encouraging first task

### Implementation
- Use `@dnd-kit/core` + `@dnd-kit/sortable` for drag-and-drop
- Store tasks in SQLite with: id, title, description, priority, status/column, position (float for reordering), due_date, tags (JSON), created_at, updated_at
- Columns stored in SQLite: id, name, position

## Tab 2: Email Handler

### Layout
- Top: Summary card with natural-language recap of what happened since last check
- Middle: Action cards grid/list — emails needing attention
- Bottom: Action log — what the email cron did

### Summary Card
- "Here's what happened since you last looked"
- Counts: X emails processed, Y need attention, Z auto-archived
- Natural language summary (populated by the email triage cron)

### Action Cards
Each card shows:
- Sender avatar (initials-based if no photo), name, email
- Subject line
- Context summary (1-2 sentences: why this matters, relationship context from CRM)
- Recommended action badge: Reply | Archive | Follow Up | Delegate | Flag
- For Reply actions: expandable draft response area
  - Full suggested response text
  - Edit button → inline editor
  - "Send" button (calls API to send via gog gmail)
  - "Dismiss" button
- For other actions: single action button
- Timestamp
- Priority indicator (color-coded left border)

### Action Log
- Collapsible section at bottom
- Shows every action the email cron took: "Archived marketing email from X", "Created follow-up reminder for Y", etc.
- Filterable by action type
- Timestamps

### Data Model
- `email_items` table: id, thread_id, sender_name, sender_email, subject, summary, context, recommended_action, draft_response, priority (1-3), status (pending/actioned/dismissed), actioned_at, created_at
- `email_actions` table: id, email_item_id, action_type, description, created_at

### Empty State
When no email items: "Your inbox is clear. The email handler runs 3x daily during work hours."

## Tab 3: CRM

### Layout
- Left: Contact list (searchable, filterable)
- Right: Contact detail panel

### Contact List
- Table view (DenchClaw-style) with columns: Name, Company, Last Contact, Tags
- Search bar at top
- Filter by: tag, company, relationship tier
- Sort by: name, last contact date, company
- Click row → shows detail in right panel
- "Add Contact" button

### Contact Detail Panel
- Header: name, company, role, avatar (initials)
- Quick info: email, phone, LinkedIn, location
- Relationship tier badge (configurable: A/B/C or custom)
- Tags (editable)
- "How we know each other" text field
- Last contact date (auto-updated from email activity)

**Sections (collapsible):**
1. **Activity Timeline** — all interactions in chronological order:
   - Emails sent/received (with subject + snippet)
   - Meeting notes
   - Manual notes
   - Phone calls logged
2. **Meeting Notes** — extracted meeting summaries
3. **Notes** — manual notes/observations
4. **Details** — custom fields

### Data Model
- `contacts` table: id, name, email, phone, company, role, linkedin, location, tier, tags (JSON), how_we_met, notes, last_contact_date, created_at, updated_at
- `contact_activities` table: id, contact_id, activity_type (email_sent/email_received/meeting/note/call), title, content, metadata (JSON), created_at
- `meeting_notes` table: id, contact_id, date, attendees (JSON), summary, action_items (JSON), source_email_id, created_at

### Contact Creation
- Manual: "Add Contact" button → form
- Auto-create: email triage cron creates contacts for new senders
- Import: CSV upload support

## API Routes (Next.js API routes)

### Tasks
- `GET /api/tasks` — list all tasks (with column info)
- `POST /api/tasks` — create task
- `PATCH /api/tasks/[id]` — update task (including column/position changes for drag-drop)
- `DELETE /api/tasks/[id]` — delete task
- `GET /api/columns` — list columns
- `POST /api/columns` — create column
- `PATCH /api/columns/[id]` — update column
- `DELETE /api/columns/[id]` — delete column

### Email
- `GET /api/emails` — list email items (with filters: status, priority)
- `PATCH /api/emails/[id]` — update email item (action it, dismiss it)
- `POST /api/emails/[id]/send` — send the draft response (calls gog gmail)
- `GET /api/email-actions` — list action log entries
- `POST /api/emails/triage` — endpoint for the cron to push new triage items

### CRM
- `GET /api/contacts` — list contacts (with search, filters)
- `POST /api/contacts` — create contact
- `PATCH /api/contacts/[id]` — update contact
- `DELETE /api/contacts/[id]` — delete contact
- `GET /api/contacts/[id]/activities` — list activities for a contact
- `POST /api/contacts/[id]/activities` — add activity
- `POST /api/contacts/import` — bulk import from CSV
- `GET /api/contacts/[id]/meetings` — list meeting notes
- `POST /api/contacts/[id]/meetings` — add meeting note

### System
- `GET /api/status` — app health, last cron run, counts
- `POST /api/cron/email-triage` — webhook for email triage cron to push results

## Database

SQLite file at `~/.forge/forge.db`. Created on first run with migrations.

Schema:
```sql
-- Tasks
CREATE TABLE columns (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  name TEXT NOT NULL,
  position REAL NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE tasks (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  column_id TEXT NOT NULL REFERENCES columns(id),
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  priority TEXT DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
  due_date DATE,
  tags TEXT DEFAULT '[]',
  position REAL NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Email
CREATE TABLE email_items (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  thread_id TEXT,
  message_id TEXT,
  sender_name TEXT,
  sender_email TEXT,
  subject TEXT,
  summary TEXT,
  context TEXT,
  recommended_action TEXT DEFAULT 'review' CHECK (recommended_action IN ('reply', 'archive', 'follow_up', 'delegate', 'flag', 'review')),
  draft_response TEXT,
  priority INTEGER DEFAULT 2 CHECK (priority BETWEEN 1 AND 3),
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'actioned', 'dismissed')),
  actioned_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE email_actions (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  email_item_id TEXT REFERENCES email_items(id),
  action_type TEXT NOT NULL,
  description TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- CRM
CREATE TABLE contacts (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  company TEXT,
  role TEXT,
  linkedin TEXT,
  location TEXT,
  tier TEXT DEFAULT 'C',
  tags TEXT DEFAULT '[]',
  how_we_met TEXT,
  notes TEXT DEFAULT '',
  last_contact_date DATE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE contact_activities (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  contact_id TEXT NOT NULL REFERENCES contacts(id),
  activity_type TEXT NOT NULL CHECK (activity_type IN ('email_sent', 'email_received', 'meeting', 'note', 'call')),
  title TEXT,
  content TEXT,
  metadata TEXT DEFAULT '{}',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE meeting_notes (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  contact_id TEXT NOT NULL REFERENCES contacts(id),
  date DATE,
  attendees TEXT DEFAULT '[]',
  summary TEXT,
  action_items TEXT DEFAULT '[]',
  source_email_id TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- System
CREATE TABLE app_state (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

## Deployment Plan for Customer Setups

1. **Forge lives in a GitHub repo** (e.g., `github.com/alexmartin/forge` or similar)
2. **During bootstrap prompt** (after OpenClaw is set up), Navi:
   - `git clone` the Forge repo to `~/forge/`
   - `npm install`
   - Creates a LaunchAgent to start Forge on boot (`com.forge.server.plist`)
   - Seeds default columns (To Do, In Progress, Done)
   - Opens Forge in browser to confirm it works
3. **The Forge README.md** contains instructions for Navi on how to:
   - Set up the email triage cron
   - Walk the user through Gmail/Calendar OAuth
   - Import existing contacts
   - Configure timezone for email cron schedule
4. **Navi reads the README** and follows it to complete setup interactively with the user

## File Structure
```
forge/
├── README.md              # Instructions for Navi (setup guide)
├── PLAN.md               # This plan
├── SPEC.md               # This spec
├── package.json
├── tsconfig.json
├── next.config.js
├── tailwind.config.ts
├── postcss.config.js
├── src/
│   ├── app/
│   │   ├── layout.tsx         # Root layout with tab navigation
│   │   ├── page.tsx           # Redirect to /tasks
│   │   ├── tasks/
│   │   │   └── page.tsx       # Kanban board
│   │   ├── email/
│   │   │   └── page.tsx       # Email handler
│   │   ├── crm/
│   │   │   └── page.tsx       # CRM
│   │   └── api/
│   │       ├── tasks/
│   │       ├── columns/
│   │       ├── emails/
│   │       ├── contacts/
│   │       └── status/
│   ├── components/
│   │   ├── layout/
│   │   │   └── TabNav.tsx
│   │   ├── tasks/
│   │   │   ├── KanbanBoard.tsx
│   │   │   ├── Column.tsx
│   │   │   ├── TaskCard.tsx
│   │   │   └── TaskDetail.tsx
│   │   ├── email/
│   │   │   ├── SummaryCard.tsx
│   │   │   ├── ActionCard.tsx
│   │   │   └── ActionLog.tsx
│   │   └── crm/
│   │       ├── ContactList.tsx
│   │       ├── ContactDetail.tsx
│   │       └── ImportModal.tsx
│   └── lib/
│       ├── db.ts              # SQLite connection + migrations
│       └── utils.ts
├── scripts/
│   ├── setup.sh              # First-run setup script
│   └── seed.sql              # Default data (columns, app_state)
└── public/
    └── favicon.ico
```

## Quality Bar

- Zero TypeScript errors
- All API routes return proper error handling
- Drag-and-drop works smoothly (no janky animations)
- Empty states for all views
- Loading states for all async operations
- Mobile-responsive (but desktop-first)
- Accessible (proper ARIA labels, keyboard navigation for tabs)
- No console errors in browser
