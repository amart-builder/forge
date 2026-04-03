import { type NextRequest } from 'next/server';
import getDb from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const db = getDb();
    const status = request.nextUrl.searchParams.get('status');
    const priority = request.nextUrl.searchParams.get('priority');

    let query = 'SELECT * FROM email_items WHERE 1=1';
    const params: (string | number)[] = [];

    if (status) {
      query += ' AND status = ?';
      params.push(status);
    }

    if (priority) {
      query += ' AND priority = ?';
      params.push(Number(priority));
    }

    query += ' ORDER BY priority ASC, created_at DESC';

    const emails = db.prepare(query).all(...params);
    return Response.json({ emails });
  } catch (err) {
    console.error('GET /api/emails error:', err);
    return Response.json({ error: 'Failed to fetch emails' }, { status: 500 });
  }
}
