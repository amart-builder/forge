# Forge Convex Migration — Spec

## What We're Building

Migrate Forge from local SQLite to Convex (cloud database) + Vercel (frontend hosting) so users can access it from any device via a URL. Add Convex Auth (password) so the app is private.

## Who It's For

Project Deploy customers accessing Forge from their laptop, phone, or any device — not just the Mac Mini where the agent runs.

## Architecture (Before → After)

**Before:** Mac Mini runs Next.js server + SQLite → only accessible via localhost or LAN IP
**After:** Vercel hosts frontend → Convex handles database + auth → Mac Mini agent pushes data via Convex HTTP API

```
User (any device) → forge-[name].vercel.app → Convex (data + auth)
Mac Mini agent → Convex HTTP API (pushes triage items, contacts)
```

## Key Behaviors

1. User visits their Forge URL → sees login page (password)
2. After login → sees the same 3-tab app (Tasks, Email, CRM)
3. All data persists in Convex cloud — no SQLite
4. Real-time: when the agent pushes a new triage item, it appears instantly (Convex reactivity)
5. Mac Mini agent authenticates to Convex via deployment URL + API key (no user auth needed for server-side writes)
6. Dark mode toggle persists in localStorage (client-side only)

## Auth

- **Convex Auth with password** — simplest option, no third-party service
- During setup, Navi creates a password for the user (or asks them to set one)
- Single user per deployment (no multi-user needed)
- Agent writes use Convex `internal` functions or HTTP actions with a shared secret — no user auth

## Tech Stack Changes

- **Remove:** better-sqlite3, all API routes (src/app/api/*)
- **Add:** convex package, convex/ directory with schema + functions
- **Keep:** All React components (TabNav, KanbanBoard, EmailView, CRM, etc.), Tailwind CSS, dark mode, @dnd-kit
- **Change:** Components switch from `fetch('/api/...')` to Convex `useQuery`/`useMutation` hooks
- **Frontend:** Deployed to Vercel (not localhost)

## Convex Schema (maps from existing SQLite)

Tables:
- `columns` — id, name, position
- `tasks` — columnId, title, description, priority, dueDate, tags, position, createdAt, updatedAt
- `emailItems` — threadId, messageId, senderName, senderEmail, subject, summary, context, recommendedAction, draftResponse, priority, status, actionedAt, createdAt
- `emailActions` — emailItemId, actionType, description, createdAt
- `contacts` — name, email, phone, company, role, linkedin, location, tier, tags, howWeMet, notes, lastContactDate, createdAt, updatedAt
- `contactActivities` — contactId, activityType, title, content, metadata, createdAt
- `meetingNotes` — contactId, date, attendees, summary, actionItems, sourceEmailId, createdAt
- `appState` — key, value, updatedAt

## Agent → Convex Communication

The Mac Mini agent pushes data via Convex HTTP actions:
- `POST /api/triage` — batch email triage items (same payload format as before)
- `POST /api/contacts` — create/update contacts
- Authenticated via `CONVEX_DEPLOY_KEY` or a shared bearer token in the HTTP action

## Constraints

- All existing UI/UX must look identical — same design, same interactions
- Drag-and-drop must still work (client-side, just backed by Convex mutations)
- No breaking changes to the agent's triage payload format
- Free tier Convex + free tier Vercel = $0 cost
- Setup must be automatable by Navi (bootstrap prompt covers Convex account creation)

## Success Criteria

- [ ] User can access Forge from any device via a Vercel URL
- [ ] Login page blocks unauthenticated access
- [ ] All 3 tabs work identically to the SQLite version
- [ ] Drag-and-drop tasks between columns works
- [ ] Agent can push email triage items via HTTP action → items appear in real-time
- [ ] Agent can push contacts via HTTP action
- [ ] Dark mode toggle works
- [ ] Fresh deployment starts with empty data (3 kanban columns only)
- [ ] Existing component visual design is unchanged
- [ ] Convex free tier stays within limits for a single user
