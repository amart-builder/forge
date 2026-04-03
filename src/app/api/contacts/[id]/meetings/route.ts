import getDb from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  ctx: RouteContext<'/api/contacts/[id]/meetings'>
) {
  try {
    const { id } = await ctx.params;
    const db = getDb();

    const contact = db.prepare('SELECT id FROM contacts WHERE id = ?').get(id);
    if (!contact) {
      return Response.json({ error: 'Contact not found' }, { status: 404 });
    }

    const meetings = db
      .prepare('SELECT * FROM meeting_notes WHERE contact_id = ? ORDER BY date DESC')
      .all(id);

    return Response.json({ meetings });
  } catch (err) {
    console.error('GET /api/contacts/[id]/meetings error:', err);
    return Response.json({ error: 'Failed to fetch meetings' }, { status: 500 });
  }
}

export async function POST(
  req: Request,
  ctx: RouteContext<'/api/contacts/[id]/meetings'>
) {
  try {
    const { id } = await ctx.params;
    const db = getDb();

    const contact = db.prepare('SELECT id FROM contacts WHERE id = ?').get(id);
    if (!contact) {
      return Response.json({ error: 'Contact not found' }, { status: 404 });
    }

    const body = await req.json();
    const { date, attendees, summary, action_items, source_email_id } = body;

    if (!summary) {
      return Response.json({ error: 'summary is required' }, { status: 400 });
    }

    const meetingId = crypto.randomUUID();
    const now = new Date().toISOString();

    db.prepare(
      `INSERT INTO meeting_notes (id, contact_id, date, attendees, summary, action_items, source_email_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      meetingId,
      id,
      date ?? new Date().toISOString().split('T')[0],
      attendees ? JSON.stringify(attendees) : '[]',
      summary,
      action_items ? JSON.stringify(action_items) : '[]',
      source_email_id ?? null,
      now
    );

    const meeting = db.prepare('SELECT * FROM meeting_notes WHERE id = ?').get(meetingId);
    return Response.json({ meeting }, { status: 201 });
  } catch (err) {
    console.error('POST /api/contacts/[id]/meetings error:', err);
    return Response.json({ error: 'Failed to create meeting note' }, { status: 500 });
  }
}
