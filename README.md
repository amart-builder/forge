# Forge — Tasks, Email & CRM

A local-first personal productivity app that runs on your Mac Mini. Three tabs: Tasks (kanban board), Email (AI-powered email handler), and CRM (relationship management).

## Quick Start

```bash
cd ~/forge
npm install
npm run build
npm start -- -p 3200
```

Open http://localhost:3200 in your browser.

## For AI Agents (Navi Setup Instructions)

If you are an AI agent setting up Forge for a user, follow these steps:

### 1. Clone and Install

```bash
cd ~
git clone https://github.com/openclaw-deploy/forge.git
cd forge
npm install
```

### 2. Build and Start

```bash
npm run build
```

### 3. Create LaunchAgent (auto-start on boot)

```bash
cat > ~/Library/LaunchAgents/com.forge.server.plist << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.forge.server</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>-c</string>
        <string>cd ~/forge && npx next start -p 3200</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/tmp/forge.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/forge-error.log</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin</string>
    </dict>
</dict>
</plist>
EOF

launchctl load ~/Library/LaunchAgents/com.forge.server.plist
```

### 4. Set Up Email Handler Cron

Create an OpenClaw cron job that runs 3x/day during work hours to process emails:

```bash
openclaw cron add \
  --name "forge-email-triage" \
  --schedule "0 9,13,17 * * 1-5" \
  --payload "You are the email triage agent. Process all unread emails using the gog gmail CLI. For each email:

1. Read the email with: gog gmail read <id>
2. Classify it:
   - Tier 0 (auto-archive): spam, marketing, 2FA codes, automated notifications
   - Tier 1 (notify only): FYI emails, CC'd threads, informational updates
   - Tier 2 (needs action): direct emails requiring a response or decision

3. For Tier 2 emails, draft a response. Then **run the Humanizer skill on every draft before saving:**
   - Load `~/.openclaw/workspace/skills/humanizer/SKILL.md` and apply its rules to the draft
   - Strip AI-sounding patterns: em dash overuse, "delve", "I hope this finds you well", "Certainly!", filler openers, rule of three, excessive conjunctives, etc.
   - Goal: every draft sounds written by the user, not an AI
   - Exception: skip humanizing if the draft is 1-2 sentences (too short to have patterns)

   Then POST to Forge:
   curl -X POST http://localhost:3200/api/emails/triage -H 'Content-Type: application/json' -d '{
     \"thread_id\": \"<thread_id>\",
     \"sender_name\": \"<name>\",
     \"sender_email\": \"<email>\",
     \"subject\": \"<subject>\",
     \"summary\": \"<your summary of why this matters>\",
     \"context\": \"<relationship context from CRM>\",
     \"recommended_action\": \"reply|archive|follow_up|delegate|flag\",
     \"draft_response\": \"<humanized draft response>\",
     \"priority\": 1-3
   }'

4. For Tier 0, archive directly: gog gmail archive <id>
5. For Tier 1, log as an action: POST to /api/email-actions

6. Check CRM contacts for each sender. If sender is not in CRM, auto-create:
   curl -X POST http://localhost:3200/api/contacts -H 'Content-Type: application/json' -d '{
     \"name\": \"<name>\",
     \"email\": \"<email>\",
     \"company\": \"<company if known>\"
   }'

7. Detect meeting notes in emails. If found, append to contact:
   curl -X POST http://localhost:3200/api/contacts/<id>/meetings -H 'Content-Type: application/json' -d '{
     \"date\": \"<meeting date>\",
     \"summary\": \"<meeting summary>\",
     \"action_items\": [\"<item1>\", \"<item2>\"]
   }'

Always check the full email thread, not just the latest message. Use Opus reasoning to generate thoughtful, personalized draft responses." \
  --session-target isolated \
  --agent-turn
```

### 5. Walk User Through Gmail/Calendar Connection

Ask the user to run:
```bash
gog auth
```

This will open a browser for Google OAuth. They need to authorize:
- Gmail (read, send, modify)
- Google Calendar (read)
- Google Contacts (read)

### 6. Import Existing Contacts

If the user has contacts to import:
```bash
# From Google Contacts
gog contacts list --format csv > /tmp/contacts.csv

# Then upload to Forge
curl -X POST http://localhost:3200/api/contacts/import \
  -F "file=@/tmp/contacts.csv"
```

Or they can click "Import CSV" in the CRM tab to upload manually.

### 7. Generate Email Voice File (Post-Setup)

