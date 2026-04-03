# Forge Build Plan

Spec: ../SPEC.md

## Phase 1: Foundation
- [x] next.config.ts — add serverExternalPackages for better-sqlite3
- [x] .gitignore — add data/
- [ ] src/lib/db.ts — SQLite with all tables, auto-migration, seed data
- [ ] src/app/globals.css — design system (warm white, system fonts, Tailwind v4 theme)
- [ ] src/app/layout.tsx — root layout with TabNav
- [ ] src/components/layout/TabNav.tsx — pill-style tab navigation
- [ ] src/app/page.tsx — redirect to /tasks

## Phase 2: API Routes
- [ ] /api/tasks — GET (list), POST (create)
- [ ] /api/tasks/[id] — PATCH (update), DELETE
- [ ] /api/columns — GET (list), POST (create)
- [ ] /api/columns/[id] — PATCH (update), DELETE
- [ ] /api/emails — GET (list with filters)
- [ ] /api/emails/[id] — PATCH (action/dismiss)
- [ ] /api/emails/[id]/send — POST (send draft)
- [ ] /api/email-actions — GET (action log)
- [ ] /api/contacts — GET (list with search), POST (create)
- [ ] /api/contacts/[id] — PATCH (update), DELETE
- [ ] /api/contacts/[id]/activities — GET, POST
- [ ] /api/contacts/[id]/meetings — GET, POST
- [ ] /api/contacts/import — POST (CSV)
- [ ] /api/cron/email-triage — POST (webhook)
- [ ] /api/status — GET (health)

## Phase 3: UI Components & Pages
- [ ] Tasks: KanbanBoard, Column, TaskCard, TaskDetail, page.tsx
- [ ] Email: SummaryCard, ActionCard, ActionLog, page.tsx
- [ ] CRM: ContactList, ContactDetail, ImportModal, page.tsx

## Phase 4: Verification
- [ ] npm run build — zero errors
- [ ] Completion event
