import getDb from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { csv } = body;

    if (!csv || typeof csv !== 'string') {
      return Response.json({ error: 'csv string is required' }, { status: 400 });
    }

    const lines = csv.split('\n').map((l: string) => l.trim()).filter((l: string) => l.length > 0);
    if (lines.length < 2) {
      return Response.json({ error: 'CSV must have a header row and at least one data row' }, { status: 400 });
    }

    const header = lines[0].split(',').map((h: string) => h.trim().toLowerCase());
    const expectedFields = ['name', 'email', 'phone', 'company', 'role', 'location'];

    const fieldIndex: Record<string, number> = {};
    for (const field of expectedFields) {
      const idx = header.indexOf(field);
      if (idx !== -1) fieldIndex[field] = idx;
    }

    if (!('name' in fieldIndex)) {
      return Response.json({ error: 'CSV must include a "name" column' }, { status: 400 });
    }

    const db = getDb();
    const insert = db.prepare(
      `INSERT INTO contacts (id, name, email, phone, company, role, location, tier, tags, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'C', '[]', '', ?, ?)`
    );

    const now = new Date().toISOString();
    let imported = 0;

    const tx = db.transaction(() => {
      for (let i = 1; i < lines.length; i++) {
        const cols = parseCsvLine(lines[i]);
        const name = cols[fieldIndex['name']]?.trim();
        if (!name) continue;

        const id = crypto.randomUUID();
        insert.run(
          id,
          name,
          fieldIndex['email'] !== undefined ? cols[fieldIndex['email']]?.trim() || null : null,
          fieldIndex['phone'] !== undefined ? cols[fieldIndex['phone']]?.trim() || null : null,
          fieldIndex['company'] !== undefined ? cols[fieldIndex['company']]?.trim() || null : null,
          fieldIndex['role'] !== undefined ? cols[fieldIndex['role']]?.trim() || null : null,
          fieldIndex['location'] !== undefined ? cols[fieldIndex['location']]?.trim() || null : null,
          now,
          now
        );
        imported++;
      }
    });

    tx();

    return Response.json({ success: true, imported });
  } catch (err) {
    console.error('POST /api/contacts/import error:', err);
    return Response.json({ error: 'Failed to import contacts' }, { status: 500 });
  }
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}
