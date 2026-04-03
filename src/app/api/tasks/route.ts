import getDb from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const db = getDb();
    const tasks = db
      .prepare(
        `SELECT t.*, c.name as column_name
         FROM tasks t
         LEFT JOIN columns c ON t.column_id = c.id
         ORDER BY t.position ASC`
      )
      .all();

    return Response.json({ tasks });
  } catch (err) {
    console.error('GET /api/tasks error:', err);
    return Response.json({ error: 'Failed to fetch tasks' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { title, column_id, priority, description, due_date, tags } = body;

    if (!title || !column_id) {
      return Response.json(
        { error: 'title and column_id are required' },
        { status: 400 }
      );
    }

    const db = getDb();

    // Verify column exists
    const col = db
      .prepare('SELECT id FROM columns WHERE id = ?')
      .get(column_id);
    if (!col) {
      return Response.json({ error: 'Column not found' }, { status: 404 });
    }

    // Auto-set position to max + 1 in the column
    const maxPos = db
      .prepare(
        'SELECT COALESCE(MAX(position), -1) as max_pos FROM tasks WHERE column_id = ?'
      )
      .get(column_id) as { max_pos: number };

    const id = crypto.randomUUID();
    const position = maxPos.max_pos + 1;
    const now = new Date().toISOString();

    db.prepare(
      `INSERT INTO tasks (id, column_id, title, description, priority, due_date, tags, position, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      column_id,
      title,
      description ?? '',
      priority ?? 'medium',
      due_date ?? null,
      tags ? JSON.stringify(tags) : '[]',
      position,
      now,
      now
    );

    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
    return Response.json(task, { status: 201 });
  } catch (err) {
    console.error('POST /api/tasks error:', err);
    return Response.json({ error: 'Failed to create task' }, { status: 500 });
  }
}
