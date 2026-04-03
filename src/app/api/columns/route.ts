import getDb from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const db = getDb();
    const columns = db
      .prepare('SELECT * FROM columns ORDER BY position ASC')
      .all();

    return Response.json({ columns });
  } catch (err) {
    console.error('GET /api/columns error:', err);
    return Response.json(
      { error: 'Failed to fetch columns' },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { name } = body;

    if (!name) {
      return Response.json({ error: 'name is required' }, { status: 400 });
    }

    const db = getDb();

    const maxPos = db
      .prepare('SELECT COALESCE(MAX(position), -1) as max_pos FROM columns')
      .get() as { max_pos: number };

    const id = crypto.randomUUID();
    const position = maxPos.max_pos + 1;

    db.prepare(
      'INSERT INTO columns (id, name, position) VALUES (?, ?, ?)'
    ).run(id, name, position);

    const column = db.prepare('SELECT * FROM columns WHERE id = ?').get(id);
    return Response.json(column, { status: 201 });
  } catch (err) {
    console.error('POST /api/columns error:', err);
    return Response.json(
      { error: 'Failed to create column' },
      { status: 500 }
    );
  }
}
