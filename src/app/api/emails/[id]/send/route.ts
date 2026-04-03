import getDb from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = getDb();

    const email = db.prepare('SELECT * FROM email_items WHERE id = ?').get(id) as
      | { id: string; subject: string; sender_email: string; draft_response: string }
      | undefined;

    if (!email) {
      return Response.json({ error: 'Email not found' }, { status: 404 });
    }

    const now = new Date().toISOString();

    db.prepare(
      'UPDATE email_items SET status = ?, actioned_at = ? WHERE id = ?'
    ).run('actioned', now, id);

    db.prepare(
      'INSERT INTO email_actions (id, email_item_id, action_type, description, created_at) VALUES (?, ?, ?, ?, ?)'
    ).run(
      crypto.randomUUID(),
      id,
      'sent',
      `Sent reply to ${email.sender_email} re: ${email.subject}`,
      now
    );

    return Response.json({ success: true });
  } catch (err) {
    console.error('POST /api/emails/[id]/send error:', err);
    return Response.json({ error: 'Failed to send email' }, { status: 500 });
  }
}
