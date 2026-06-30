#!/usr/bin/env bash
# Set up Forge to run locally and start automatically on login.
#   - Serves http://localhost:3200 (bound to localhost only; never exposed to the network)
#   - Restarts itself if it crashes or the Mac reboots
#   - Backs up the database once a day
# Safe to re-run: it replaces any previous Forge LaunchAgents.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="$HOME/Library/Logs"
LA_DIR="$HOME/Library/LaunchAgents"
# Resolve the real Node binary. process.execPath follows nvm/fnm/Volta shims to
# the actual executable, which is what launchd needs in its bare environment.
NODE_REAL="$(node -e 'process.stdout.write(process.execPath)' 2>/dev/null || true)"
if [ -z "$NODE_REAL" ]; then
  echo "Node.js is not on PATH. Install Node (brew install node), then re-run this script." >&2
  exit 1
fi
NODE_BIN="$(dirname "$NODE_REAL")"
case "$NODE_REAL" in
  *nvm*|*fnm*|*volta*|*/.asdf/*)
    echo "Note: Node is managed by a version manager. If Forge stops starting after you switch Node versions, re-run this script." ;;
esac

NEXT_BIN="$REPO_DIR/node_modules/.bin/next"
if [ ! -x "$NEXT_BIN" ]; then
  echo "Could not find Next.js at $NEXT_BIN. Run 'npm install' and 'npm run build' first." >&2
  exit 1
fi

mkdir -p "$LOG_DIR" "$LA_DIR"

# --- Install Forge's skills for the user's Claude ---
# The forge-* skills (task capture, email triage, voice honing, voice notes) are
# refreshed every run. The bundled humanizer skill is installed only if the user
# does not already have one, so we never clobber a newer copy they rely on.
SKILLS_SRC="$REPO_DIR/skills"
if [ -d "$SKILLS_SRC" ]; then
  mkdir -p "$HOME/.claude/skills"
  for skill_dir in "$SKILLS_SRC"/forge-*; do
    [ -d "$skill_dir" ] || continue
    rm -rf "$HOME/.claude/skills/$(basename "$skill_dir")"
    cp -R "$skill_dir" "$HOME/.claude/skills/"
  done
  if [ -d "$SKILLS_SRC/humanizer" ] && [ ! -d "$HOME/.claude/skills/humanizer" ]; then
    cp -R "$SKILLS_SRC/humanizer" "$HOME/.claude/skills/"
    echo "Installed the humanizer skill into ~/.claude/skills"
  fi
  echo "Installed the Forge skills into ~/.claude/skills"
fi

SERVER_PLIST="$LA_DIR/com.forge.local.plist"
BACKUP_PLIST="$LA_DIR/com.forge.local.backup.plist"
REMINDERS_PLIST="$LA_DIR/com.forge.reminders.plist"

# --- Server: next start on localhost:3200 ---
cat > "$SERVER_PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.forge.local</string>
  <key>WorkingDirectory</key>
  <string>$REPO_DIR</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NEXT_BIN</string>
    <string>start</string>
    <string>-H</string>
    <string>127.0.0.1</string>
    <string>-p</string>
    <string>3200</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>$LOG_DIR/forge.log</string>
  <key>StandardErrorPath</key>
  <string>$LOG_DIR/forge.error.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>$NODE_BIN:/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin</string>
    <key>NODE_ENV</key>
    <string>production</string>
  </dict>
</dict>
</plist>
EOF

# --- Daily database backup at 3:30am ---
cat > "$BACKUP_PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.forge.local.backup</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$REPO_DIR/scripts/forge-backup.sh</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key><integer>3</integer>
    <key>Minute</key><integer>30</integer>
  </dict>
  <key>StandardOutPath</key>
  <string>$LOG_DIR/forge-backup.log</string>
  <key>StandardErrorPath</key>
  <string>$LOG_DIR/forge-backup.log</string>
</dict>
</plist>
EOF

# --- Reminders: check for due tasks every minute and fire notifications ---
cat > "$REMINDERS_PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.forge.reminders</string>
  <key>WorkingDirectory</key>
  <string>$REPO_DIR</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE_REAL</string>
    <string>$REPO_DIR/scripts/forge-reminders.mjs</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>StartInterval</key>
  <integer>60</integer>
  <key>StandardOutPath</key>
  <string>$LOG_DIR/forge-reminders.log</string>
  <key>StandardErrorPath</key>
  <string>$LOG_DIR/forge-reminders.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>$NODE_BIN:/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin</string>
  </dict>
</dict>
</plist>
EOF

# (Re)load all agents with the modern launchctl API (idempotent).
UID_NUM="$(id -u)"
launchctl bootout "gui/$UID_NUM/com.forge.local" 2>/dev/null || true
launchctl bootout "gui/$UID_NUM/com.forge.local.backup" 2>/dev/null || true
launchctl bootout "gui/$UID_NUM/com.forge.reminders" 2>/dev/null || true
launchctl bootstrap "gui/$UID_NUM" "$SERVER_PLIST"
launchctl bootstrap "gui/$UID_NUM" "$BACKUP_PLIST"
launchctl bootstrap "gui/$UID_NUM" "$REMINDERS_PLIST"
launchctl enable "gui/$UID_NUM/com.forge.local" 2>/dev/null || true

# Confirm the server actually came up. This catches the most common failure:
# launchd not being able to find/run Node on the client's machine.
echo "Starting Forge..."
UP=""
for _ in $(seq 1 20); do
  CODE="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:3200/tasks" 2>/dev/null || true)"
  case "$CODE" in
    200|307|308) UP="yes"; break ;;
  esac
  sleep 1
done

if [ -n "$UP" ]; then
  echo "Forge is running at http://localhost:3200 and will start automatically on login."
  echo "Server logs: $LOG_DIR/forge.log"
  echo "Daily database backups: $REPO_DIR/data/backups"
else
  echo "Forge did not respond on http://localhost:3200 within 20 seconds." >&2
  echo "See the log for why: $LOG_DIR/forge.error.log" >&2
  echo "Most common cause: Node is installed via nvm/fnm/Volta and launchd can't use it." >&2
  echo "Fix: install Node with Homebrew (brew install node), then re-run: bash scripts/install-forge-local.sh" >&2
  exit 1
fi
