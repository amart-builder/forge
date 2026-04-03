# Forge Convex Migration — Plan

## Architecture

- Remove all Next.js API routes (src/app/api/*) and better-sqlite3
- Add Convex schema, queries, mutations, and HTTP actions in convex/ directory
- Wrap app in ConvexProvider + ConvexAuthProvider
- Components use useQuery/useMutation instead of fetch()
- HTTP actions provide the external API for the Mac Mini agent
- Deploy frontend to Vercel with NEXT_PUBLIC_CONVEX_URL env var

## Checklist

- [ ] 1. Install Convex, set up project scaffold
  - `npm install convex @convex-dev/auth @auth/core`
  - Remove `better-sqlite3` and `@types/better-sqlite3`
  - Create `convex/` directory
  - Add `convex.json` if needed
  - Files: package.json, convex/

- [ ] 2. Define Convex schema
  - Create `convex/schema.ts` with all tables (columns, tasks, emailItems, emailActions, contacts, contactActivities, meetingNotes, appState)
  - Maps directly from existing SQLite schema in lib/db.ts
  - Files: convex/schema.ts

- [ ] 3. Write Convex query/mutation functions for Tasks
  - `convex/columns.ts` — list, create, update, delete, reorder
  - `convex/tasks.ts` — list (by column), create, update, delete, reorder (position update)
  - Files: convex/columns.ts, convex/tasks.ts

- [ ] 4. Write Convex query/mutation functions for Email
  - `convex/emails.ts` — list (with filters), update status, dismiss
  - `convex/emailActions.ts` — list, create
  - Files: convex/emails.ts, convex/emailActions.ts

- [ ] 5. Write Convex query/mutation functions for CRM
  - `convex/contacts.ts` — list, create, update, delete, search
  - `convex/contactActivities.ts` — list by contact, create
  - `convex/meetingNotes.ts` — list by contact, create
  - Files: convex/contacts.ts, convex/contactActivities.ts, convex/meetingNotes.ts

- [ ] 6. Write Convex HTTP actions for agent API
  - `convex/http.ts` — HTTP router with:
    - `POST /api/triage` — accepts { emails: [...], summary: "..." } batch payload
    - `POST /api/contacts` — create/update contact
    - `GET /api/status` — return app state
  - Auth via bearer token (FORGE_API_SECRET env var in Convex)
  - Files: convex/http.ts

- [ ] 7. Set up Convex Auth (password)
  - `convex/auth.ts` — configure Convex Auth with Password provider
  - `convex/auth.config.ts` — auth config
  - Add auth checks to all queries/mutations (except HTTP actions which use API key)
  - Files: convex/auth.ts, convex/auth.config.ts

- [ ] 8. Create ConvexClientProvider and auth components
  - `src/app/ConvexClientProvider.tsx` — wraps ConvexProvider + ConvexAuthProvider
  - `src/components/auth/SignIn.tsx` — login form (password)
  - Update `src/app/layout.tsx` to wrap in provider
  - Files: src/app/ConvexClientProvider.tsx, src/components/auth/SignIn.tsx, src/app/layout.tsx

- [ ] 9. Migrate Task components to Convex hooks
  - `KanbanBoard.tsx` — useQuery for columns+tasks, useMutation for reorder
  - `Column.tsx` — useMutation for rename, delete
  - `TaskCard.tsx` — minimal changes (props-driven)
  - `TaskDetail.tsx` — useMutation for update, delete
  - Files: src/components/tasks/*.tsx

- [ ] 10. Migrate Email components to Convex hooks
  - `EmailView.tsx` — useQuery for emails+actions+appState
  - `SummaryCard.tsx` — useQuery for appState
  - `ActionCard.tsx` — useMutation for status update, dismiss
  - `ActionLog.tsx` — useQuery for actions
  - Files: src/components/email/*.tsx

- [ ] 11. Migrate CRM components to Convex hooks
  - `ContactList.tsx` — useQuery for contacts (with search/filter)
  - `ContactDetail.tsx` — useQuery for single contact + activities + meetings, useMutation for updates
  - `ImportModal.tsx` — useMutation for bulk create
  - Files: src/components/crm/*.tsx

- [ ] 12. Migrate page components
  - `src/app/page.tsx` (CRM page) — remove fetch, use Convex
  - `src/app/tasks/page.tsx` — remove fetch, use Convex  
  - `src/app/email/page.tsx` — remove fetch, use Convex
  - Files: src/app/page.tsx, src/app/tasks/page.tsx, src/app/email/page.tsx

- [ ] 13. Remove old API routes and SQLite
  - Delete entire `src/app/api/` directory
  - Delete `src/lib/db.ts`
  - Remove better-sqlite3 from package.json
  - Files: src/app/api/ (delete), src/lib/db.ts (delete)

- [ ] 14. Seed default columns
  - Add init function or seed script that creates the 3 default kanban columns if none exist
  - Can be a Convex mutation called on first app load or via CLI
  - Files: convex/init.ts or convex/columns.ts

- [ ] 15. Deploy to Vercel
  - `npx convex deploy` (production deployment)
  - `vercel --prod` with NEXT_PUBLIC_CONVEX_URL env var
  - Verify all pages load, auth works, data persists
  - Files: vercel.json (if needed)

- [ ] 16. End-to-end test
  - Test login flow
  - Test all 3 tabs with real data
  - Test agent HTTP action (push triage items via curl)
  - Test real-time: push item → verify it appears without refresh
  - Test dark mode
  - Verify drag-and-drop still works

- [ ] 17. Update README
  - Replace SQLite instructions with Convex setup
  - Update agent triage instructions (new HTTP action URL)
  - Add Vercel deployment instructions
  - Document FORGE_API_SECRET setup
  - Files: README.md

## Decision Log
<!-- Log deviations from plan here during execution -->
