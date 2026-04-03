import getDb from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function PATCH(
  req: Request,
  ctx: RouteContext<'/api/tasks/[id]'>
) {
  try {
    const { id } = await ctx.params;
    const db = getDb();

    const existing = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
    if (!existing) {
      return Response.json({ error: 'Task not found' }, { status: 404 });
    }

    const body = await req.json();
    const allowed = [
      'title',
      'description',
      'priority',
      'due_date',
      'tags',
      'column_id',
      'position',
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
      return Response.json(
        { error: 'No valid fields to update' },
        { status: 400 }
      );
    }

    updates.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(id);

    db.prepare(
      `UPDATE tasks SET ${updates.join(', ')} WHERE id = ?`
    ).run(...values);

    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
    return Response.json(task);
  } catch (err) {
    console.error('PATCH /api/tasks/[id] error:', err);
    return Response.json({ error: 'Failed to update task' }, { status: 500 });
  }
}

export async function DELETE(
  _req: Request,
  ctx: RouteContext<'/api/tasks/[id]'>
) {
  try {
    const { id } = await ctx.params;
    const db = getDb();

    const existing = db.prepare('SELECT id FROM tasks WHERE id = ?').get(id);
    if (!existing) {
      return Response.json({ error: 'Task not found' }, { status: 404 });
    }

    db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
    return Response.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/tasks/[id] error:', err);
    return Response.json({ error: 'Failed to delete task' }, { status: 500 });
  }
}
