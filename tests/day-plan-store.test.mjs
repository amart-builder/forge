import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import { buildDayPlanCandidates } from '../src/lib/day-plan/candidates.ts';
import {
  arrivalAdditionOutcomeKey,
  matchesArrivalAddition,
} from '../src/lib/day-plan/arrival-addition.ts';
import {
  DayPlanInvalidTransition,
  DayPlanVersionConflict,
  createDayPlanStore,
} from '../src/lib/day-plan/store.ts';

function isolatedStore(t, initialClock = '2026-07-10T16:00:00.000Z') {
  const file = path.join(
    os.tmpdir(),
    `forge-day-plan-${process.pid}-${Date.now()}-${Math.random()}.db`,
  );
  let clock = new Date(initialClock);
  const store = createDayPlanStore({ dbPath: file, now: () => new Date(clock) });
  t.after(() => {
    store.close();
    rmSync(file, { force: true });
    rmSync(`${file}-wal`, { force: true });
    rmSync(`${file}-shm`, { force: true });
  });
  return {
    file,
    store,
    setClock: (value) => {
      clock = new Date(value);
    },
  };
}

function candidates(ids = ['task-a', 'task-b']) {
  return buildDayPlanCandidates({
    localDate: '2026-07-10',
    timezone: 'America/Los_Angeles',
    tasks: ids.map((id, position) => ({
      id,
      title: `Task ${id}`,
      description: `Finish ${id}`,
      priority: position === 0 ? 'high' : 'medium',
      position,
      column: 'today',
      status: 'open',
      updatedAt: '2026-07-10T15:00:00.000Z',
      refreshedAt: '2026-07-10T16:00:00.000Z',
    })),
  });
}

function ensure(store, mutationId = 'ensure:2026-07-10') {
  return store.ensureDayPlan({
    localDate: '2026-07-10',
    timezone: 'America/Los_Angeles',
    mutationId,
    candidates: candidates(),
  });
}

function mutate(store, plan, action, patch = {}) {
  return store.mutateDayPlan({
    planId: plan.id,
    mutationId: `${action}:${plan.version}:${Math.random()}`.replaceAll('.', '-'),
    expectedVersion: plan.version,
    action,
    ...patch,
  });
}

test('schema migration preserves existing SQLite data', (t) => {
  const file = path.join(os.tmpdir(), `forge-day-plan-legacy-${process.pid}-${Date.now()}.db`);
  const legacy = new Database(file);
  legacy.exec('CREATE TABLE tasks (id TEXT PRIMARY KEY, title TEXT NOT NULL)');
  legacy.prepare('INSERT INTO tasks (id, title) VALUES (?, ?)').run('legacy-task', 'Keep me');
  legacy.close();

  const store = createDayPlanStore({ dbPath: file });
  t.after(() => {
    store.close();
    rmSync(file, { force: true });
    rmSync(`${file}-wal`, { force: true });
    rmSync(`${file}-shm`, { force: true });
  });
  const verify = new Database(file, { readonly: true });
  assert.deepEqual(verify.prepare('SELECT * FROM tasks').get(), {
    id: 'legacy-task',
    title: 'Keep me',
  });
  verify.close();
});

test('ensure is idempotent and one open plan survives competing dates', (t) => {
  const { store } = isolatedStore(t);
  const created = ensure(store);
  const replay = ensure(store);
  assert.equal(replay.replayed, true);
  assert.equal(replay.plan.id, created.plan.id);
  assert.equal(replay.plan.version, 1);
  assert.equal(created.plan.items.every((item) => item.decision === 'preselected'), true);

  const otherDate = store.ensureDayPlan({
    localDate: '2026-07-11',
    timezone: 'America/Los_Angeles',
    mutationId: 'ensure:2026-07-11',
    candidates: [],
  });
  assert.equal(otherDate.plan.id, created.plan.id);
  assert.equal(store.getReadModel().currentPlan.id, created.plan.id);
  assert.equal(store.listEvents(created.plan.id).length, 2);
});

