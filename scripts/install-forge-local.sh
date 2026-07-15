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
TSX_BIN="$REPO_DIR/node_modules/.bin/tsx"
if [ ! -x "$TSX_BIN" ]; then
  echo "Could not find tsx at $TSX_BIN. Run 'npm install' first." >&2
  exit 1
fi
CLAUDE_BIN="${FORGE_CLAUDE_BIN:-$(command -v claude 2>/dev/null || true)}"
if [ -z "$CLAUDE_BIN" ] && [ -x "$HOME/.local/bin/claude" ]; then
  CLAUDE_BIN="$HOME/.local/bin/claude"
fi
if [ -z "$CLAUDE_BIN" ] || [ ! -x "$CLAUDE_BIN" ]; then
  echo "Claude Code is required for Forge execution. Install it or set FORGE_CLAUDE_BIN." >&2
  exit 1
fi

mkdir -p "$LOG_DIR" "$LA_DIR"

# --- Install Forge's skills for Claude and Codex ---
# The forge-* skills are refreshed every run in both supported agent homes. The
# bundled humanizer skill is installed only when absent, so unrelated personal
# skills and newer humanizer copies are never overwritten.
SKILLS_SRC="$REPO_DIR/skills"
if [ -d "$SKILLS_SRC" ]; then
  for agent_skills in "$HOME/.claude/skills" "${CODEX_HOME:-$HOME/.codex}/skills"; do
    mkdir -p "$agent_skills"
    for skill_dir in "$SKILLS_SRC"/forge-*; do
      [ -d "$skill_dir" ] || continue
      rm -rf "$agent_skills/$(basename "$skill_dir")"
      cp -R "$skill_dir" "$agent_skills/"
    done
    if [ -d "$SKILLS_SRC/humanizer" ] && [ ! -d "$agent_skills/humanizer" ]; then
      cp -R "$SKILLS_SRC/humanizer" "$agent_skills/"
    fi
    echo "Installed the Forge skills into $agent_skills"
  done
fi

SERVER_PLIST="$LA_DIR/com.forge.local.plist"
BACKUP_PLIST="$LA_DIR/com.forge.local.backup.plist"
REMINDERS_PLIST="$LA_DIR/com.forge.reminders.plist"
TRIAGE_PLIST="$LA_DIR/com.forge.email-triage.plist"
WORKER_PLIST="$LA_DIR/com.forge.claude-worker.plist"
BRIEF_PLIST="$LA_DIR/com.forge.morning-brief.plist"

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
    <key>FORGE_DAY_PLAN_ACCESS_MODE</key>
    <string>loopback</string>
    <key>FORGE_CLAUDE_WORKER_AVAILABLE</key>
    <string>1</string>
  </dict>
</dict>
</plist>
EOF

# --- Claude worker: supervised durable queue consumer ---
cat > "$WORKER_PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.forge.claude-worker</string>
  <key>WorkingDirectory</key>
  <string>$REPO_DIR</string>
  <key>ProgramArguments</key>
  <array>
    <string>$TSX_BIN</string>
    <string>$REPO_DIR/scripts/forge-claude-worker.ts</string>
    <string>--lane</string>
    <string>watch</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>5</integer>
  <key>StandardOutPath</key>
  <string>$LOG_DIR/forge-claude-worker.log</string>
  <key>StandardErrorPath</key>
  <string>$LOG_DIR/forge-claude-worker.error.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>$NODE_BIN:$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin</string>
    <key>HOME</key>
    <string>$HOME</string>
    <key>FORGE_CLAUDE_WORKER_ENABLED</key>
    <string>1</string>
    <key>FORGE_CLAUDE_BIN</key>
    <string>$CLAUDE_BIN</string>
    <key>FORGE_BRIEF_WEB_BASE</key>
    <string>http://127.0.0.1:3200</string>
  </dict>
</dict>
</plist>
EOF

# --- Morning Brief: enqueue and drain the brief lane daily at 7:30am local ---
# One-shot run (no KeepAlive): it enqueues today's brief if none is eligible,
# drains the brief queue, and exits. The watch worker also drains this lane,
# so the two never conflict (single-flight claim in the store).
cat > "$BRIEF_PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.forge.morning-brief</string>
  <key>WorkingDirectory</key>
  <string>$REPO_DIR</string>
  <key>ProgramArguments</key>
  <array>
    <string>$TSX_BIN</string>
    <string>$REPO_DIR/scripts/forge-claude-worker.ts</string>
    <string>--lane</string>
    <string>brief</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key><integer>7</integer>
    <key>Minute</key><integer>30</integer>
  </dict>
  <key>StandardOutPath</key>
  <string>$LOG_DIR/forge-morning-brief.log</string>
  <key>StandardErrorPath</key>
  <string>$LOG_DIR/forge-morning-brief.error.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>$NODE_BIN:$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin</string>
    <key>HOME</key>
    <string>$HOME</string>
    <key>FORGE_CLAUDE_WORKER_ENABLED</key>
    <string>1</string>
    <key>FORGE_CLAUDE_BIN</key>
    <string>$CLAUDE_BIN</string>
    <key>FORGE_BRIEF_WEB_BASE</key>
    <string>http://127.0.0.1:3200</string>
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

