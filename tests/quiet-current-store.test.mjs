import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  createWorkSuggestion,
  getQuietCurrentSnapshot,
  pruneSuggestions,
  recordDecisionEvent,
  reopenWorkSuggestion,
  resolveWorkSuggestion,
  setQuietCurrentStorePathForTests,
} from '../src/lib/quiet-current/store.ts';

function isolatedStore(t) {
  const file = path.join(
    os.tmpdir(),
    `forge-quiet-current-${process.pid}-${Date.now()}-${Math.random()}.json`,
  );
  setQuietCurrentStorePathForTests(file);
  t.after(() => {
    setQuietCurrentStorePathForTests(undefined);
    rmSync(file, { force: true });
    rmSync(`${file}.token`, { force: true });
  });
  return file;
}

test('refining a proposal keeps it in pencil', (t) => {
  isolatedStore(t);
  const suggestion = createWorkSuggestion({
    title: 'Prepare the launch note',
    reason: 'A launch meeting is on the calendar.',
    source: 'calendar',
  });

  const refined = resolveWorkSuggestion(suggestion.id, {
    state: 'refined',
    title: 'Write the launch note for clients',
    source: 'human_refinement',
  });

  assert.equal(refined.state, 'refined');
  assert.equal(refined.title, 'Write the launch note for clients');
  assert.equal(refined.resolvedTaskId, undefined);
  assert.equal(
    getQuietCurrentSnapshot().decisionEvents.at(-1)?.eventType,
    'suggestion_refine',
  );
});

test('accepting a proposal records the resolved task and closes it once', (t) => {
  isolatedStore(t);
  const suggestion = createWorkSuggestion({
    title: 'Call Sam',
    reason: 'Sam asked for a follow-up.',
    source: 'email',
  });

  const accepted = resolveWorkSuggestion(suggestion.id, {
    state: 'accepted',
    resolvedTaskId: 'task-123',
    source: 'explicit_accept',
  });

  assert.equal(accepted.state, 'accepted');
  assert.equal(accepted.resolvedTaskId, 'task-123');
  assert.equal(
    getQuietCurrentSnapshot().decisionEvents.at(-1)?.eventType,
    'suggestion_accept',
  );
  assert.throws(
    () => resolveWorkSuggestion(suggestion.id, { state: 'deferred' }),
    /already accepted/,
  );

  const reopened = reopenWorkSuggestion(suggestion.id);
  assert.equal(reopened.state, 'proposed');
  assert.equal(reopened.resolvedTaskId, undefined);
  assert.equal(
    getQuietCurrentSnapshot().decisionEvents.at(-1)?.eventType,
    'suggestion_undo',
  );
  assert.throws(() => reopenWorkSuggestion('missing-suggestion'), /not found/);
});

test('expired pencil retires without changing accepted work', async (t) => {
  isolatedStore(t);
  const suggestion = createWorkSuggestion({
    title: 'Possibly review an old thread',
    reason: 'The thread was recently active.',
    source: 'email',
    expiresAt: new Date(Date.now() + 30).toISOString(),
  });

  await new Promise((resolve) => setTimeout(resolve, 45));
  const snapshot = getQuietCurrentSnapshot();
  assert.equal(
    snapshot.suggestions.find((item) => item.id === suggestion.id)?.state,
    'expired',
  );
  assert.equal(snapshot.decisionEvents.at(-1)?.eventType, 'suggestion_decay');
  assert.throws(() => reopenWorkSuggestion(suggestion.id), /cannot be reopened from expired/);
});

test('returned work cannot exist without its accepted target', (t) => {
  isolatedStore(t);
  assert.throws(
    () =>
      createWorkSuggestion({
        kind: 'returned_work',
        title: 'Draft ready',
        reason: 'The delegated work finished.',
        source: 'Jarvis handoff',
      }),
    /requires an existing target task/,
  );
});

test('pruning removes terminal history before active pencil', () => {
  const base = {
    kind: 'create_task',
    description: '',
    reason: 'reason',
    source: 'source',
    priority: 'medium',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    expiresAt: '2026-01-04T00:00:00.000Z',
  };
  const suggestions = [
    { ...base, id: 'active-old', title: 'Active old', state: 'proposed' },
    { ...base, id: 'terminal-old', title: 'Terminal old', state: 'accepted' },
    { ...base, id: 'active-new', title: 'Active new', state: 'refined' },
  ];
  const pruned = pruneSuggestions(suggestions, 2);
  assert.deepEqual(
    pruned.map((suggestion) => suggestion.id),
    ['active-old', 'active-new'],
  );
});

test('decision events remain inspectable and ordered', (t) => {
  isolatedStore(t);
  recordDecisionEvent({
    eventType: 'focus_change',
    entityId: 'task-a',
    before: { focusedTaskId: null },
    after: { focusedTaskId: 'task-a' },
    source: 'keyboard',
  });
  recordDecisionEvent({
    eventType: 'task_handoff',
    entityId: 'task-a',
    source: 'human',
  });

  const snapshot = getQuietCurrentSnapshot();
  assert.deepEqual(
    snapshot.decisionEvents.map((event) => event.eventType),
    ['focus_change', 'task_handoff'],
  );
});
