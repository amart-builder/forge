#!/usr/bin/env node
/**
 * Forge reminder helper. Run every minute by the com.forge.reminders LaunchAgent.
 *
 * Fires a reminder for every open task whose due time has passed and that hasn't
 * been notified yet:
 *   - a native macOS notification (default, controlled by tasks.remind_native)
 *   - a Telegram or iMessage text (if tasks.remind_text is on AND a channel is
 *     configured in data/forge-reminders.json)
 * Then it stamps tasks.notified_at so a reminder fires only once.
 *
 * Runs only while the Mac is awake. On a laptop that is closed or off, reminders
 * fire when it next wakes; for always-on delivery the user needs a Mac Mini/VPS.
 */
import Database from "better-sqlite3";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const repoDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dbPath = process.env.FORGE_DB_PATH || path.join(repoDir, "data", "forge.db");

function loadReminderConfig() {
  let raw;
  try {
    raw = readFileSync(path.join(repoDir, "data", "forge-reminders.json"), "utf8");
  } catch {
    return null; // No text channel configured; native notifications still work.
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    console.error("forge-reminders: data/forge-reminders.json is not valid JSON:", err.message);
    return null;
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

function notifyNative(taskTitle) {
  execFileSync("osascript", [
    "-e",
    `display notification ${asLiteral(taskTitle)} with title ${asLiteral("Forge")} subtitle ${asLiteral("Task due")} sound name ${asLiteral("Glass")}`,
  ]);
}

function notifyTelegram(token, chatId, message) {
  execFileSync("curl", [
    "-sS",
    "-m",
    "15",
    `https://api.telegram.org/bot${token}/sendMessage`,
    "--data-urlencode",
    `chat_id=${chatId}`,
    "--data-urlencode",
    `text=${message}`,
  ]);
}

function notifyIMessage(to, message) {
  execFileSync("osascript", [
    "-e",
    `tell application "Messages" to send ${asLiteral(message)} to buddy ${asLiteral(to)} of (1st service whose service type = iMessage)`,
  ]);
}

/** Parse a due_at into a Date, treating date-only values as 9am LOCAL (not UTC). */
function dueTime(raw) {
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T09:00:00` : raw;
  return new Date(normalized);
}

function main() {
  let db;
  try {
    db = new Database(dbPath, { fileMustExist: true });
  } catch {
    return; // No database yet; nothing to do.
  }
  db.pragma("busy_timeout = 5000");

  const due = db
    .prepare(
      `SELECT id, title, due_at, remind_native, remind_text
         FROM tasks
        WHERE status = 'open' AND notified_at IS NULL AND due_at IS NOT NULL`,
    )
    .all()
    .filter((t) => {
      const when = dueTime(t.due_at);
      return !Number.isNaN(when.getTime()) && when.getTime() <= Date.now();
    });

  if (due.length === 0) return;

  const config = loadReminderConfig();
  const token = telegramToken();
  const claim = db.prepare(
    "UPDATE tasks SET notified_at = ? WHERE id = ? AND notified_at IS NULL",
  );

  for (const task of due) {
    // Claim the task atomically before firing. If an overlapping run (a slow
    // tick that ran past 60s) already took it, changes is 0 and we skip, so a
    // reminder is never sent twice. A failed send still leaves it claimed, so
    // a transient error doesn't loop forever.
    if (claim.run(new Date().toISOString(), task.id).changes !== 1) continue;

    const title = task.title || "Task";
    try {
      if (task.remind_native) notifyNative(title);

      if (task.remind_text && config) {
        const message = `Forge reminder: ${title}`;
        if (config.channel === "telegram" && token && config.telegram_chat_id) {
          notifyTelegram(token, config.telegram_chat_id, message);
        } else if (config.channel === "imessage" && config.imessage_to) {
          notifyIMessage(config.imessage_to, message);
        }
      }
    } catch (err) {
      console.error(`Reminder for task ${task.id} failed:`, err.message);
    }
  }
}

main();
