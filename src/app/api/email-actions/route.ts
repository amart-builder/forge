import { type NextRequest } from 'next/server';
import getDb from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const db = getDb();
    const actionType = request.nextUrl.searchParams.get('action_type');

    let query = 'SELECT * FROM email_actions';
    const params: string[] = [];

    if (actionType) {
      query += ' WHERE action_type = ?';
      params.push(actionType);
    }

    query += ' ORDER BY created_at DESC';

    const actions = db.prepare(query).all(...params);
    return Response.json({ actions });
  } catch (err) {
    console.error('GET /api/email-actions error:', err);
    return Response.json({ error: 'Failed to fetch actions' }, { status: 500 });
  }
}