After Gmail is connected and contacts are imported, generate a **Forge Voice File** — a writing profile that captures how the user actually writes emails, so every draft matches their voice.

1. **Read the last 30 days of sent emails:**
   ```bash
   gog gmail list --folder sent --after $(date -v-30d +%Y/%m/%d) --limit 100
   ```
   Read each email's body with `gog gmail read <id>`. Focus on emails the user personally wrote (skip auto-replies, calendar invites, one-word responses).

2. **Analyze the emails and extract voice patterns.** Look for:
   - Greeting style ("Hey", "Hi [name]", "[name],", no greeting at all?)
   - Sign-off style ("Best", "Thanks", "Cheers", name only, nothing?)
   - Sentence length and rhythm (short punchy sentences? longer and more explanatory?)
   - Formality level (casual vs. professional vs. somewhere in between)
   - Common phrases or expressions they use frequently
   - Punctuation habits (lots of exclamation points? em dashes? ellipses?)
   - How they handle action items (bullet lists? inline requests? "Let me know if..."?)
   - Tone in different contexts: investors vs. friends vs. vendors vs. colleagues

3. **Write the voice file to `~/.openclaw/workspace/FORGE-VOICE.md`:**
   ```markdown
   # FORGE-VOICE.md — Email Voice for [User Name]
   
   Generated from analysis of [N] sent emails (last 30 days). [Date]
   
   ## Writing Style
   - Greeting: ...
   - Sign-off: ...
   - Tone: ...
   - Sentence structure: ...
   - Formality: ...
   
   ## Common Patterns
   - ...
   
   ## Phrases They Use
   - ...
   
   ## Phrases to Avoid (AI tells)
   - "I hope this email finds you well"
   - "Certainly!"
   - "As per our conversation"
   - Em dash overuse
   - ... (add any patterns NOT present in their actual writing)
   
   ## By Recipient Type
   - To investors/LPs: ...
   - To business partners: ...
   - To friends/casual: ...
   ```

4. **Update the email triage cron** to reference this voice file. Add to the cron prompt: "Before drafting any response, read `~/.openclaw/workspace/FORGE-VOICE.md` to understand how [user] writes. Match their voice exactly."

5. Tell the user: "I've analyzed your last 30 days of emails and created a voice profile. Every draft I write will now sound like you — same greeting style, tone, phrases, and rhythm. You can edit `~/.openclaw/workspace/FORGE-VOICE.md` at any time to update it."

### 8. Network Cadence & Outreach Drafter (Post-Setup)

After Forge is running and contacts are imported, ask the user:

> "Would you like to set up automatic outreach drafting? I can help you stay on top of your network by drafting check-in messages for contacts you haven't talked to in a while."

If the user says yes:

**Step 1: Assign contact cadences.** Walk through the CRM contacts with the user. For each contact (or in bulk by tier), ask how often they want to stay in touch:

- **Tier A (Inner Circle):** Every 1-2 weeks — close relationships, key business partners, investors
- **Tier B (Active Network):** Every 2-4 weeks — collaborators, warm contacts, regular business relationships  
- **Tier C (Extended Network):** Every 1-3 months — loose connections, past colleagues, conference contacts
- **Custom:** The user can set a specific cadence per contact (e.g., "every 10 days", "monthly")

Update each contact's tier in Forge:
```bash
curl -X PATCH http://localhost:3200/api/contacts/<id> \
  -H 'Content-Type: application/json' \
  -d '{"tier": "A"}'
```

The user can also do this directly in the CRM tab by clicking on a contact and changing their tier.

**Step 2: Set up the outreach drafter cron.** Create an OpenClaw cron that runs daily (e.g., 10am on weekdays). The cron should:

1. Query all contacts from Forge: `GET http://localhost:3200/api/contacts`
2. For each contact, check `last_contact_date` against their tier's cadence:
   - Tier A: flag if >14 days since last contact
   - Tier B: flag if >28 days since last contact  
   - Tier C: flag if >60 days since last contact
3. For flagged contacts, generate a personalized outreach draft using Opus reasoning:
   - Consider: relationship context, last conversation topic, any shared interests, recent news about them or their company
   - The draft should feel natural and human — not a form letter
4. Post the draft as an email triage item in Forge:
   ```bash
   curl -X POST http://localhost:3200/api/emails/triage \
     -H 'Content-Type: application/json' \
     -d '{
       "sender_name": "<contact name>",
       "sender_email": "<contact email>",
       "subject": "Outreach: <contact name>",
       "summary": "It has been X days since your last contact. Here is a suggested check-in.",
       "context": "<relationship context from CRM>",
       "recommended_action": "reply",
       "draft_response": "<your generated outreach message>",
       "priority": 2
     }'
   ```