test('expected versions prevent stale overwrites and duplicate action IDs replay', (t) => {
  const { store } = isolatedStore(t);
  let plan = ensure(store).plan;
  plan = mutate(store, plan, 'arrival_open').plan;
  const input = {
    planId: plan.id,
    mutationId: `owner:${plan.id}`,
    expectedVersion: plan.version,
    action: 'item_owner',
    itemId: plan.items[0].id,
    owner: 'together',
  };
  const changed = store.mutateDayPlan(input);
  const replayed = store.mutateDayPlan(input);
  assert.equal(replayed.replayed, true);
  assert.equal(replayed.plan.version, changed.plan.version);
  assert.equal(store.listEvents(plan.id).filter((event) => event.id === input.mutationId).length, 1);

  assert.throws(
    () =>
      store.mutateDayPlan({
        ...input,
        mutationId: 'different-mutation',
        owner: 'me',
      }),
    (error) =>
      error instanceof DayPlanVersionConflict &&
      error.currentPlan.version === changed.plan.version,
  );
  assert.equal(store.getPlan(plan.id).items[0].owner, 'together');
});

test('item_add appends a preselected owned item and bumps the plan version', (t) => {
  const { store } = isolatedStore(t);
  let plan = ensure(store).plan;
  plan = mutate(store, plan, 'arrival_open').plan;
  const previousVersion = plan.version;
  const previousLength = plan.items.length;

  const changed = mutate(store, plan, 'item_add', {
    title: 'Prepare the client follow-up',
    outcome: 'A send-ready follow-up is drafted.',
    why: 'The client is waiting on the next step.',
    owner: 'together',
  }).plan;

  assert.equal(changed.version, previousVersion + 1);
  assert.equal(changed.items.length, previousLength + 1);
  const added = changed.items.at(-1);
  assert.equal(added.title, 'Prepare the client follow-up');
  assert.equal(added.outcome, 'A send-ready follow-up is drafted.');
  assert.equal(added.definitionOfDone, 'A send-ready follow-up is drafted.');
  assert.equal(added.whyToday, 'The client is waiting on the next step.');
  assert.equal(added.owner, 'together');
  assert.equal(added.position, previousLength);
  assert.equal(added.decision, 'preselected');
});

test('item_add rejects an eleventh plan item without bumping the version', (t) => {
  const { store } = isolatedStore(t);
  let plan = ensure(store).plan;
  plan = mutate(store, plan, 'arrival_open').plan;
  for (let index = plan.items.length; index < 10; index += 1) {
    plan = mutate(store, plan, 'item_add', {
      title: `Additional item ${index}`,
      outcome: `Outcome ${index}`,
      why: `Reason ${index}`,
      owner: 'me',
    }).plan;
  }
  const fullVersion = plan.version;

  assert.throws(
    () => mutate(store, plan, 'item_add', {
      title: 'Eleventh item',
      outcome: 'This should not be added.',
      why: 'The plan is already full.',
      owner: 'me',
    }),
    (error) =>
      error instanceof DayPlanInvalidTransition &&
      error.message === "Today's plan is full.",
  );
  const unchanged = store.getPlan(plan.id);
  assert.equal(unchanged.version, fullVersion);
  assert.equal(unchanged.items.length, 10);
});

test('an arrival addition remains exactly identifiable after the plan is reopened', (t) => {
  const { file, store } = isolatedStore(t);
  let plan = ensure(store).plan;
  plan = mutate(store, plan, 'arrival_open').plan;
  const addition = {
    title: 'Prepare the client follow-up',
    outcome: 'A send-ready follow-up is drafted.',
    why: 'The client is waiting on the next step.',
    suggestedOwner: 'together',
  };
  plan = mutate(store, plan, 'item_add', {
    ...addition,
    owner: addition.suggestedOwner,
  }).plan;

  const reopenedStore = createDayPlanStore({ dbPath: file });
  t.after(() => reopenedStore.close());
  const reopenedPlan = reopenedStore.getPlan(plan.id);
  const matchingItems = reopenedPlan.items.filter((item) =>
    matchesArrivalAddition(item, addition),
  );

  assert.equal(matchingItems.length, 1);
  assert.equal(matchingItems[0].outcomeKey, arrivalAdditionOutcomeKey(addition));
});

