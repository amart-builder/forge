# Forge Completion Spec

## What we're building

We are taking Forge from a promising live prototype to a fully usable, founder-ready product for Project Deploy customers. Forge will be the operational surface that ships with each OpenClaw setup: a 3-tab app with Tasks, Email, and CRM, backed by Convex, deployed on Vercel, connected to a real email account, able to import real relationship data, and documented well enough that a customer setup can be repeated without hand-holding.

## Who it's for

- Alex, as product owner and operator
- Project Deploy customers paying for the $5K OpenClaw setup package
- Founder/operator users who want one place to manage tasks, email triage, relationships, and morning brief workflows

## Key behaviors

1. A new user can sign up and sign in to Forge successfully.
2. The Tasks tab feels production-ready: stable board, clean Atlas-inspired workflow, no demo-only controls leaking through.
3. The Email tab connects to a real email account via the OpenClaw/Gmail workflow, receives triaged emails, shows summaries, supports drafts/actions, and writes useful CRM context.
4. The CRM tab feels DenchClaw-grade: dense table workflow, fast searching/filtering, strong detail panel, company-aware records, and import support.
5. Contacts can be imported from Attio or CSV, with Supabase available as an optional migration path.
6. Forge becomes the canonical CRM after import; imported records preserve source metadata.
7. Morning Brief runs automatically and delivers a useful daily briefing based on Forge + OpenClaw context.
8. The bootstrap/setup flow for customer machines can install Forge, connect services, and verify health without custom operator improvisation.
9. The app is verifiably stable in local and deployed environments.

## Constraints

- Forge remains the only app shell.
- Convex remains the backend.
- DenchClaw is a source of CRM product patterns and selected component ideas, not an embedded nested app.
- Tasks and Email stay native Forge surfaces.
- CRM is upgraded to a DenchClaw-derived workflow inside Forge.
- Real data replaces dummy/demo behavior wherever possible before calling the product complete.
- Customer setup must still fit the Project Deploy model: GitHub repo + bootstrap prompt + OpenClaw automation.
- Existing live deployment should not be broken casually; changes should be staged and verified.
- All critical flows need an explicit verification step, not just “it should work.”

## Success criteria

- User can sign up/sign in on production Forge without auth errors.
- Tasks tab loads with the intended Atlas-style workflow and no unwanted column-management affordances.
- Email triage ingests real emails through the correct pipeline and displays them in the UI with working actions.
- Email actions update CRM history and relationship state.
- CRM has first-class companies, company-linked contacts, and a DenchClaw-grade table/detail experience.
- Attio import works end-to-end on a realistic sample.
- CSV import supports preview + apply and can import realistic customer data safely.
- Morning Brief sends a useful daily output using live Forge/OpenClaw data.
- Bootstrap/setup docs are accurate enough for a fresh customer machine.
- End-to-end verification passes for: auth, tasks, email ingestion, CRM import, CRM editing, morning brief, and deployed app health.
- Forge can be honestly described as production-usable for the Project Deploy offer.

## Non-goals

- Porting all of DenchClaw into Forge
- Supporting every CRM source system under the sun
- Building a generalized no-code workspace platform
- Making Attio or Supabase permanent runtime dependencies
- Shipping every imaginable polish feature before core reliability is done