5. The user reviews and sends (or edits) from the Email tab — drafts are never sent automatically.

The cron schedule: `0 10 * * 1-5` (10am Mon-Fri, user's timezone)

**Alternative: Manual tier assignment.** If the user prefers, they can skip the walkthrough and assign tiers at their own pace through the CRM tab. The outreach drafter cron will start working as soon as contacts have tiers and last_contact_dates.

### 8. Verify Setup

```bash
# Check Forge is running
curl -s http://localhost:3200/api/status

# Check email cron is configured
openclaw cron list | grep forge-email-triage
```

Open http://localhost:3200 in the user's browser and confirm all three tabs load.

## Tech Stack

- **Next.js 16** with TypeScript and App Router
- **Tailwind CSS** for styling
- **SQLite** (better-sqlite3) for local data persistence (default)
- **@dnd-kit** for drag-and-drop kanban board
- Dark mode with system preference detection

## Data Storage

By default, Forge uses a local SQLite database at `./data/forge.db`. This is the simplest option — zero config, no external dependencies, everything stays on the Mac Mini.

For more advanced setups, ask the user which database option they prefer:

### Option A: SQLite (Default — Local Only)
The default. No setup required. Data lives on the Mac Mini.
- **Pros:** Zero config, fully offline, fast, private — data never leaves the machine
- **Cons:** Single machine only, no real-time sync between devices, manual backups
- **Best for:** Users who primarily work from one machine

To back up: `cp data/forge.db data/forge.db.backup`
To reset: `rm data/forge.db` and restart the server.

### Option B: Supabase (Cloud — Multi-Device)
Replace SQLite with Supabase (hosted Postgres) for cloud sync. Data accessible from any device.
- **Pros:** Access from anywhere, real-time sync, automatic backups, generous free tier
- **Cons:** Requires Supabase account, data leaves the machine, slight latency
- **Best for:** Users who want to access Forge from multiple devices or want cloud backup
- **Setup:** Create a project at supabase.com, get the URL + anon key, run the migration SQL against the Supabase database, update Forge's db.ts to use @supabase/supabase-js instead of better-sqlite3

### Option C: Convex (Real-time Reactive Backend)
Replace SQLite with Convex (convex.dev) for a fully reactive, real-time backend. The most powerful option.
- **Pros:** Real-time reactive queries (UI updates instantly when data changes), built-in TypeScript functions, scheduled jobs, file storage, generous free tier
- **Cons:** Requires Convex account, learning curve for Convex functions, data in cloud
- **Best for:** Power users who want the most responsive experience, or users building custom automations on top of Forge
- **Setup:** `npx convex dev` to initialize, migrate schema to Convex format, replace API routes with Convex queries/mutations. See convex.dev/quickstart/nextjs

Ask the user: *"Forge stores your tasks, contacts, and email data. The recommended option is Convex — it gives you real-time sync, reactive UI, and a great free tier. If you prefer something simpler, we can use local-only SQLite or cloud Postgres via Supabase. What sounds best?"*

Default to **Convex** if the user isn't sure or doesn't want to decide. It's the best experience and free to start.

## API Reference

### Tasks
- `GET /api/tasks` — List all tasks
- `POST /api/tasks` — Create task `{title, description?, priority?, column_id, due_date?, tags?}`
- `PATCH /api/tasks/:id` — Update task
- `DELETE /api/tasks/:id` — Delete task

### Columns
- `GET /api/columns` — List columns
- `POST /api/columns` — Create column `{name}`
- `PATCH /api/columns/:id` — Update column
- `DELETE /api/columns/:id` — Delete column

### Emails
- `GET /api/emails` — List email items (query params: status, priority)
- `PATCH /api/emails/:id` — Update email item
- `POST /api/emails/:id/send` — Send draft response
- `POST /api/emails/triage` — Push new triage items (for cron)
- `GET /api/email-actions` — List action log

### Contacts
- `GET /api/contacts` — List contacts (query params: search, tier, sort)
- `POST /api/contacts` — Create contact
- `PATCH /api/contacts/:id` — Update contact
- `DELETE /api/contacts/:id` — Delete contact
- `GET /api/contacts/:id/activities` — List activities
- `POST /api/contacts/:id/activities` — Add activity
- `POST /api/contacts/:id/meetings` — Add meeting notes
- `POST /api/contacts/import` — Import CSV

### System
- `GET /api/status` — App health check
