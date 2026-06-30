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

This does three things:

- Starts Forge at `http://localhost:3200`.
- Makes it start automatically every time the Mac turns on, and restart itself if it ever crashes.
- Sets up a daily backup of the database.

It binds to `localhost` only, so Forge is never exposed to the network. It is reachable only from this Mac.

### 4. Hand it to the user

Tell the user:

- "Forge is running at `http://localhost:3200`. Bookmark that page. It is always on, so it will be there whenever you open it."
- "Everything saves locally on your Mac. There is no account and no login."

### 5. Tasks, Email, and CRM

- **Tasks** works immediately.
- **Email** and **CRM** are configured in their own setup steps, after a short interview about the user's accounts and how they like to work. Until then, the Email tab opens to an empty inbox and the CRM tab shows a short note.

### Need it on more than one device?

Forge keeps everything in one local file (`data/forge.db`). That is the simplest and most private option, and it is the default.

If the user wants Forge on more than one device, for example their phone or an always-on Mac Mini, tell them you can move their data to a cloud database (Supabase or Convex) and sync across devices. That requires creating a free cloud account, which the user does once by hand. Offer it only if they ask; do not set it up by default.

---

## Using Forge (for the user)

Open `http://localhost:3200`. You will see three tabs:

- **Tasks** — a simple board for everything you need to do, organized into columns: Not Started, Must happen today, In Flight / Waiting, and Done.
- **Email** — set up in the Email step.
- **CRM** — set up in the CRM step.

Notifications (Forge reminding you on your Mac when something is due) are added in the Tasks step.

---

## How it runs (for the curious)

- **One small program**, started by a macOS LaunchAgent named `com.forge.local`, serving `http://localhost:3200`, bound to localhost only.
- **One file of data**: `data/forge.db`. It is backed up every day to `data/backups/` (the last 14 days are kept), so restarting or rebooting never loses anything.
- **No accounts and no network calls** to store your data. It is all on the Mac.

Handy commands:

```bash
bash scripts/forge-backup.sh          # back up the database right now
launchctl unload ~/Library/LaunchAgents/com.forge.local.plist   # stop the auto-start
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
