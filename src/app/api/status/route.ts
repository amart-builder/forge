import getDb from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const db = getDb();
    const state = db.prepare('SELECT * FROM app_state').all();
    return Response.json({ state });
  } catch (err) {
    console.error('GET /api/status error:', err);
    return Response.json({ error: 'Failed to fetch status' }, { status: 500 });
  }
}
