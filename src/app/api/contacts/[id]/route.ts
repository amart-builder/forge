import getDb from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  ctx: RouteContext<'/api/contacts/[id]'>
) {
  try {
    const { id } = await ctx.params;
    const db = getDb();

    const contact = db.prepare('SELECT * FROM contacts WHERE id = ?').get(id);
    if (!contact) {
      return Response.json({ error: 'Contact not found' }, { status: 404 });
    }

    return Response.json({ contact });
  } catch (err) {
    console.error('GET /api/contacts/[id] error:', err);
    return Response.json({ error: 'Failed to fetch contact' }, { status: 500 });
  }
}

export async function PATCH(
  req: Request,
  ctx: RouteContext<'/api/contacts/[id]'>
) {
  try {
    const { id } = await ctx.params;
    const db = getDb();

    const existing = db.prepare('SELECT * FROM contacts WHERE id = ?').get(id);
    if (!existing) {
      return Response.json({ error: 'Contact not found' }, { status: 404 });
    }

    const body = await req.json();
    const allowed = [
      'name', 'email', 'phone', 'company', 'role', 'linkedin',
      'location', 'tier', 'tags', 'how_we_met', 'notes', 'last_contact_date',
    ];

    const updates: string[] = [];
    const values: unknown[] = [];

    for (const key of allowed) {
      if (key in body) {
        const val = key === 'tags' ? JSON.stringify(body[key]) : body[key];
        updates.push(`${key} = ?`);
        values.push(val);
      }
    }

    if (updates.length === 0) {
      return Response.json({ error: 'No valid fields to update' }, { status: 400 });
    }

    updates.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(id);

    db.prepare(
      `UPDATE contacts SET ${updates.join(', ')} WHERE id = ?`
    ).run(...values);

    const contact = db.prepare('SELECT * FROM contacts WHERE id = ?').get(id);
    return Response.json({ contact });
  } catch (err) {
    console.error('PATCH /api/contacts/[id] error:', err);
    return Response.json({ error: 'Failed to update contact' }, { status: 500 });
  }
}

export async function DELETE(
  _req: Request,
  ctx: RouteContext<'/api/contacts/[id]'>
) {
  try {
    const { id } = await ctx.params;
    const db = getDb();

    const existing = db.prepare('SELECT id FROM contacts WHERE id = ?').get(id);
    if (!existing) {
      return Response.json({ error: 'Contact not found' }, { status: 404 });
    }

    db.prepare('DELETE FROM contact_activities WHERE contact_id = ?').run(id);
    db.prepare('DELETE FROM meeting_notes WHERE contact_id = ?').run(id);
    db.prepare('DELETE FROM contacts WHERE id = ?').run(id);

    return Response.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/contacts/[id] error:', err);
    return Response.json({ error: 'Failed to delete contact' }, { status: 500 });
  }
}
