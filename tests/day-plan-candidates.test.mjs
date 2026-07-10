import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDayPlanCandidates } from '../src/lib/day-plan/candidates.ts';

const base = {
  description: '',
  priority: 'medium',
  position: 0,
  column: 'today',
  status: 'open',
  updatedAt: '2026-07-10T15:00:00.000Z',
  refreshedAt: '2026-07-10T16:00:00.000Z',
};

function build(tasks) {
  return buildDayPlanCandidates({
    localDate: '2026-07-10',
    timezone: 'America/Los_Angeles',
    tasks,
  });
}

test('builds at most three deterministic accepted task candidates', () => {
  const tasks = [
    { ...base, id: 'task-low', title: 'Low', priority: 'low', position: 0 },
    { ...base, id: 'task-high', title: 'High', priority: 'high', position: 4 },
    { ...base, id: 'task-mid', title: 'Mid', position: 2 },
    { ...base, id: 'task-flight', title: 'Flight', column: 'in_flight', position: 1 },
  ];

  const first = build(tasks);
  const second = build([...tasks].reverse());
  assert.equal(first.length, 3);
  assert.deepEqual(first, second);
  assert.deepEqual(
    first.map((candidate) => candidate.taskId),
    ['task-high', 'task-flight', 'task-mid'],
  );
  assert.ok(first.every((candidate) => candidate.commitment === 'ink'));
  assert.ok(first.every((candidate) => candidate.owner === 'me'));
});
test('verified dates rank explicitly while prose never invents urgency', () => {
  const candidates = build([
    {
      ...base,
      id: 'waiting-prose',
      title: 'Maybe reply',
      description: 'A named person is definitely waiting urgently.',
      priority: 'high',
    },
    {
      ...base,
      id: 'due-task',
      title: 'File the form',
      priority: 'low',
      dueAt: '2026-07-10T18:00:00.000Z',
    },
  ]);

  assert.equal(candidates[0].taskId, 'due-task');
  assert.ok(candidates[0].sourceRefs[0].supports.includes('deadline'));
  const prose = candidates.find((candidate) => candidate.taskId === 'waiting-prose');
  assert.equal(prose.sourceRefs[0].supports.includes('waiting_person'), false);
  assert.equal(prose.rankReasons.some((reason) => reason.includes('urgent')), false);
});

test('suppresses stale, closed, malformed, and duplicated evidence', () => {
  const candidates = build([
    { ...base, id: 'stale', title: 'Stale', freshness: 'stale' },
    { ...base, id: 'done', title: 'Done', status: 'done' },
    { ...base, id: 'blank', title: '   ' },
    { ...base, id: 'one', title: 'One', outcomeKey: 'same-outcome' },
    { ...base, id: 'two', title: 'Two', outcomeKey: 'same-outcome', position: 1 },
  ]);

  assert.deepEqual(candidates.map((candidate) => candidate.taskId), ['one']);
});

test('returns an honest empty set when there is no credible work', () => {
  assert.deepEqual(build([]), []);
  assert.deepEqual(
    build([{ ...base, id: 'archived', title: 'Archived', status: 'archived' }]),
    [],
  );
});
