import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import { createBuddyStore, getBuddyStore } from '../src/lib/buddy/store.ts';

function setup(t) {
  const file = path.join(os.tmpdir(), `forge-buddy-${process.pid}-${Date.now()}-${Math.random()}.db`);
  let now = new Date('2026-07-15T20:00:00.000Z');
  const store = createBuddyStore({ dbPath: file, now: () => now });
  t.after(() => {
    store.close();
    for (const suffix of ['', '-wal', '-shm']) rmSync(`${file}${suffix}`, { force: true });
  });
  return { store, advance: (milliseconds) => { now = new Date(now.getTime() + milliseconds); } };
}

test('Buddy store enforces one running turn and records completion totals', (t) => {
  const { store } = setup(t);
  const turn = store.claimTurn({
    userText: 'Hello', pageContext: { view: 'tasks' }, model: 'sonnet', effort: 'medium',
    routerReason: 'General conversation',
  });
  assert.ok(turn);
  assert.equal(store.claimTurn({
    userText: 'Second', pageContext: null, model: 'sonnet', effort: 'low',
    routerReason: 'Short action',
  }), null);
  assert.equal(store.resetBuddySession(), null);
  const finished = store.completeTurn(turn.id, {
    state: 'succeeded', assistant_text: 'Hi', session_id: 'session-1', cost_usd: 0.25,
  });
  assert.equal(finished.state, 'succeeded');
  assert.deepEqual(store.getBuddyState(), {
    headSessionId: 'session-1', createdAt: '2026-07-15T20:00:00.000Z',
    turnCount: 1, totalCostUsd: 0.25,
  });
});

test('a swept turn cannot advance the session head when its late result arrives', (t) => {
  const { store, advance } = setup(t);
  store.setHeadSession('existing-head');
  const turn = store.claimTurn({
    userText: 'Slow turn', pageContext: null, model: 'sonnet', effort: 'medium',
    routerReason: 'General conversation',
  });
  advance(7 * 60_000);
  assert.equal(store.sweepStaleTurns(6 * 60_000), 1);
  const late = store.completeTurn(turn.id, {
    state: 'succeeded', assistant_text: 'Late answer', session_id: 'late-session', cost_usd: 0.1,
  });
  assert.equal(late.state, 'failed');
  assert.equal(store.getBuddyState().headSessionId, 'existing-head');
  assert.equal(store.getBuddyState().totalCostUsd, 0);
});

test('reset marks a boundary without deleting history and stale turns are interrupted', (t) => {
  const { store, advance } = setup(t);
  store.setHeadSession('old-session');
  const completed = store.claimTurn({
    userText: 'Finished', pageContext: null, model: 'sonnet', effort: 'medium',
    routerReason: 'General conversation',
  });
  store.completeTurn(completed.id, {
    state: 'succeeded', assistant_text: 'Done', session_id: 'old-session', cost_usd: 0.3,
  });
  const turn = store.claimTurn({
    userText: 'Waiting', pageContext: null, model: 'opus', effort: 'high',
    routerReason: 'Planning request',
  });
  advance(7 * 60_000);
  assert.equal(store.sweepStaleTurns(6 * 60_000), 1);
  assert.equal(store.getTurn(turn.id).error_code, 'interrupted');
  const reset = store.resetBuddySession();
  assert.equal(reset.headSessionId, null);
  assert.equal(reset.createdAt, '2026-07-15T20:07:00.000Z');
  assert.equal(reset.turnCount, 0);
  assert.equal(reset.totalCostUsd, 0);
  assert.equal(store.listRecentTurns().length, 2);
});

test('pending delete tokens are exact, expiring, and single-use', (t) => {
  const { store, advance } = setup(t);
  const first = store.mintPendingDelete({ table: 'contacts', rowId: 'c1', label: 'Jane' });
  assert.deepEqual(store.consumePendingDelete({ token: first.token, table: 'contacts', rowId: 'wrong' }), {
    ok: false, error: 'mismatch',
  });
  assert.equal(store.consumePendingDelete({ token: first.token, table: 'contacts', rowId: 'c1' }).ok, true);
  assert.deepEqual(store.consumePendingDelete({ token: first.token, table: 'contacts', rowId: 'c1' }), {
    ok: false, error: 'consumed',
  });
  const second = store.mintPendingDelete({ table: 'tasks', rowId: 't1', label: 'Old task' });
  advance(10 * 60_000 + 1);
  assert.deepEqual(store.consumePendingDelete({ token: second.token, table: 'tasks', rowId: 't1' }), {
    ok: false, error: 'expired',
  });
});

