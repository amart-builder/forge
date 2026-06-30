# Forge

Your command center for Tasks, Email, and CRM, running entirely on your own Mac.

Forge is local-first. Everything lives in a single file on your laptop. There is no account to create, no login screen, and nothing leaves your machine. You open it like any website, by bookmarking a page, but it runs on your own computer and is always on.

---

## Set up Forge (for your AI assistant)

You do not need to do any of this by hand. Send this repository's link to your AI assistant (Claude) and say "set up Forge for me." The steps below are the instructions it follows.

> Setup is fully local by design. Do not configure Tailscale, Supabase, Convex, or any login. The default is a local SQLite database with no authentication. Only switch to a cloud database if the user explicitly asks for multi-device access (see "Need it on more than one device?" below).

### 1. Clone and install

```bash
git clone https://github.com/amart-builder/forge.git ~/forge
cd ~/forge
npm install
```

If `npm install` fails while building `better-sqlite3`, install Apple's command line tools once with `xcode-select --install`, then run `npm install` again.

### 2. Build

```bash
npm run build
```

### 3. Start it, and make it start on its own

```bash
bash scripts/install-forge-local.sh
```

This sets up four things:

- Installs the task-capture skill, so the user can add tasks just by telling Claude.
- Starts Forge at `http://localhost:3200`, makes it start automatically every time the Mac turns on, and restarts it if it ever crashes.
- Runs a reminder checker every minute, so tasks notify the user when they are due.
- Sets up a daily backup of the database.

It binds to `localhost` only, so Forge is never exposed to the network. It is reachable only from this Mac.

### 4. Hand it to the user

Tell the user:

- "Forge is running at `http://localhost:3200` and everything saves locally on your Mac. There is no account and no login."
- "Next we'll bookmark it and turn on reminders." (That is the Tasks step below.)

### 5. Set up Tasks

Tasks works the moment Forge is running. This step turns it into a real reminder system. Walk the user through it like a conversation. Do not dump all of it on them at once.

**a. Bookmark the board.** Get the page to one click:

- Open `http://localhost:3200/tasks` in their main browser.
- Chrome, Edge, or Brave: press `Cmd+D`, then "Done". Safari: press `Cmd+D`, then "Add". Or drag the icon at the left of the address bar onto the bookmarks bar.
- Suggest they pin it or keep it on the bookmarks bar so it is always there.

**b. Capture by talking (already installed).** The setup script installed a skill so the user can just tell you in plain language what to remember: "remind me to call Joe Friday", "add prep the deck to my board", "I need to send the invoice by Tuesday". You put it on the board, choose a due date when they do not give one (from their current task load and the priorities in their `CLAUDE.md`), and set a reminder. Tell the user they can do this anytime.

**c. Notifications are on.** Any task with a due time pops a native Mac notification when it is due, while the Mac is awake. Nothing to set up.

**d. Text reminders (ask).** Ask the user: "Do you use Telegram or iMessage with Claude? If so, I can text you reminders, not just notify you on this Mac." If yes, and they already have that channel set up, record it so the reminder helper can reach them. Write `data/forge-reminders.json` in the repo:

- Telegram: `{ "channel": "telegram", "telegram_chat_id": "<their chat id>", "always_on": false }`
- iMessage: `{ "channel": "imessage", "imessage_to": "<phone or Apple ID>", "always_on": false }`

If they use neither, skip it. Native notifications still work.

**e. Be honest about where it runs.** Forge and its reminders only run while this Mac is awake. Detect the machine and tell the user the truth:

```bash
system_profiler SPHardwareDataType | grep "Model Name"   # "MacBook ..." = laptop
```

- **Laptop only:** tell them plainly: "Because Forge runs on your laptop, I can only notify or text you while it is open and awake. If it is closed or off, reminders wait until you open it again, and I cannot answer your texts." Keep `always_on` as `false`.
- **Always-on Mac (a Mac Mini) or a VPS:** reminders and texts work around the clock. Set `always_on` to `true`. Putting Forge on an always-on machine is the multi-device path (see "Need it on more than one device?").
- Also ask whether they have a second, always-on machine, since only they know that.

**f. Voice notes (ask, optional).** Ask: "Want to send me a voice note on Telegram or iMessage and have me turn it into a task?" If yes, set it up:

```bash
bash scripts/install-forge-voice.sh
```

That installs a small on-device transcription tool (no API key, nothing leaves the Mac; mlx-whisper on Apple Silicon, faster-whisper on Intel) and tests it. After that, a voice note the user sends to Claude on Telegram or iMessage becomes a task automatically. Same limits as text reminders (step e): it only works while the Mac is awake and Claude is reachable on that channel.

### 6. Email and CRM

**Email** and **CRM** are configured in their own setup steps, after a short interview about the user's accounts and how they like to work. Until then, the Email tab opens to an empty inbox and the CRM tab shows a short note.

### Need it on more than one device?

Forge keeps everything in one local file (`data/forge.db`). That is the simplest and most private option, and it is the default.

If the user wants Forge on more than one device, for example their phone or an always-on Mac Mini, tell them you can move their data to a cloud database (Supabase or Convex) and sync across devices. That requires creating a free cloud account, which the user does once by hand. Offer it only if they ask; do not set it up by default.

---

## Using Forge (for the user)

Open `http://localhost:3200`. You will see three tabs:

- **Tasks**: a simple board for everything you need to do, organized into columns: Not Started, Must happen today, In Flight / Waiting, and Done.
- **Email**: set up in the Email step.
- **CRM**: set up in the CRM step.

You do not have to add tasks by hand. Just tell Claude in plain language: "remind me to call the roofer tomorrow", "add finish the proposal to my board". Claude puts it on the board, picks a due date if you did not give one, and reminds you. When a task is due, Forge pops a notification on your Mac. If you set up Telegram or iMessage, it can text you too.

---

## How it runs (for the curious)

- **One small program**, started by a macOS LaunchAgent named `com.forge.local`, serving `http://localhost:3200`, bound to localhost only.
- **A reminder checker** (`com.forge.reminders`) wakes once a minute, looks for tasks whose time has come, and fires the notification (and a text, if set up). Logs to `~/Library/Logs/forge-reminders.log`.
- **One file of data**: `data/forge.db`. It is backed up every day to `data/backups/` (the last 14 days are kept), so restarting or rebooting never loses anything.
- **No accounts and no network calls** to store your data. It is all on the Mac.

Handy commands:

```bash
bash scripts/forge-backup.sh                         # back up the database right now
launchctl bootout gui/$(id -u)/com.forge.local       # stop Forge (and its auto-start)
launchctl bootout gui/$(id -u)/com.forge.reminders   # stop reminder notifications
```

To start fresh: stop Forge, delete `data/forge.db`, and start it again. It will recreate the default board.

## Tech stack

- Next.js 16 (React 19), TypeScript, Tailwind CSS.
- Local data: SQLite via `better-sqlite3` (the default).
- Optional cloud data for multi-device use: Supabase or Convex (off by default).

## Storage modes

Forge has one switch, the `NEXT_PUBLIC_FORGE_RUNTIME` environment variable:

| Value | What it uses | Login | Best for |
| --- | --- | --- | --- |
| unset or `local` | Local SQLite file (default) | None | One Mac. The recommended default. |
| `supabase` | Cloud Postgres | Yes | Multiple devices, cloud backup. |
| `convex` | Cloud reactive backend | Yes | Multiple devices, live automations. |

Set it in a `.env.local` file in the project root only if you are moving off local storage.
