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

3. For Tier 2 emails, POST to Forge:
   curl -X POST http://localhost:3200/api/emails/triage -H 'Content-Type: application/json' -d '{
     \"thread_id\": \"<thread_id>\",
     \"sender_name\": \"<name>\",
     \"sender_email\": \"<email>\",
     \"subject\": \"<subject>\",
     \"summary\": \"<your summary of why this matters>\",
     \"context\": \"<relationship context from CRM>\",
     \"recommended_action\": \"reply|archive|follow_up|delegate|flag\",
     \"draft_response\": \"<your suggested reply if action is reply>\",
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

### 7. Verify Setup

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
- **SQLite** (better-sqlite3) for local data persistence
- **@dnd-kit** for drag-and-drop kanban board
- No external database or server required — everything runs locally

## Data Storage

All data is stored in `./data/forge.db` (SQLite). This file is created automatically on first run.

To back up: `cp data/forge.db data/forge.db.backup`
To reset: `rm data/forge.db` and restart the server.

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
