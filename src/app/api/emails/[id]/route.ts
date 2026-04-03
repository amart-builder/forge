import getDb from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = getDb();
    const body = await req.json();

    const existing = db.prepare('SELECT * FROM email_items WHERE id = ?').get(id);
    if (!existing) {
      return Response.json({ error: 'Email not found' }, { status: 404 });
    }

    if (body.status === 'actioned') {
      db.prepare(
        'UPDATE email_items SET status = ?, actioned_at = ? WHERE id = ?'
      ).run('actioned', new Date().toISOString(), id);
    } else if (body.status === 'dismissed') {
      db.prepare(
        'UPDATE email_items SET status = ?, actioned_at = ? WHERE id = ?'
      ).run('dismissed', new Date().toISOString(), id);
    }

    if (body.draft_response !== undefined) {
      db.prepare(
        'UPDATE email_items SET draft_response = ? WHERE id = ?'
      ).run(body.draft_response, id);
    }

    const updated = db.prepare('SELECT * FROM email_items WHERE id = ?').get(id);
    return Response.json(updated);
  } catch (err) {
    console.error('PATCH /api/emails/[id] error:', err);
    return Response.json({ error: 'Failed to update email' }, { status: 500 });
  }
}
