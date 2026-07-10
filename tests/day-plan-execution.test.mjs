import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import { buildDayPlanCandidates } from '../src/lib/day-plan/candidates.ts';
import { createDayPlanStore, DayPlanInvalidTransition } from '../src/lib/day-plan/store.ts';
import {
  publicExecutionReadiness,
  publicExecutionRun,
} from '../src/lib/day-plan/public-execution.ts';

function setup(t, executionEnvironment = { autonomousEnabled: false, workspaces: new Map() }) {
  const file = path.join(os.tmpdir(), `forge-execution-${process.pid}-${Date.now()}-${Math.random()}.db`);
  const store = createDayPlanStore({
    dbPath: file,
    now: () => new Date('2026-07-10T16:00:00.000Z'),
    executionEnvironment,
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
    mutationId: 'ensure:execution',
    candidates: buildDayPlanCandidates({
      localDate: '2026-07-10',
      timezone: 'America/Los_Angeles',
      tasks: ['a', 'b'].map((id, position) => ({
        id: `task-${id}`,
        title: `Task ${id}`,
        description: `Finish task ${id}`,
        definitionOfDone: `Task ${id} is verified`,
        priority: position === 0 ? 'high' : 'medium',
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
    mutationId: 'arrival-open:execution',
    action: 'arrival_open',
  }).plan;
  return { store, plan, file };
}

function mutate(store, plan, action, patch = {}) {
  return store.mutateDayPlan({
    planId: plan.id,
    expectedVersion: plan.version,
    mutationId: `${action}:${plan.version}:${Math.random()}`.replaceAll('.', '-'),
    action,
    ...patch,
  }).plan;
}

test('Together plan review queues a resumable run without a workspace', (t) => {
  const { store, plan: original } = setup(t);
  let plan = mutate(store, original, 'item_owner', {
    itemId: original.items[0].id,
    owner: 'together',
  });
  const configured = store.configureExecution({
    planId: plan.id,
    itemId: plan.items[0].id,
    expectedVersion: plan.version,
    mutationId: 'configure:together',
    mode: 'plan_review',
    modelAlias: 'sonnet',
  });
  assert.equal(configured.readiness.ready, true);
  assert.equal(configured.config.workspaceId, undefined);

  const kicked = store.kickoffItem({
    planId: plan.id,
    itemId: plan.items[0].id,
    expectedVersion: plan.version,
    mutationId: 'kickoff:together',
  });
  assert.equal(kicked.run.status, 'queued');
  assert.equal(kicked.run.owner, 'together');
  assert.equal(kicked.run.mode, 'plan_review');
  assert.match(kicked.run.claudeSessionId, /^[0-9a-f-]{36}$/);
  assert.equal(kicked.plan.items[0].decision, 'accepted');
  assert.equal(store.kickoffItem({
    planId: plan.id,
    itemId: plan.items[0].id,
    expectedVersion: plan.version,
    mutationId: 'kickoff:together',
  }).replayed, true);
});

test('Together can never be configured for autonomous execution', (t) => {
  const { store, plan: original } = setup(t);
  const plan = mutate(store, original, 'item_owner', {
    itemId: original.items[0].id,
    owner: 'together',
  });
  assert.throws(
    () => store.configureExecution({
      planId: plan.id,
      itemId: plan.items[0].id,
      expectedVersion: plan.version,
      mutationId: 'configure:together:auto',
      mode: 'autonomous',
      modelAlias: 'sonnet',
      workspaceId: 'forge',
      budgetUsd: 1,
    }),
    (error) => error instanceof DayPlanInvalidTransition,
  );
});

test('brief edits invalidate execution configuration and prevent kickoff', (t) => {
  const { store, plan: original } = setup(t);
  let plan = mutate(store, original, 'item_owner', {
    itemId: original.items[0].id,
    owner: 'claude',
  });
  store.configureExecution({
    planId: plan.id,
    itemId: plan.items[0].id,
    expectedVersion: plan.version,
    mutationId: 'configure:brief',
    mode: 'plan_review',
    modelAlias: 'sonnet',
  });
  const queued = store.kickoffItem({
    planId: plan.id,
    itemId: plan.items[0].id,
    expectedVersion: plan.version,
    mutationId: 'kickoff:before-brief-change',
  });
  assert.equal(queued.run.status, 'queued');
  plan = queued.plan;
  plan = mutate(store, plan, 'item_edit', {
    itemId: plan.items[0].id,
    outcome: 'A newly clarified outcome',
  });
  const readiness = store.getExecutionReadiness(plan.id, plan.items[0].id);
  assert.equal(readiness.ready, false);
  assert.ok(readiness.codes.includes('brief_changed'));
  const kickoff = store.kickoffItem({
    planId: plan.id,
    itemId: plan.items[0].id,
    expectedVersion: plan.version,
    mutationId: 'kickoff:stale-brief',
  });
  assert.equal(kickoff.run, undefined);
  const runs = store.listExecutionRuns(plan.id);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].status, 'cancelled');
  assert.equal(runs[0].errorCode, 'brief_changed');
});

test('Start My Day routes the latest agent cards and reports autonomous setup gaps', (t) => {
  const { store, plan: original } = setup(t);
  let plan = original;
  plan = mutate(store, plan, 'item_owner', { itemId: plan.items[0].id, owner: 'together' });
  plan = mutate(store, plan, 'item_owner', { itemId: plan.items[1].id, owner: 'claude' });
  const started = store.mutateDayPlan({
    planId: plan.id,
    expectedVersion: plan.version,
    mutationId: 'start-day:execution',
    action: 'start_day',
  });
  assert.equal(started.plan.state, 'active');
  assert.equal(started.executionRuns.length, 1);
  assert.equal(started.executionRuns[0].itemId, plan.items[0].id);
  assert.equal(started.executionRuns[0].mode, 'plan_review');
  assert.equal(started.executionRuns[0].modelAlias, 'opus');
  assert.equal(started.unreadyItems.length, 1);
  assert.equal(started.unreadyItems[0].itemId, plan.items[1].id);
  assert.equal(store.listExecutionRuns(plan.id).length, 1);
  const replay = store.mutateDayPlan({
    planId: plan.id,
    expectedVersion: plan.version,
    mutationId: 'start-day:execution',
    action: 'start_day',
  });
  assert.equal(replay.replayed, true);
  assert.equal(store.listExecutionRuns(plan.id).length, 1);
});

test('autonomous readiness requires enablement, allowlisted clean Git, DoD, opt-in, and budget', (t) => {
  const repo = path.join(os.tmpdir(), `forge-ready-repo-${process.pid}-${Date.now()}`);
  mkdirSync(repo);
  writeFileSync(path.join(repo, 'README.md'), 'fixture\n');
  execFileSync('/usr/bin/git', ['-C', repo, 'init', '-q']);
  execFileSync('/usr/bin/git', ['-C', repo, '-c', 'user.name=Forge Test', '-c', 'user.email=forge@example.test', 'add', 'README.md']);
  execFileSync('/usr/bin/git', ['-C', repo, '-c', 'user.name=Forge Test', '-c', 'user.email=forge@example.test', 'commit', '-qm', 'fixture']);
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  const environment = {
    autonomousEnabled: true,
    workspaces: new Map([['fixture', {
      id: 'fixture',
      path: repo,
      autonomousEnabled: true,
      maximumBudgetUsd: 2,
    }]]),
  };
  const { store, plan: original } = setup(t, environment);
  const plan = mutate(store, original, 'item_owner', {
    itemId: original.items[0].id,
    owner: 'claude',
  });
  const configured = store.configureExecution({
    planId: plan.id,
    itemId: plan.items[0].id,
    expectedVersion: plan.version,
    mutationId: 'configure:auto:ready',
    mode: 'autonomous',
    modelAlias: 'sonnet',
    workspaceId: 'fixture',
    budgetUsd: 1.5,
  });
  assert.equal(configured.readiness.ready, true);
  assert.equal(configured.readiness.workspacePath, realpathSync(repo));
  writeFileSync(path.join(repo, 'dirty.txt'), 'dirty\n');
  const dirty = store.getExecutionReadiness(plan.id, plan.items[0].id);
  assert.equal(dirty.ready, false);
  assert.ok(dirty.codes.includes('workspace_dirty'));
});

test('browser execution payloads omit local paths and process identifiers', () => {
  const readiness = {
    ready: true,
    codes: ['ready'],
    checkedAt: '2026-07-10T16:00:00.000Z',
    workspacePath: '/private/allowlisted/project',
  };
  assert.equal(publicExecutionReadiness(readiness).workspacePath, undefined);
  const run = publicExecutionRun({
    id: 'run-public',
    dayPlanId: 'plan-public',
    itemId: 'item-public',
    taskId: 'task-public',
    owner: 'claude',
    mode: 'autonomous',
    modelAlias: 'sonnet',
    status: 'running',
    idempotencyKey: 'public',
    attempt: 1,
    claudeSessionId: '00000000-0000-4000-8000-000000000000',
    briefHash: 'hash',
    promptSnapshot: {
      title: 'Public task',
      outcome: 'A safe public response',
      whyToday: 'Accepted work',
    },
    workspacePath: '/private/allowlisted/project',
    pid: 4242,
    readiness,
    createdAt: '2026-07-10T16:00:00.000Z',
    updatedAt: '2026-07-10T16:00:00.000Z',
  });
  assert.equal(run.workspacePath, undefined);
  assert.equal(run.pid, undefined);
  assert.equal(run.readiness.workspacePath, undefined);
});

test('authorization revisions cancel queued runs for mode, model, budget, and workspace changes', (t) => {
  function gitRepo(label) {
    const repo = path.join(os.tmpdir(), `forge-auth-${label}-${process.pid}-${Date.now()}`);
    mkdirSync(repo);
    writeFileSync(path.join(repo, 'README.md'), `${label}\n`);
    execFileSync('/usr/bin/git', ['-C', repo, 'init', '-q']);
    execFileSync('/usr/bin/git', ['-C', repo, '-c', 'user.name=Forge Test', '-c', 'user.email=forge@example.test', 'add', 'README.md']);
    execFileSync('/usr/bin/git', ['-C', repo, '-c', 'user.name=Forge Test', '-c', 'user.email=forge@example.test', 'commit', '-qm', 'fixture']);
    t.after(() => rmSync(repo, { recursive: true, force: true }));
    return repo;
  }
  const first = gitRepo('first');
  const second = gitRepo('second');
  const environment = {
    autonomousEnabled: true,
    workspaces: new Map([
      ['first', { id: 'first', path: first, autonomousEnabled: true, maximumBudgetUsd: 3 }],
      ['second', { id: 'second', path: second, autonomousEnabled: true, maximumBudgetUsd: 3 }],
    ]),
  };
  const { store, plan: original, file } = setup(t, environment);
  let plan = mutate(store, original, 'item_owner', {
    itemId: original.items[0].id,
    owner: 'claude',
  });
  const itemId = plan.items[0].id;
  let sequence = 0;
  const configure = (patch) => store.configureExecution({
    planId: plan.id, itemId, expectedVersion: plan.version,
    mutationId: `configure:auth:${++sequence}`,
    mode: 'autonomous', modelAlias: 'sonnet', workspaceId: 'first', budgetUsd: 1,
    ...patch,
  }).config;
  const kickoff = () => {
    const result = store.kickoffItem({
      planId: plan.id, itemId, expectedVersion: plan.version,
      mutationId: `kickoff:auth:${++sequence}`,
    });
    plan = result.plan;
    return result.run;
  };

  const initialConfig = configure({});
  const modelRun = kickoff();
  const modelConfig = configure({ modelAlias: 'opus' });
  assert.notEqual(modelConfig.authorizationHash, initialConfig.authorizationHash);
  assert.equal(store.getExecutionRun(modelRun.id).errorCode, 'authorization_changed');

  const budgetRun = kickoff();
  configure({ modelAlias: 'opus', budgetUsd: 1.5 });
  assert.equal(store.getExecutionRun(budgetRun.id).status, 'cancelled');

  const workspaceRun = kickoff();
  configure({ modelAlias: 'opus', budgetUsd: 1.5, workspaceId: 'second' });
  assert.equal(store.getExecutionRun(workspaceRun.id).errorCode, 'authorization_changed');

  const modeRun = kickoff();
  configure({ mode: 'plan_review', modelAlias: 'opus', workspaceId: undefined, budgetUsd: undefined });
  assert.equal(store.getExecutionRun(modeRun.id).status, 'cancelled');

  const tamperedRun = kickoff();
  const db = new Database(file);
  db.prepare('UPDATE day_plan_execution_configs SET model_alias = ? WHERE day_plan_id = ? AND item_id = ?')
    .run('sonnet', plan.id, itemId);
  db.close();
  assert.equal(store.claimNextExecutionRun(123), undefined);
  assert.equal(store.getExecutionRun(tamperedRun.id).errorCode, 'authorization_changed');

  const metadata = store.listExecutionWorkspaces();
  assert.deepEqual(metadata, [
    { id: 'first', maximumBudgetUsd: 3 },
    { id: 'second', maximumBudgetUsd: 3 },
  ]);
  assert.equal(JSON.stringify(metadata).includes(first), false);
});

test('failed and cancelled runs can be retried under the same current authorization', (t) => {
  const { store, plan: original } = setup(t);
  let plan = mutate(store, original, 'item_owner', {
    itemId: original.items[0].id,
    owner: 'claude',
  });
  store.configureExecution({
    planId: plan.id,
    itemId: plan.items[0].id,
    expectedVersion: plan.version,
    mutationId: 'configure:retry',
    mode: 'plan_review',
    modelAlias: 'sonnet',
  });
  const first = store.kickoffItem({
    planId: plan.id,
    itemId: plan.items[0].id,
    expectedVersion: plan.version,
    mutationId: 'kickoff:retry:first',
  });
  assert.equal(first.run.attempt, 1);
  const claimed = store.claimNextExecutionRun(12345);
  assert.equal(claimed.id, first.run.id);
  store.finishExecutionRun({ runId: claimed.id, errorCode: 'claude_failed' });
  plan = store.getPlan(plan.id);

  const second = store.kickoffItem({
    planId: plan.id,
    itemId: plan.items[0].id,
    expectedVersion: plan.version,
    mutationId: 'kickoff:retry:second',
  });
  assert.notEqual(second.run.id, first.run.id);
  assert.equal(second.run.attempt, 2);
  assert.equal(second.run.status, 'queued');
  const cancelled = store.cancelExecutionRun(second.run.id);
  assert.equal(cancelled.status, 'cancelled');
  plan = store.getPlan(plan.id);

  const third = store.kickoffItem({
    planId: plan.id,
    itemId: plan.items[0].id,
    expectedVersion: plan.version,
    mutationId: 'kickoff:retry:third',
  });
  assert.notEqual(third.run.id, second.run.id);
  assert.equal(third.run.attempt, 3);
  assert.equal(third.run.status, 'queued');
});
