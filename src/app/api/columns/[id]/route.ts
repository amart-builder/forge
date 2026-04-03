import getDb from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function PATCH(
  req: Request,
  ctx: RouteContext<'/api/columns/[id]'>
) {
  try {
    const { id } = await ctx.params;
    const db = getDb();

    const existing = db
      .prepare('SELECT * FROM columns WHERE id = ?')
      .get(id);
    if (!existing) {
      return Response.json({ error: 'Column not found' }, { status: 404 });
    }

    const body = await req.json();
    const updates: string[] = [];
    const values: unknown[] = [];

    if ('name' in body) {
      updates.push('name = ?');
      values.push(body.name);
    }
    if ('position' in body) {
      updates.push('position = ?');
      values.push(body.position);
    }

    if (updates.length === 0) {
      return Response.json(
        { error: 'No valid fields to update' },
        { status: 400 }
      );
    }

    values.push(id);
    db.prepare(
      `UPDATE columns SET ${updates.join(', ')} WHERE id = ?`
    ).run(...values);

    const column = db.prepare('SELECT * FROM columns WHERE id = ?').get(id);
    return Response.json(column);
  } catch (err) {
    console.error('PATCH /api/columns/[id] error:', err);
    return Response.json(
      { error: 'Failed to update column' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _req: Request,
  ctx: RouteContext<'/api/columns/[id]'>
) {
  try {
    const { id } = await ctx.params;
    const db = getDb();

    const existing = db
      .prepare('SELECT id FROM columns WHERE id = ?')
      .get(id);
    if (!existing) {
      return Response.json({ error: 'Column not found' }, { status: 404 });
    }

    // Delete all tasks in the column, then the column itself
    db.prepare('DELETE FROM tasks WHERE column_id = ?').run(id);
    db.prepare('DELETE FROM columns WHERE id = ?').run(id);

    return Response.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/columns/[id] error:', err);
    return Response.json(
      { error: 'Failed to delete column' },
      { status: 500 }
    );
  }
}
