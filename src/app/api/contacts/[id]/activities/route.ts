import getDb from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  ctx: RouteContext<'/api/contacts/[id]/activities'>
) {
  try {
    const { id } = await ctx.params;
    const db = getDb();

    const contact = db.prepare('SELECT id FROM contacts WHERE id = ?').get(id);
    if (!contact) {
      return Response.json({ error: 'Contact not found' }, { status: 404 });
    }

    const activities = db
      .prepare('SELECT * FROM contact_activities WHERE contact_id = ? ORDER BY created_at DESC')
      .all(id);

    return Response.json({ activities });
  } catch (err) {
    console.error('GET /api/contacts/[id]/activities error:', err);
    return Response.json({ error: 'Failed to fetch activities' }, { status: 500 });
  }
}

export async function POST(
  req: Request,
  ctx: RouteContext<'/api/contacts/[id]/activities'>
) {
  try {
    const { id } = await ctx.params;
    const db = getDb();

    const contact = db.prepare('SELECT id FROM contacts WHERE id = ?').get(id);
    if (!contact) {
      return Response.json({ error: 'Contact not found' }, { status: 404 });
    }

    const body = await req.json();
    const { activity_type, title, content, metadata } = body;

    if (!activity_type || !title) {
      return Response.json(
        { error: 'activity_type and title are required' },
        { status: 400 }
      );
    }

    const validTypes = ['email_sent', 'email_received', 'meeting', 'note', 'call'];
    if (!validTypes.includes(activity_type)) {
      return Response.json(
        { error: `activity_type must be one of: ${validTypes.join(', ')}` },
        { status: 400 }
      );
    }

    const activityId = crypto.randomUUID();
    const now = new Date().toISOString();

    db.prepare(
      `INSERT INTO contact_activities (id, contact_id, activity_type, title, content, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      activityId,
      id,
      activity_type,
      title,
      content ?? null,
      metadata ? JSON.stringify(metadata) : '{}',
      now
    );

    const activity = db.prepare('SELECT * FROM contact_activities WHERE id = ?').get(activityId);
    return Response.json({ activity }, { status: 201 });
  } catch (err) {
    console.error('POST /api/contacts/[id]/activities error:', err);
    return Response.json({ error: 'Failed to create activity' }, { status: 500 });
  }
}