test('an unsupported mutation throws without bumping the plan version', (t) => {
  const { store } = isolatedStore(t);
  let plan = ensure(store).plan;
  plan = mutate(store, plan, 'arrival_open').plan;
  const previousVersion = plan.version;

  assert.throws(
    () => mutate(store, plan, 'unsupported_action'),
    (error) =>
      error instanceof DayPlanInvalidTransition &&
      error.message === 'Unsupported day-plan action: unsupported_action',
  );
  assert.equal(store.getPlan(plan.id).version, previousVersion);
});

test('Start My Day is strict, durable, and idempotent', (t) => {
  const { file, store } = isolatedStore(t);
  let plan = ensure(store).plan;
  assert.throws(
    () => mutate(store, plan, 'start_day'),
    (error) => error instanceof DayPlanInvalidTransition,
  );
  plan = mutate(store, plan, 'arrival_open').plan;
  const mutationId = `start-day:${plan.id}`;
  const started = store.mutateDayPlan({
    planId: plan.id,
    mutationId,
    expectedVersion: plan.version,
    action: 'start_day',
  });
  assert.equal(started.plan.state, 'active');
  assert.equal(started.plan.arrivalState, 'confirmed');
  assert.equal(started.plan.recommendedFirstTaskId, 'task-a');
  assert.equal(started.plan.items.every((item) => item.decision === 'accepted'), true);
  assert.equal(
    started.plan.items.every((item) => item.humanDecisionEventIds.includes(mutationId)),
    true,
  );
  assert.equal(
    store.mutateDayPlan({
      planId: plan.id,
      mutationId,
      expectedVersion: plan.version,
      action: 'start_day',
    }).replayed,
    true,
  );

  store.close();
  const reopened = createDayPlanStore({ dbPath: file });
  assert.equal(reopened.getReadModel().currentPlan.recommendedFirstTaskId, 'task-a');
  reopened.close();
});

test('Morning Arrival reopens an active day and Start My Day activates it again', (t) => {
  const { store } = isolatedStore(t);
  let plan = ensure(store).plan;
  plan = mutate(store, plan, 'arrival_open').plan;
  plan = mutate(store, plan, 'start_day').plan;
  const versionBeforeReopen = plan.version;

  const reopened = mutate(store, plan, 'arrival_reopen');
  plan = reopened.plan;
  assert.equal(plan.state, 'proposed');
  assert.equal(plan.arrivalState, 'opened');
  assert.equal(plan.settlementState, 'not_due');
  assert.equal(plan.version, versionBeforeReopen + 1);
  assert.equal(plan.recommendedFirstItemId, undefined);
  assert.equal(plan.recommendedFirstTaskId, undefined);
  assert.equal(plan.confirmedAt, undefined);
  const reopenEvent = store.listEvents(plan.id).find(
    (event) => event.id === plan.lastMutationId,
  );
  assert.equal(reopenEvent.eventType, 'arrival_reopen');
  assert.equal(reopenEvent.resultVersion, plan.version);

  plan = mutate(store, plan, 'start_day').plan;
  assert.equal(plan.state, 'active');
  assert.equal(plan.arrivalState, 'confirmed');
  assert.equal(plan.recommendedFirstTaskId, 'task-a');
});