# --- Email triage: run the forge-email skill at the user's chosen times ---
# Only scheduled once email is set up (the Email step writes data/forge-email.json
# with triage_times + timezone). launchd fires at LOCAL time on the Mac.
# triage_times may hold any number of "HH:MM" entries; we emit one calendar dict
# per entry. No Weekday keys go in the plist: the runner's weekday guard (driven
# by the config's weekdays_only flag) owns weekend skipping.
if [ -f "$REPO_DIR/data/forge-email.json" ]; then
  TRIAGE_CAL_XML="$(node -e '
    const fs = require("fs");
    let times = ["09:00", "15:00"];
    try {
      const c = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      if (Array.isArray(c.triage_times) && c.triage_times.length) times = c.triage_times;
    } catch {}
    const blocks = times.map((t) => {
      const [h, m] = String(t).split(":").map((n) => parseInt(n, 10) || 0);
      return `    <dict><key>Hour</key><integer>${h}</integer><key>Minute</key><integer>${m}</integer></dict>`;
    }).join("\n");
    process.stdout.write(blocks);
  ' "$REPO_DIR/data/forge-email.json" 2>/dev/null || true)"
  if [ -z "$TRIAGE_CAL_XML" ]; then
    TRIAGE_CAL_XML='    <dict><key>Hour</key><integer>9</integer><key>Minute</key><integer>0</integer></dict>
    <dict><key>Hour</key><integer>15</integer><key>Minute</key><integer>0</integer></dict>'
  fi
  cat > "$TRIAGE_PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.forge.email-triage</string>
  <key>WorkingDirectory</key>
  <string>$REPO_DIR</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$REPO_DIR/scripts/forge-email-triage.sh</string>
  </array>
  <key>StartCalendarInterval</key>
  <array>
$TRIAGE_CAL_XML
  </array>
  <key>StandardOutPath</key>
  <string>$LOG_DIR/forge-email-triage.log</string>
  <key>StandardErrorPath</key>
  <string>$LOG_DIR/forge-email-triage.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>$NODE_BIN:$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin</string>
    <key>HOME</key>
    <string>$HOME</string>
  </dict>
</dict>
</plist>
EOF
  echo "Scheduled email triage (times from data/forge-email.json; default 9:00 and 15:00)."
else
  rm -f "$TRIAGE_PLIST"
fi

# (Re)load all agents with the modern launchctl API (idempotent).
UID_NUM="$(id -u)"
launchctl bootout "gui/$UID_NUM/com.forge.local" 2>/dev/null || true
launchctl bootout "gui/$UID_NUM/com.forge.local.backup" 2>/dev/null || true
launchctl bootout "gui/$UID_NUM/com.forge.reminders" 2>/dev/null || true
launchctl bootout "gui/$UID_NUM/com.forge.email-triage" 2>/dev/null || true
launchctl bootout "gui/$UID_NUM/com.forge.claude-worker" 2>/dev/null || true
launchctl bootout "gui/$UID_NUM/com.forge.morning-brief" 2>/dev/null || true
launchctl bootstrap "gui/$UID_NUM" "$SERVER_PLIST"
launchctl bootstrap "gui/$UID_NUM" "$BACKUP_PLIST"
launchctl bootstrap "gui/$UID_NUM" "$REMINDERS_PLIST"
launchctl bootstrap "gui/$UID_NUM" "$WORKER_PLIST"
launchctl bootstrap "gui/$UID_NUM" "$BRIEF_PLIST"
if [ -f "$TRIAGE_PLIST" ]; then launchctl bootstrap "gui/$UID_NUM" "$TRIAGE_PLIST"; fi
launchctl enable "gui/$UID_NUM/com.forge.local" 2>/dev/null || true
launchctl enable "gui/$UID_NUM/com.forge.claude-worker" 2>/dev/null || true

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
  WORKER_UP=""
  for _ in $(seq 1 10); do
    if [ -f "$REPO_DIR/data/claude-worker.heartbeat" ]; then
      WORKER_UP="yes"
      break
    fi
    sleep 1
  done
  if [ -z "$WORKER_UP" ]; then
    echo "Forge web started, but the Claude worker did not become healthy." >&2
    echo "See: $LOG_DIR/forge-claude-worker.error.log" >&2
    exit 1
  fi
  echo "Forge is running at http://localhost:3200 and will start automatically on login."
  echo "Server logs: $LOG_DIR/forge.log"
  echo "Daily database backups: $REPO_DIR/data/backups"
  echo "Claude worker: supervised by com.forge.claude-worker"
  echo "Morning Brief: scheduled daily at 7:30 by com.forge.morning-brief"
  echo "Autonomous execution remains off until FORGE_CLAUDE_EXECUTION_ENABLED=1 and an allowlisted workspace config are explicitly added."
else
  echo "Forge did not respond on http://localhost:3200 within 20 seconds." >&2
  echo "See the log for why: $LOG_DIR/forge.error.log" >&2
  echo "Most common cause: Node is installed via nvm/fnm/Volta and launchd can't use it." >&2
  echo "Fix: install Node with Homebrew (brew install node), then re-run: bash scripts/install-forge-local.sh" >&2
  exit 1
fi
