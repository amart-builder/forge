import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ARRIVAL_CACHE_KEY,
  ARRIVAL_CACHE_MAX_AGE_MS,
  canApplyArrivalRefresh,
  parseArrivalSnapshot,
  readArrivalSnapshot,
  upsertArrivalTask,
  writeArrivalSnapshot,
} from '../src/lib/quiet-current/arrival-cache.ts';

const columns = [
  { _id: 'today', name: 'Must happen today', position: 1, createdAt: 0 },
  { _id: 'done', name: 'Done', position: 3, createdAt: 0 },
];

const tasks = [
  {
    _id: 'task-1',
    columnId: 'today',
    title: 'Prepare the proposal',
    description: '',
    priority: 'high',
    tags: [],
    status: 'open',
    blocked: false,
    position: 0,
    createdAt: 1,
    updatedAt: 2,
  },
];

test('arrival cache round-trips a credible current', () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };

  assert.equal(
    writeArrivalSnapshot(storage, columns, tasks, new Date('2026-07-10T16:00:00.000Z')),
    true,
  );
  const snapshot = readArrivalSnapshot(storage, new Date('2026-07-10T16:00:01.000Z'));
  assert.equal(snapshot?.savedAt, '2026-07-10T16:00:00.000Z');
  assert.deepEqual(snapshot?.columns, columns);
  assert.deepEqual(snapshot?.tasks, tasks);
  assert.ok(values.has(ARRIVAL_CACHE_KEY));
});

test('arrival cache rejects malformed or incomplete snapshots', () => {
  assert.equal(parseArrivalSnapshot('{not-json'), undefined);
  assert.equal(
    parseArrivalSnapshot(
      JSON.stringify({ version: 1, savedAt: 'not-a-date', columns, tasks }),
    ),
    undefined,
  );
  assert.equal(
    parseArrivalSnapshot(
      JSON.stringify({ version: 1, savedAt: new Date().toISOString(), columns, tasks: [{}] }),
    ),
    undefined,
  );
});

test('cache storage failure stays non-authoritative', () => {
  const storage = {
    setItem: () => {
      throw new Error('quota exceeded');
    },
  };
  assert.equal(writeArrivalSnapshot(storage, columns, tasks), false);
});

test('arrival cache rejects stale and implausibly future snapshots', () => {
  const savedAt = new Date('2026-07-10T16:00:00.000Z');
  const raw = JSON.stringify({
    version: 1,
    savedAt: savedAt.toISOString(),
    columns,
    tasks,
  });
  assert.ok(
    parseArrivalSnapshot(raw, new Date(savedAt.getTime() + ARRIVAL_CACHE_MAX_AGE_MS)),
  );
  assert.equal(
    parseArrivalSnapshot(raw, new Date(savedAt.getTime() + ARRIVAL_CACHE_MAX_AGE_MS + 1)),
    undefined,
  );
  assert.equal(
    parseArrivalSnapshot(raw, new Date(savedAt.getTime() - 60 * 60 * 1000)),
    undefined,
  );
});

test('refresh waits for mutations and task insertion stays idempotent', () => {
  assert.equal(
    canApplyArrivalRefresh({
      requestRevision: 2,
      currentRevision: 2,
      inFlightMutations: 0,
    }),
    true,
  );
  assert.equal(
    canApplyArrivalRefresh({
      requestRevision: 1,
      currentRevision: 2,
      inFlightMutations: 0,
    }),
    false,
  );
  assert.equal(
    canApplyArrivalRefresh({
      requestRevision: 2,
      currentRevision: 2,
      inFlightMutations: 1,
    }),
    false,
  );

  const updated = { ...tasks[0], title: 'Prepare the final proposal' };
  assert.deepEqual(upsertArrivalTask(tasks, updated), [updated]);
});
