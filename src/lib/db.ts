import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DB_PATH = path.join(process.cwd(), 'data', 'forge.db');

let _db: Database.Database;

function getDb(): Database.Database {
  if (!_db) {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    _db = new Database(DB_PATH);
    _db.pragma('journal_mode = WAL');
    _db.pragma('foreign_keys = ON');
    migrate(_db);
  }
  return _db;
}

function migrate(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS columns (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
      name TEXT NOT NULL,
      position REAL NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
      column_id TEXT NOT NULL REFERENCES columns(id),
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      priority TEXT DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
      due_date DATE,
      tags TEXT DEFAULT '[]',
      position REAL NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS email_items (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
      thread_id TEXT,
      message_id TEXT,
      sender_name TEXT,
      sender_email TEXT,
      subject TEXT,
      summary TEXT,
      context TEXT,
      recommended_action TEXT DEFAULT 'review' CHECK (recommended_action IN ('reply', 'archive', 'follow_up', 'delegate', 'flag', 'review')),
      draft_response TEXT,
      priority INTEGER DEFAULT 2 CHECK (priority BETWEEN 1 AND 3),
      status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'actioned', 'dismissed')),
      actioned_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS email_actions (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
      email_item_id TEXT REFERENCES email_items(id),
      action_type TEXT NOT NULL,
      description TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS contacts (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
      name TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      company TEXT,
      role TEXT,
      linkedin TEXT,
      location TEXT,
      tier TEXT DEFAULT 'C',
      tags TEXT DEFAULT '[]',
      how_we_met TEXT,
      notes TEXT DEFAULT '',
      last_contact_date DATE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS contact_activities (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
      contact_id TEXT NOT NULL REFERENCES contacts(id),
      activity_type TEXT NOT NULL CHECK (activity_type IN ('email_sent', 'email_received', 'meeting', 'note', 'call')),
      title TEXT,
      content TEXT,
      metadata TEXT DEFAULT '{}',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS meeting_notes (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
      contact_id TEXT NOT NULL REFERENCES contacts(id),
      date DATE,
      attendees TEXT DEFAULT '[]',
      summary TEXT,
      action_items TEXT DEFAULT '[]',
      source_email_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS app_state (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  seed(db);
}

function seed(db: Database.Database) {
  const colCount = (db.prepare('SELECT COUNT(*) as c FROM columns').get() as { c: number }).c;
  if (colCount > 0) return;

  // Only seed the kanban column structure — no fake emails, contacts, or tasks.
  // Real data comes from the email triage cron and user input.
  db.exec('BEGIN');
  try {
    const insertCol = db.prepare('INSERT INTO columns (id, name, position) VALUES (?, ?, ?)');
    insertCol.run('col-todo', 'To Do', 0);
    insertCol.run('col-progress', 'In Progress', 1);
    insertCol.run('col-done', 'Done', 2);

    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export default getDb;
