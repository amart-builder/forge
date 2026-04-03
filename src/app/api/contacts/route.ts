import getDb from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const db = getDb();
    const url = new URL(req.url);

    const search = url.searchParams.get('search');
    const tier = url.searchParams.get('tier');
    const tag = url.searchParams.get('tag');
    const sort = url.searchParams.get('sort') || 'name';
    const order = url.searchParams.get('order') || 'asc';

    const allowedSort = ['name', 'last_contact_date', 'company'];
    const sortCol = allowedSort.includes(sort) ? sort : 'name';
    const sortDir = order === 'desc' ? 'DESC' : 'ASC';

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (search) {
      conditions.push('(name LIKE ? OR email LIKE ? OR company LIKE ?)');
      const q = `%${search}%`;
      params.push(q, q, q);
    }

    if (tier) {
      conditions.push('tier = ?');
      params.push(tier);
    }

    if (tag) {
      conditions.push("tags LIKE ?");
      params.push(`%"${tag}"%`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const contacts = db
      .prepare(`SELECT * FROM contacts ${where} ORDER BY ${sortCol} ${sortDir}`)
      .all(...params);

    return Response.json({ contacts });
  } catch (err) {
    console.error('GET /api/contacts error:', err);
    return Response.json({ error: 'Failed to fetch contacts' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { name, email, phone, company, role, linkedin, location, tier, tags, how_we_met, notes } = body;

    if (!name) {
      return Response.json({ error: 'name is required' }, { status: 400 });
    }

    const db = getDb();
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    db.prepare(
      `INSERT INTO contacts (id, name, email, phone, company, role, linkedin, location, tier, tags, how_we_met, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      name,
      email ?? null,
      phone ?? null,
      company ?? null,
      role ?? null,
      linkedin ?? null,
      location ?? null,
      tier ?? 'C',
      tags ? JSON.stringify(tags) : '[]',
      how_we_met ?? null,
      notes ?? '',
      now,
      now
    );

    const contact = db.prepare('SELECT * FROM contacts WHERE id = ?').get(id);
    return Response.json({ contact }, { status: 201 });
  } catch (err) {
    console.error('POST /api/contacts error:', err);
    return Response.json({ error: 'Failed to create contact' }, { status: 500 });
  }
}