test('Morning Arrival cancels an in-progress settlement but never reopens a settled day', (t) => {
  const { store } = isolatedStore(t);
  let plan = ensure(store).plan;
  plan = mutate(store, plan, 'arrival_open').plan;
  plan = mutate(store, plan, 'start_day').plan;
  plan = mutate(store, plan, 'settlement_start').plan;
  plan = mutate(store, plan, 'settlement_decide', {
    itemId: plan.items[1].id,
    disposition: 'carry',
  }).plan;

  plan = mutate(store, plan, 'arrival_reopen').plan;
  assert.equal(plan.state, 'proposed');
  assert.equal(plan.arrivalState, 'opened');
  assert.equal(plan.settlementState, 'not_due');
  assert.equal(plan.items.every((item) => item.settlementDecision === undefined), true);

  plan = mutate(store, plan, 'start_day').plan;
  plan = mutate(store, plan, 'settlement_start').plan;
  plan = mutate(store, plan, 'settlement_commit', {
    completedHumanTaskIds: plan.items.map((item) => item.taskId),
  }).plan;
  const settledVersion = plan.version;
  assert.throws(
    () => mutate(store, plan, 'arrival_reopen'),
    (error) => error instanceof DayPlanInvalidTransition && /already settled/.test(error.message),
  );
  assert.equal(store.getPlan(plan.id).version, settledVersion);
});

test('Morning Arrival never reopens an abandoned day', (t) => {
  const { file, store } = isolatedStore(t);
  const plan = ensure(store).plan;
  const db = new Database(file);
  db.prepare(
    "UPDATE day_plans SET plan_state = 'abandoned', open_slot = NULL WHERE id = ?",
  ).run(plan.id);
  db.close();
  const abandoned = store.getPlan(plan.id);

  assert.equal(abandoned.state, 'abandoned');
  assert.throws(
    () => mutate(store, abandoned, 'arrival_reopen'),
    (error) => error instanceof DayPlanInvalidTransition && /already abandoned/.test(error.message),
  );
  assert.equal(store.getPlan(plan.id).version, abandoned.version);
});

test('Not today removes a preselected outcome without changing the underlying task', (t) => {
  const { store } = isolatedStore(t);
  let plan = ensure(store).plan;
  plan = mutate(store, plan, 'arrival_open').plan;
  const dismissedId = plan.items[0].id;
  plan = mutate(store, plan, 'item_dismiss', { itemId: dismissedId }).plan;
  assert.equal(plan.items.at(-1).id, dismissedId);
  assert.equal(plan.items.at(-1).decision, 'dismissed');

  plan = mutate(store, plan, 'start_day').plan;
  assert.equal(plan.recommendedFirstTaskId, 'task-b');
  assert.equal(plan.items.find((item) => item.id === dismissedId).decision, 'dismissed');
});

test('an all-Claude plan selects handoff preparation without starting execution', (t) => {
  const { store } = isolatedStore(t);
  let plan = ensure(store).plan;
  plan = mutate(store, plan, 'arrival_open').plan;
  for (const item of plan.items) {
    plan = mutate(store, plan, 'item_owner', {
      itemId: item.id,
      owner: 'claude',
    }).plan;
  }
  plan = mutate(store, plan, 'start_day').plan;
  assert.equal(plan.recommendedFirstTaskId, 'task-a');
  assert.equal(plan.items.every((item) => item.owner === 'claude'), true);
  assert.equal(store.listEvents(plan.id).some((event) => event.eventType.includes('run')), false);
});

test('a human-confirmed Done task can close even when its planned owner was Claude', (t) => {
  const { store } = isolatedStore(t);
  let plan = ensure(store).plan;
  plan = mutate(store, plan, 'arrival_open').plan;
  plan = mutate(store, plan, 'item_owner', {
    itemId: plan.items[0].id,
    owner: 'claude',
  }).plan;
  plan = mutate(store, plan, 'start_day').plan;
  plan = mutate(store, plan, 'settlement_start').plan;
  plan = mutate(store, plan, 'settlement_decide', {
    itemId: plan.items[1].id,
    disposition: 'carry',
  }).plan;

  const committed = mutate(store, plan, 'settlement_commit', {
    completedHumanTaskIds: [plan.items[0].taskId],
  });
  assert.equal(committed.plan.state, 'settled');
  assert.deepEqual(committed.snapshot.body.completedHumanTaskIds, [plan.items[0].taskId]);
  assert.deepEqual(committed.snapshot.body.overnightQueue, []);
});

