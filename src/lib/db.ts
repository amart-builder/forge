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

  db.exec('BEGIN');
  try {
    const insertCol = db.prepare('INSERT INTO columns (id, name, position) VALUES (?, ?, ?)');
    insertCol.run('col-todo', 'To Do', 0);
    insertCol.run('col-progress', 'In Progress', 1);
    insertCol.run('col-done', 'Done', 2);

    const insertTask = db.prepare(
      'INSERT INTO tasks (id, column_id, title, description, priority, due_date, tags, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    );
    insertTask.run('task-1', 'col-todo', 'Design new landing page', 'Create mockups for the updated landing page with new branding guidelines.', 'high', '2026-04-10', '["design","branding"]', 0);
    insertTask.run('task-2', 'col-todo', 'Update API documentation', 'Document the new v2 endpoints and deprecation notices.', 'medium', '2026-04-15', '["docs","api"]', 1);
    insertTask.run('task-3', 'col-todo', 'Fix login page redirect bug', 'Users are being redirected to 404 after OAuth callback.', 'high', '2026-04-05', '["bug","auth"]', 2);
    insertTask.run('task-4', 'col-progress', 'Review pull requests', 'Review and merge pending PRs from the team.', 'low', null, '["review"]', 0);
    insertTask.run('task-5', 'col-progress', 'Deploy v2.0 to staging', 'Run full deployment pipeline and smoke tests on staging.', 'medium', '2026-04-07', '["deploy","ops"]', 1);
    insertTask.run('task-6', 'col-done', 'Write unit tests for auth module', 'Cover all edge cases for token refresh and session management.', 'medium', null, '["testing","auth"]', 0);

    const insertEmail = db.prepare(
      'INSERT INTO email_items (id, thread_id, sender_name, sender_email, subject, summary, context, recommended_action, draft_response, priority, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    insertEmail.run('email-1', 'thread-1', 'Sarah Chen', 'sarah@acmecorp.com', 'Re: Partnership proposal follow-up',
      'Sarah is following up on the partnership discussion from last week. She wants to schedule a call to finalize terms.',
      'Met at TechCrunch Disrupt. A-tier contact, CEO of AcmeCorp.',
      'reply', 'Hi Sarah,\n\nThanks for following up! I\'d love to continue our conversation. How does Thursday at 2pm PT work for you?\n\nBest,\nAlex',
      1, 'pending');
    insertEmail.run('email-2', 'thread-2', 'Dev Team', 'notifications@github.com', 'CI Pipeline failure on main branch',
      'The main branch CI pipeline has been failing for the last 3 builds due to a flaky auth test.',
      'Internal team notification. Needs attention to unblock deployments.',
      'flag', null, 1, 'pending');
    insertEmail.run('email-3', 'thread-3', 'James Wilson', 'james@investorgroup.com', 'Q1 Report Request',
      'James is requesting the Q1 financial summary and growth metrics for the board meeting.',
      'B-tier contact. Lead investor, board member.',
      'reply', 'Hi James,\n\nThe Q1 report is being finalized and will be ready by Friday. I\'ll send it over as soon as it\'s complete.\n\nBest,\nAlex',
      2, 'pending');
    insertEmail.run('email-4', 'thread-4', 'Marketing Weekly', 'newsletter@marketingtools.io', 'Your Weekly Marketing Digest',
      'Standard marketing newsletter with industry trends.',
      'Marketing newsletter subscription.',
      'archive', null, 3, 'pending');

    const insertAction = db.prepare(
      'INSERT INTO email_actions (id, email_item_id, action_type, description) VALUES (?, ?, ?, ?)'
    );
    insertAction.run('ea-1', null, 'archive', 'Archived promotional email from SaaS Weekly');
    insertAction.run('ea-2', null, 'archive', 'Archived newsletter from TechCrunch');
    insertAction.run('ea-3', null, 'flag', 'Flagged urgent email from DevOps about server health');

    const insertContact = db.prepare(
      'INSERT INTO contacts (id, name, email, phone, company, role, linkedin, location, tier, tags, how_we_met, notes, last_contact_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    insertContact.run('contact-1', 'Sarah Chen', 'sarah@acmecorp.com', '+1 415-555-0123', 'AcmeCorp', 'CEO', '/in/sarahchen', 'San Francisco, CA', 'A', '["partner","tech"]', 'Met at TechCrunch Disrupt 2025.', 'Key partnership prospect.', '2026-04-01');
    insertContact.run('contact-2', 'James Wilson', 'james@investorgroup.com', '+1 212-555-0456', 'Investor Group LLC', 'Managing Partner', '/in/jameswilson', 'New York, NY', 'B', '["investor","board"]', 'Introduced through YC Demo Day.', 'Lead investor in Series A.', '2026-03-28');
    insertContact.run('contact-3', 'Maria Rodriguez', 'maria@designstudio.co', '+1 310-555-0789', 'Design Studio Co', 'Creative Director', '/in/mariarodriguez', 'Los Angeles, CA', 'B', '["design","freelance"]', 'Collaborated on brand identity.', 'Excellent designer.', '2026-03-15');
    insertContact.run('contact-4', 'David Park', 'david@cloudinfra.dev', null, 'CloudInfra', 'CTO', '/in/davidpark', 'Seattle, WA', 'C', '["tech","infrastructure"]', 'Connected after his edge computing talk.', '', '2026-02-20');

    const insertActivity = db.prepare(
      'INSERT INTO contact_activities (id, contact_id, activity_type, title, content, metadata) VALUES (?, ?, ?, ?, ?, ?)'
    );
    insertActivity.run('ca-1', 'contact-1', 'meeting', 'Partnership Discussion', 'Discussed API integration partnership and go-to-market strategy.', '{"location":"Zoom","duration":"45min"}');
    insertActivity.run('ca-2', 'contact-1', 'email_sent', 'Sent partnership proposal', 'Followed up with detailed terms and timeline.', '{}');
    insertActivity.run('ca-3', 'contact-2', 'email_received', 'Q1 Report Request', 'James requested Q1 financial summary for board meeting.', '{}');
    insertActivity.run('ca-4', 'contact-3', 'note', 'Design feedback', 'Maria shared excellent feedback on the new dashboard mockups.', '{}');

    db.prepare('INSERT INTO app_state (key, value) VALUES (?, ?)').run('last_email_triage', new Date().toISOString());
    db.prepare('INSERT INTO app_state (key, value) VALUES (?, ?)').run('email_triage_summary', 'Processed 12 emails: 4 need attention, 2 flagged, 6 auto-archived.');

    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export default getDb;
