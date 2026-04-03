import getDb from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { emails, summary } = body;

    if (!Array.isArray(emails)) {
      return Response.json({ error: 'emails must be an array' }, { status: 400 });
    }

    const db = getDb();
    const now = new Date().toISOString();

    const insertEmail = db.prepare(
      `INSERT INTO email_items (id, sender_name, sender_email, subject, summary, context, recommended_action, draft_response, priority, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`
    );

    const insertAction = db.prepare(
      `INSERT INTO email_actions (id, email_item_id, action_type, description, created_at)
       VALUES (?, ?, ?, ?, ?)`
    );

    const tx = db.transaction(() => {
      for (const email of emails) {
        const emailId = crypto.randomUUID();
        insertEmail.run(
          emailId,
          email.sender_name ?? null,
          email.sender_email ?? null,
          email.subject ?? null,
          email.summary ?? null,
          email.context ?? null,
          email.recommended_action ?? 'review',
          email.draft_response ?? null,
          email.priority ?? 2,
          now
        );

        insertAction.run(
          crypto.randomUUID(),
          emailId,
          'triaged',
          `Auto-triaged: ${email.subject ?? 'No subject'} → ${email.recommended_action ?? 'review'}`,
          now
        );
      }

      db.prepare(
        `INSERT INTO app_state (key, value, updated_at) VALUES ('last_email_triage', ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      ).run(now, now);

      if (summary) {
        db.prepare(
          `INSERT INTO app_state (key, value, updated_at) VALUES ('email_triage_summary', ?, ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
        ).run(summary, now);
      }
    });

    tx();

    return Response.json({ success: true, count: emails.length });
  } catch (err) {
    console.error('POST /api/cron/email-triage error:', err);
    return Response.json({ error: 'Failed to process triage' }, { status: 500 });
  }
}
