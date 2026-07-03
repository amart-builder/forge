#!/usr/bin/env node
/**
 * Forge notify helper. Sends one line to the user's configured reminder channel.
 *
 *   node scripts/forge-notify.mjs "Inbox triaged: 2 need you, 1 action"
 *
 * The message is read from argv (never interpolated into a shell), so text from
 * email summaries can pass through safely. Reads the same channel config the
 * reminders cron uses (data/forge-reminders.json + the Telegram token). Prints
 * nothing on success; a missing channel is a no-op (exit 0), so callers do not
 * have to special-case an unconfigured user.
 *
 * Runs only while the Mac is awake, same limit as reminders.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const repoDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const message = process.argv.slice(2).join(" ").trim();
if (!message) {
  console.error("Usage: node scripts/forge-notify.mjs <message>");
  process.exit(2);
}

function loadReminderConfig() {
  try {
    return JSON.parse(
      readFileSync(path.join(repoDir, "data", "forge-reminders.json"), "utf8"),
    );
  } catch {
    return null; // No text channel configured; nothing to send.
  }
}

function telegramToken() {
  try {
    const env = readFileSync(
      path.join(os.homedir(), ".claude/channels/telegram/.env"),
      "utf8",
    );
    const match = env.match(/^TELEGRAM_BOT_TOKEN=(.+)$/m);
    return match ? match[1].trim() : null;
  } catch {
    return null;
  }
}

/** Quote a string as an AppleScript literal (safe against quotes/newlines). */
function asLiteral(s) {
  return `"${String(s)
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")}"`;
}

function sendTelegram(token, chatId, text) {
  // curl exits 0 even on a 4xx, so check the API's own ok flag. Otherwise a bad
  // token or chat_id drops the nudge silently, which for an unattended run means
  // the user never learns triage happened.
  const out = execFileSync("curl", [
    "-sS",
    "-m",
    "15",
    `https://api.telegram.org/bot${token}/sendMessage`,
    "--data-urlencode",
    `chat_id=${chatId}`,
    "--data-urlencode",
    `text=${text}`,
  ]).toString();
  if (!/"ok":\s*true/.test(out)) {
    throw new Error(`Telegram API rejected the message: ${out.slice(0, 200)}`);
  }
}

function sendIMessage(to, text) {
  execFileSync("osascript", [
    "-e",
    `tell application "Messages" to send ${asLiteral(text)} to buddy ${asLiteral(to)} of (1st service whose service type = iMessage)`,
  ]);
}

const config = loadReminderConfig();
if (!config) process.exit(0); // no channel: silent no-op

try {
  if (config.channel === "telegram") {
    const token = telegramToken();
    if (token && config.telegram_chat_id) {
      sendTelegram(token, config.telegram_chat_id, message);
    }
  } else if (config.channel === "imessage" && config.imessage_to) {
    sendIMessage(config.imessage_to, message);
  }
} catch (err) {
  console.error("forge-notify failed:", err.message);
  process.exit(1);
}
