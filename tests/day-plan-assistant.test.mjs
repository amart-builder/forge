import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildDayPlanCandidates } from '../src/lib/day-plan/candidates.ts';
import {
  DayPlanInvalidTransition,
  createDayPlanStore,
} from '../src/lib/day-plan/store.ts';

function setup(t) {
  const file = path.join(os.tmpdir(), `forge-assistant-${process.pid}-${Date.now()}-${Math.random()}.db`);
  const store = createDayPlanStore({
    dbPath: file,
    now: () => new Date('2026-07-10T16:00:00.000Z'),
    executionEnvironment: { autonomousEnabled: false, workspaces: new Map() },
  });
  t.after(() => {
    store.close();
    rmSync(file, { force: true });
    rmSync(`${file}-wal`, { force: true });
    rmSync(`${file}-shm`, { force: true });
  });
  let plan = store.ensureDayPlan({
    localDate: '2026-07-10',
    timezone: 'America/Los_Angeles',
    mutationId: 'ensure:assistant',
    candidates: buildDayPlanCandidates({
      localDate: '2026-07-10',
      timezone: 'America/Los_Angeles',
      tasks: ['a', 'b'].map((id, position) => ({
        id: `task-${id}`,
        title: `Task ${id}`,
        description: `Original outcome ${id}`,
        priority: position === 0 ? 'high' : 'medium',
        dueAt: position === 0 ? '2026-07-10T20:00:00.000Z' : undefined,
        position,
        column: 'today',
        status: 'open',
        updatedAt: '2026-07-10T15:00:00.000Z',
        refreshedAt: '2026-07-10T16:00:00.000Z',
      })),
    }),
  }).plan;
  plan = store.mutateDayPlan({
    planId: plan.id,
    expectedVersion: plan.version,
    mutationId: 'arrival-open:assistant',
    action: 'arrival_open',
  }).plan;
  return { store, plan };
}

test('assistant turn applies one bounded atomic plan patch and preserves evidence', (t) => {
  const { store, plan } = setup(t);
  const first = plan.items[0];
  const originalEvidence = structuredClone(first.sourceRefs);
  const originalDueAt = first.dueAt;
  const created = store.createAssistantTurn({
    id: 'assistant-turn-1',
    planId: plan.id,
    expectedVersion: plan.version,
    userText: 'Make the first task clearer, assign it to Claude, and put the second first.',
  });
  assert.equal(created.turn.state, 'queued');
  assert.equal(store.createAssistantTurn({
    id: 'assistant-turn-1',
    planId: plan.id,
    expectedVersion: plan.version,
    userText: created.turn.userText,
  }).replayed, true);
  assert.equal(store.claimNextAssistantTurn().id, created.turn.id);

  const completed = store.completeAssistantTurn(created.turn.id, {
    assistantText: 'I clarified the outcome and moved Task b first.',
    needsClarification: false,
    operations: [
      {
        operation: 'edit_item',
        itemId: first.id,
        title: 'Ship the client-ready proposal',
        outcome: 'A final proposal is ready to send.',
        definitionOfDone: 'PDF reviewed and ready for delivery.',
      },
      { operation: 'set_owner', itemId: first.id, owner: 'claude' },
      { operation: 'reorder', orderedItemIds: [plan.items[1].id, first.id] },
    ],
  });

  assert.equal(completed.turn.state, 'applied');
  assert.equal(completed.plan.version, plan.version + 1);
  assert.equal(completed.plan.items[0].taskId, 'task-b');
  const changed = completed.plan.items.find((item) => item.id === first.id);
  assert.equal(changed.title, 'Ship the client-ready proposal');
  assert.equal(changed.owner, 'claude');
  assert.deepEqual(changed.sourceRefs, originalEvidence);
  assert.equal(changed.dueAt, originalDueAt);
  assert.equal(
    store.listEvents(plan.id).filter((event) => event.eventType === 'assistant_patch').length,
    1,
  );
});