test('Buddy store migrates legacy tables that are missing current columns', (t) => {
  const file = path.join(os.tmpdir(), `forge-buddy-legacy-${process.pid}-${Date.now()}-${Math.random()}.db`);
  const legacy = new Database(file);
  legacy.exec(`
    CREATE TABLE buddy_state (id INTEGER PRIMARY KEY, created_at TEXT NOT NULL);
    INSERT INTO buddy_state (id, created_at) VALUES (1, '2026-07-01T00:00:00.000Z');
    CREATE TABLE buddy_turns (
      id TEXT PRIMARY KEY,
      user_text TEXT NOT NULL,
      state TEXT NOT NULL,
      assistant_text TEXT NOT NULL DEFAULT '',
      started_at TEXT NOT NULL,
      finished_at TEXT
    );
  `);
  legacy.close();

  const store = createBuddyStore({ dbPath: file });
  const turn = store.claimTurn({
    userText: 'Migrated', pageContext: { view: 'tasks' }, model: 'sonnet', effort: 'low',
    routerReason: 'Migration test',
  });
  assert.ok(turn);
  assert.equal(turn.page_context, '{"view":"tasks"}');
  store.finishTurn(turn.id, { state: 'succeeded', assistant_text: 'Done', receipts_json: '{"changes":[]}' });
  store.close();

  const migrated = new Database(file, { readonly: true });
  const stateColumns = new Set(migrated.prepare('PRAGMA table_info(buddy_state)').all().map((row) => row.name));
  const turnColumns = new Set(migrated.prepare('PRAGMA table_info(buddy_turns)').all().map((row) => row.name));
  migrated.close();
  for (const column of ['head_session_id', 'created_at', 'turn_count', 'total_cost_usd']) {
    assert.ok(stateColumns.has(column), `missing buddy_state.${column}`);
  }
  for (const column of [
    'page_context', 'model', 'effort', 'router_reason', 'receipts_json', 'session_id', 'cost_usd', 'error_code',
  ]) {
    assert.ok(turnColumns.has(column), `missing buddy_turns.${column}`);
  }
  t.after(() => {
    for (const suffix of ['', '-wal', '-shm']) rmSync(`${file}${suffix}`, { force: true });
  });
});

test('getBuddyStore replaces an HMR-stale singleton whose API predates completeTurn', (t) => {
  const previousPath = process.env.FORGE_DB_PATH;
  const previousStore = globalThis.__forgeBuddyStore;
  const currentFile = path.join(os.tmpdir(), `forge-buddy-current-${process.pid}-${Date.now()}.db`);
  const staleFile = path.join(os.tmpdir(), `forge-buddy-stale-${process.pid}-${Date.now()}.db`);
  const staleStore = createBuddyStore({ dbPath: staleFile });
  delete staleStore.completeTurn;
  globalThis.__forgeBuddyStore = staleStore;
  delete globalThis.__forgeBuddyStoreVersion;
  process.env.FORGE_DB_PATH = currentFile;
  t.after(() => {
    const currentStore = globalThis.__forgeBuddyStore;
    if (currentStore && currentStore !== staleStore) currentStore.close();
    if (staleStore.getBuddyState) staleStore.close();
    if (previousStore) globalThis.__forgeBuddyStore = previousStore;
    else delete globalThis.__forgeBuddyStore;
    delete globalThis.__forgeBuddyStoreVersion;
    if (previousPath === undefined) delete process.env.FORGE_DB_PATH;
    else process.env.FORGE_DB_PATH = previousPath;
    for (const file of [currentFile, staleFile]) {
      for (const suffix of ['', '-wal', '-shm']) rmSync(`${file}${suffix}`, { force: true });
    }
  });

  const currentStore = getBuddyStore();
  assert.notEqual(currentStore, staleStore);
  assert.equal(typeof currentStore.completeTurn, 'function');
});