test('settlement saves decisions immediately and writes one factual snapshot', (t) => {
  const { store, setClock } = isolatedStore(t);
  let plan = ensure(store).plan;
  plan = mutate(store, plan, 'arrival_open').plan;
  plan = mutate(store, plan, 'start_day').plan;
  plan = mutate(store, plan, 'settlement_start').plan;
  assert.equal(plan.state, 'settling');

  setClock('2026-07-10T23:00:00.000Z');
  plan = mutate(store, plan, 'settlement_decide', {
    itemId: plan.items[1].id,
    disposition: 'carry',
  }).plan;
  assert.equal(plan.items[1].settlementDecision.disposition, 'carry');

  const commitInput = {
    planId: plan.id,
    mutationId: `settlement-commit:${plan.id}`,
    expectedVersion: plan.version,
    action: 'settlement_commit',
    completedHumanTaskIds: ['task-a'],
    nextDayNote: 'Begin with the carry.',
  };
  const committed = store.mutateDayPlan(commitInput);
  assert.equal(committed.plan.state, 'settled');
  assert.equal(committed.plan.settlementState, 'settled');
  assert.deepEqual(committed.snapshot.body.completedHumanTaskIds, ['task-a']);
  assert.deepEqual(committed.snapshot.body.overnightQueue, []);
  assert.equal(committed.snapshot.body.unresolvedItems[0].disposition, 'carry');
  assert.equal(committed.snapshot.body.nextDayRecommendationSeed.taskId, 'task-b');
  assert.equal(store.getReadModel().currentPlan, undefined);

  const replay = store.mutateDayPlan(commitInput);
  assert.equal(replay.replayed, true);
  assert.equal(replay.snapshot.id, committed.snapshot.id);
});

test('settlement writes a durable task reconciliation ledger before external task updates', (t) => {
  const { store, setClock } = isolatedStore(t);
  let plan = ensure(store).plan;
  plan = mutate(store, plan, 'arrival_open').plan;
  plan = mutate(store, plan, 'start_day').plan;
  plan = mutate(store, plan, 'settlement_start').plan;
  plan = mutate(store, plan, 'settlement_decide', {
    itemId: plan.items[1].id,
    disposition: 'defer',
    deferUntil: '2026-07-17T23:00:00.000Z',
  }).plan;

  const committed = mutate(store, plan, 'settlement_commit', {
    completedHumanTaskIds: ['task-a'],
  });
  assert.equal(committed.pendingReconciliations.length, 1);
  const pending = committed.pendingReconciliations[0];
  assert.equal(pending.taskId, 'task-b');
  assert.equal(pending.action, 'defer');
  assert.equal(store.getReadModel().pendingReconciliations.length, 1);

  setClock('2026-07-18T00:00:00.000Z');
  const overdue = store.listPendingReconciliations();
  assert.deepEqual(overdue.map((entry) => entry.action), ['defer', 'resurface']);

  const applied = store.acknowledgeReconciliation(pending.id);
  assert.equal(applied.reconciliation.state, 'applied');
  assert.equal(applied.replayed, false);
  assert.equal(store.acknowledgeReconciliation(pending.id).replayed, true);

  const resurface = store.listPendingReconciliations();
  assert.equal(resurface.length, 1);
  assert.equal(resurface[0].action, 'resurface');
  assert.equal(resurface[0].taskId, 'task-b');
  store.acknowledgeReconciliation(resurface[0].id);
  assert.deepEqual(store.listPendingReconciliations(), []);
});

test('failed settlement commit rolls back without a partial snapshot', (t) => {
  const { store } = isolatedStore(t);
  let plan = ensure(store).plan;
  plan = mutate(store, plan, 'arrival_open').plan;
  plan = mutate(store, plan, 'start_day').plan;
  plan = mutate(store, plan, 'settlement_start').plan;
  const version = plan.version;

  assert.throws(
    () =>
      mutate(store, plan, 'settlement_commit', {
        completedHumanTaskIds: ['task-a'],
      }),
    /Every unfinished accepted item/,
  );
  assert.equal(store.getPlan(plan.id).version, version);
  assert.equal(store.getSnapshot(plan.id), undefined);
});