test('assistant clarification does not mutate the plan', (t) => {
  const { store, plan } = setup(t);
  const turn = store.createAssistantTurn({
    id: 'assistant-turn-question',
    planId: plan.id,
    expectedVersion: plan.version,
    userText: 'Make this better.',
  }).turn;
  store.claimNextAssistantTurn();
  const completed = store.completeAssistantTurn(turn.id, {
    assistantText: 'Which outcome matters most?',
    needsClarification: true,
    operations: [],
  });
  assert.equal(completed.turn.state, 'proposed');
  assert.equal(store.getPlan(plan.id).version, plan.version);
});

test('assistant can create, complete, update, and reprioritize task-backed work atomically', (t) => {
  const { store, plan } = setup(t);
  const completedItem = plan.items[0];
  const retainedItem = plan.items[1];
  const turn = store.createAssistantTurn({
    id: 'assistant-turn-replan',
    planId: plan.id,
    expectedVersion: plan.version,
    userText: 'Finish the old prep, add Supernova and client scheduling, then move the retained work third.',
  }).turn;
  store.claimNextAssistantTurn();

  const result = store.completeAssistantTurn(turn.id, {
    assistantText: 'I completed the prep and rebuilt the priority order.',
    needsClarification: false,
    operations: [
      { operation: 'complete_item', itemId: completedItem.id },
      {
        operation: 'create_item',
        clientId: 'supernova',
        title: 'Finish the Supernova content generator',
        outcome: 'Finish the Twitter, LinkedIn, and newsletter generators; make the newsletter ready for client use.',
        definitionOfDone: 'All three generators work and the newsletter flow is client-ready.',
        project: 'supernova',
        priority: 'high',
        position: 0,
      },
      {
        operation: 'create_item',
        clientId: 'client-days',
        title: 'Standardize client call days',
        outcome: 'Decide whether Tuesday and Wednesday should be client days and create suitable Calendly links.',
        position: 1,
      },
      { operation: 'edit_item', itemId: retainedItem.id, position: 2 },
    ],
  });

  assert.equal(result.turn.state, 'applied');
  assert.deepEqual(
    result.plan.items.filter((item) => item.decision !== 'completed').map((item) => item.title),
    ['Finish the Supernova content generator', 'Standardize client call days', 'Task b'],
  );
  assert.equal(result.plan.items.find((item) => item.id === completedItem.id).decision, 'completed');
  const mutations = store.listPendingTaskMutations();
  assert.deepEqual(mutations.map((mutation) => mutation.action), ['create', 'create', 'complete']);
  const supernova = mutations.find((mutation) => mutation.title === 'Finish the Supernova content generator');
  assert.match(supernova.description, /Twitter, LinkedIn, and newsletter/);
  assert.equal(store.acknowledgeTaskMutation(supernova.id).mutation.state, 'applied');
  assert.equal(store.listPendingTaskMutations().length, 2);
});

test('assistant conflict and unsupported edits never partially mutate the plan', (t) => {
  const { store, plan } = setup(t);
  const conflict = store.createAssistantTurn({
    id: 'assistant-turn-conflict',
    planId: plan.id,
    expectedVersion: plan.version,
    userText: 'Reorder the work.',
  }).turn;
  store.claimNextAssistantTurn();
  const changed = store.mutateDayPlan({
    planId: plan.id,
    expectedVersion: plan.version,
    mutationId: 'human-owner-change',
    action: 'item_owner',
    itemId: plan.items[0].id,
    owner: 'together',
  }).plan;
  const conflicted = store.completeAssistantTurn(conflict.id, {
    assistantText: 'Done.',
    needsClarification: false,
    operations: [{ operation: 'set_owner', itemId: plan.items[1].id, owner: 'claude' }],
  });
  assert.equal(conflicted.turn.state, 'conflict');
  assert.equal(store.getPlan(plan.id).version, changed.version);

  const invalid = store.createAssistantTurn({
    id: 'assistant-turn-invalid',
    planId: plan.id,
    expectedVersion: changed.version,
    userText: 'Change the order.',
  }).turn;
  store.claimNextAssistantTurn();
  assert.throws(
    () => store.completeAssistantTurn(invalid.id, {
      assistantText: 'Done.',
      needsClarification: false,
      operations: [{ operation: 'reorder', orderedItemIds: [plan.items[0].id] }],
    }),
    (error) => error instanceof DayPlanInvalidTransition,
  );
  assert.equal(store.getPlan(plan.id).version, changed.version);
});
