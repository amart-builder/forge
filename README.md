# Forge

Your command center for Tasks, Email, and CRM, running entirely on your own Mac.

Forge is local-first. Everything lives in a single file on your laptop. There is no account to create, no login screen, and nothing leaves your machine. You open it like any website, by bookmarking a page, but it runs on your own computer and is always on.

---

## Get Forge set up

You do not set this up by hand. Send this repository's link to your AI assistant (Claude) and say "set up Forge for me." Claude follows the playbook in [SETUP.md](SETUP.md): it installs Forge, makes it start on its own, walks you through bookmarking it and turning on reminders, and, if you want, connects Telegram or iMessage so you can get text reminders and send voice notes.

When it is done, Forge is running at `http://localhost:3200` on your Mac.

---

## Using Forge

Open `http://localhost:3200` (bookmark it the first time). You will see three tabs:

- **Tasks**: a board for everything you need to do, in four columns: Not Started, Must happen today, In Flight / Waiting, and Done.
- **Email**: set up in the Email step.
- **CRM**: set up in the CRM step.

You do not have to add tasks by hand. Just tell Claude in plain language: "remind me to call the roofer tomorrow", "add finish the proposal to my board". Claude puts it on the board, picks a due date if you did not give one, and reminds you. When a task is due, Forge pops a notification on your Mac. If you connected Telegram or iMessage, it can text you the reminder, and you can send it a voice note to turn into a task.

---

## How it runs (for the curious)

- **One small program**, started by a macOS LaunchAgent named `com.forge.local`, serving `http://localhost:3200`, bound to localhost only (never exposed to the network).
- **A reminder checker** (`com.forge.reminders`) wakes once a minute, looks for tasks whose time has come, and fires the notification (and a text, if you set one up). Logs to `~/Library/Logs/forge-reminders.log`.
- **One file of data**: `data/forge.db`, backed up every day to `data/backups/` (the last 14 days are kept), so restarting or rebooting never loses anything.
- **No accounts and no network calls** to store your data. It is all on the Mac.

Handy commands:

```bash
bash scripts/forge-backup.sh                         # back up the database right now
launchctl bootout gui/$(id -u)/com.forge.local       # stop Forge (and its auto-start)
launchctl bootout gui/$(id -u)/com.forge.reminders   # stop reminder notifications
```

To start fresh: stop Forge, delete `data/forge.db`, and start it again. It recreates the default board.

## Tech stack

- Next.js 16 (React 19), TypeScript, Tailwind CSS.
- Local data: SQLite via `better-sqlite3` (the default). No login.
- Optional cloud data for multi-device use: Supabase or Convex (off by default). See [SETUP.md](SETUP.md).
