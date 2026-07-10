import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildDayPlanCandidates } from '../src/lib/day-plan/candidates.ts';
import { createDayPlanStore } from '../src/lib/day-plan/store.ts';
import {
  ASSISTANT_PROPOSAL_JSON_SCHEMA,
  buildAssistantPlannerCommand,
  buildExecutionCommand,
} from '../src/lib/claude-execution/commands.ts';
import {
  isExpectedClaudeProcess,
  runOneAssistantTurn,
  runOneExecution,
} from '../src/lib/claude-execution/worker.ts';
import {
  isClaudeWorkerAvailable,
  triggerOneShotWorker,
} from '../src/lib/claude-execution/trigger.ts';

const CLOCK = '2026-07-10T16:00:00.000Z';

function fixture(t, executionEnvironment = { autonomousEnabled: false, workspaces: new Map() }) {
  const dir = path.join(os.tmpdir(), `forge-worker-${process.pid}-${Date.now()}-${Math.random()}`);
  mkdirSync(dir, { recursive: true });
  const store = createDayPlanStore({
    dbPath: path.join(dir, 'forge.db'),
    now: () => new Date(CLOCK),
    executionEnvironment,
  });
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  let plan = store.ensureDayPlan({
    localDate: '2026-07-10',
    timezone: 'America/Los_Angeles',
    mutationId: `ensure:${Math.random()}`,
    candidates: buildDayPlanCandidates({
      localDate: '2026-07-10',
      timezone: 'America/Los_Angeles',
      tasks: [{
        id: 'task-a',
        title: 'Finish the launch brief',
        description: 'A reviewed launch brief exists.',
        definitionOfDone: 'The brief passes review.',
        priority: 'high',
        position: 0,
        column: 'today',
        status: 'open',
        updatedAt: '2026-07-10T15:00:00.000Z',
        refreshedAt: CLOCK,
      }],
    }),
  }).plan;
  plan = store.mutateDayPlan({
    planId: plan.id,
    expectedVersion: plan.version,
    mutationId: `arrival:${Math.random()}`,
    action: 'arrival_open',
  }).plan;
  return { dir, store, plan };
}

function fakeClaude(dir, output) {
  const executable = path.join(dir, 'fake-claude');
  const capture = path.join(dir, 'capture.json');
  writeFileSync(executable, `#!/usr/bin/env node
const fs = require('node:fs');
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  fs.writeFileSync(${JSON.stringify(capture)}, JSON.stringify({ args: process.argv.slice(2), input, cwd: process.cwd() }));
  process.stdout.write(${JSON.stringify(output)});
});
`);
  chmodSync(executable, 0o700);
  return { executable, capture };
}

function workerOptions(dir, store, claudePath) {
  const emptyMcpConfigPath = path.join(dir, 'empty-mcp.json');
  writeFileSync(emptyMcpConfigPath, '{"mcpServers":{}}');
  return {
    store,
    claudePath,
    emptyMcpConfigPath,
    logDir: path.join(dir, 'logs'),
    fallbackCwd: dir,
    now: () => new Date(CLOCK),
    timeoutMs: 5_000,
  };
}

test('planner command is the exact bounded no-tools JSON invocation', (t) => {
  const { store, plan } = fixture(t);
  const turn = store.createAssistantTurn({
    id: 'assistant-command',
    planId: plan.id,
    expectedVersion: plan.version,
    userText: 'Make the outcome clearer.',
  }).turn;
  const command = buildAssistantPlannerCommand({ claudePath: '/fake/claude', plan, turn });
  assert.equal(command.executable, '/fake/claude');
  assert.deepEqual(command.args, [
    '-p', '--no-session-persistence', '--permission-mode', 'plan',
    '--tools', '', '--model', 'sonnet', '--effort', 'medium', '--output-format',
    'json', '--json-schema', ASSISTANT_PROPOSAL_JSON_SCHEMA, '--max-budget-usd', '0.25',
  ]);
  assert.match(command.stdin, /untrusted data/);
  assert.match(command.stdin, /^\/forge-refine-today/);
  assert.doesNotMatch(command.stdin, /change external systems/i);
});

test('assistant worker claims once, validates the proposal, and applies the bounded patch', async (t) => {
  const { dir, store, plan } = fixture(t);
  const turn = store.createAssistantTurn({
    id: 'assistant-worker',
    planId: plan.id,
    expectedVersion: plan.version,
    userText: 'Assign this to Claude.',
  }).turn;
  const proposal = JSON.stringify({
    assistantText: 'Assigned to Claude.',
    needsClarification: false,
    operations: [{ operation: 'set_owner', itemId: plan.items[0].id, owner: 'claude' }],
  });
  const fake = fakeClaude(dir, proposal);
  assert.equal(await runOneAssistantTurn(workerOptions(dir, store, fake.executable)), true);
  assert.equal(store.getAssistantTurn(turn.id).state, 'applied');
  assert.equal(store.getPlan(plan.id).items[0].owner, 'claude');
  assert.equal(await runOneAssistantTurn(workerOptions(dir, store, fake.executable)), false);
  const captured = JSON.parse(readFileSync(fake.capture, 'utf8'));
  assert.deepEqual(captured.args.slice(0, 6), [
    '-p', '--no-session-persistence', '--permission-mode', 'plan', '--tools', '',
  ]);
  assert.match(captured.input, /^\/forge-refine-today/);
  assert.equal(captured.cwd, realpathSync(dir));
});

test('plan-review worker uses a resumable safe session and stops at plan_ready', async (t) => {
  const { dir, store, plan: original } = fixture(t);
  const plan = store.mutateDayPlan({
    planId: original.id,
    expectedVersion: original.version,
    mutationId: 'owner:claude',
    action: 'item_owner',
    itemId: original.items[0].id,
    owner: 'claude',
  }).plan;
  store.configureExecution({
    planId: plan.id,
    itemId: plan.items[0].id,
    expectedVersion: plan.version,
    mutationId: 'configure:worker:plan',
    mode: 'plan_review',
    modelAlias: 'sonnet',
  });
  const queued = store.kickoffItem({
    planId: plan.id,
    itemId: plan.items[0].id,
    expectedVersion: plan.version,
    mutationId: 'kickoff:worker:plan',
  }).run;
  const fake = fakeClaude(dir, '{"type":"result","result":"Plan ready"}\n');
  assert.equal(await runOneExecution(workerOptions(dir, store, fake.executable)), true);
  const finished = store.getExecutionRun(queued.id);
  assert.equal(finished.status, 'plan_ready');
  assert.equal(finished.exitCode, 0);
  assert.ok(finished.pid > 0);
  const captured = JSON.parse(readFileSync(fake.capture, 'utf8'));
  assert.equal(captured.args[captured.args.indexOf('--session-id') + 1], queued.claudeSessionId);
  assert.equal(captured.args[captured.args.indexOf('--permission-mode') + 1], 'plan');
  assert.equal(captured.args[captured.args.indexOf('--tools') + 1], '');
  assert.ok(captured.args.includes('--verbose'));
  assert.ok(captured.args.includes('--strict-mcp-config'));
  assert.ok(captured.args.includes('--no-chrome'));
  assert.ok(captured.args.includes('--disable-slash-commands'));
  assert.ok(!captured.args.includes('--bg'));
  assert.equal(statSync(path.join(dir, 'logs', `${queued.id}.jsonl`)).mode & 0o777, 0o600);
});

test('Together plan review stops at ready_to_join instead of completing the task', async (t) => {
  const { dir, store, plan: original } = fixture(t);
  const plan = store.mutateDayPlan({
    planId: original.id,
    expectedVersion: original.version,
    mutationId: 'owner:together',
    action: 'item_owner',
    itemId: original.items[0].id,
    owner: 'together',
  }).plan;
  store.configureExecution({
    planId: plan.id, itemId: plan.items[0].id, expectedVersion: plan.version,
    mutationId: 'configure:worker:together', mode: 'plan_review', modelAlias: 'sonnet',
  });
  const queued = store.kickoffItem({
    planId: plan.id, itemId: plan.items[0].id, expectedVersion: plan.version,
    mutationId: 'kickoff:worker:together',
  }).run;
  const fake = fakeClaude(dir, '{"type":"result","result":"Ready to work together"}\n');
  await runOneExecution(workerOptions(dir, store, fake.executable));
  assert.equal(store.getExecutionRun(queued.id).status, 'ready_to_join');
  assert.equal(store.getPlan(plan.id).items[0].decision, 'accepted');
});

test('execution command never turns autonomous work into bypass-permissions or native background work', () => {
  const command = buildExecutionCommand({
    claudePath: '/fake/claude',
    emptyMcpConfigPath: '/tmp/empty-mcp.json',
    fallbackCwd: '/tmp',
    run: {
      id: 'run', dayPlanId: 'plan', itemId: 'item', taskId: 'task', owner: 'claude',
      mode: 'autonomous', modelAlias: 'opus', status: 'queued', idempotencyKey: 'key',
      attempt: 1, claudeSessionId: '00000000-0000-4000-8000-000000000000', briefHash: 'hash',
      promptSnapshot: { title: 'Task', outcome: 'Outcome', definitionOfDone: 'Verified', whyToday: 'Priority' },
      workspaceId: 'workspace', workspacePath: '/tmp', budgetUsd: 1.5,
      readiness: { ready: true, codes: ['ready'], checkedAt: CLOCK },
      createdAt: CLOCK, updatedAt: CLOCK,
    },
  });
  assert.equal(command.args[command.args.indexOf('--permission-mode') + 1], 'auto');
  assert.equal(command.args[command.args.indexOf('--tools') + 1], 'Read,Glob,Grep,Edit,Write');
  assert.ok(command.args.includes('--safe-mode'));
  assert.equal(command.args[command.args.indexOf('--max-budget-usd') + 1], '1.5');
  assert.ok(!command.args.includes('--dangerously-skip-permissions'));
  assert.ok(!command.args.includes('--bg'));
});

test('autonomous worker stays in the allowlisted workspace and stops at awaiting_review', async (t) => {
  const workspace = path.join(os.tmpdir(), `forge-worker-repo-${process.pid}-${Date.now()}`);
  mkdirSync(workspace);
  writeFileSync(path.join(workspace, 'README.md'), 'fixture\n');
  execFileSync('/usr/bin/git', ['-C', workspace, 'init', '-q']);
  execFileSync('/usr/bin/git', [
    '-C', workspace, '-c', 'user.name=Forge Test', '-c', 'user.email=forge@example.test',
    'add', 'README.md',
  ]);
  execFileSync('/usr/bin/git', [
    '-C', workspace, '-c', 'user.name=Forge Test', '-c', 'user.email=forge@example.test',
    'commit', '-qm', 'fixture',
  ]);
  t.after(() => rmSync(workspace, { recursive: true, force: true }));
  const environment = {
    autonomousEnabled: true,
    workspaces: new Map([['fixture', {
      id: 'fixture', path: workspace, autonomousEnabled: true, maximumBudgetUsd: 2,
    }]]),
  };
  const { dir, store, plan: original } = fixture(t, environment);
  const plan = store.mutateDayPlan({
    planId: original.id, expectedVersion: original.version, mutationId: 'owner:auto',
    action: 'item_owner', itemId: original.items[0].id, owner: 'claude',
  }).plan;
  store.configureExecution({
    planId: plan.id, itemId: plan.items[0].id, expectedVersion: plan.version,
    mutationId: 'configure:worker:auto', mode: 'autonomous', modelAlias: 'sonnet',
    workspaceId: 'fixture', budgetUsd: 1.5,
  });
  const queued = store.kickoffItem({
    planId: plan.id, itemId: plan.items[0].id, expectedVersion: plan.version,
    mutationId: 'kickoff:worker:auto',
  }).run;
  const fake = fakeClaude(dir, '{"type":"result","result":"Changes ready for review"}\n');
  await runOneExecution(workerOptions(dir, store, fake.executable));
  assert.equal(store.getExecutionRun(queued.id).status, 'awaiting_review');
  const captured = JSON.parse(readFileSync(fake.capture, 'utf8'));
  assert.equal(captured.cwd, realpathSync(workspace));
  assert.equal(captured.args[captured.args.indexOf('--permission-mode') + 1], 'auto');
  assert.equal(captured.args[captured.args.indexOf('--tools') + 1], 'Read,Glob,Grep,Edit,Write');
  assert.equal(captured.args[captured.args.indexOf('--max-budget-usd') + 1], '1.5');
  assert.equal(store.getExecutionRun(queued.id).resultSummary.text, 'Changes ready for review');
});

test('stale running work becomes interrupted and is never automatically retried', (t) => {
  const { store, plan: original } = fixture(t);
  const plan = store.mutateDayPlan({
    planId: original.id,
    expectedVersion: original.version,
    mutationId: 'owner:stale',
    action: 'item_owner',
    itemId: original.items[0].id,
    owner: 'claude',
  }).plan;
  store.configureExecution({
    planId: plan.id, itemId: plan.items[0].id, expectedVersion: plan.version,
    mutationId: 'configure:stale', mode: 'plan_review', modelAlias: 'sonnet',
  });
  const queued = store.kickoffItem({
    planId: plan.id, itemId: plan.items[0].id, expectedVersion: plan.version,
    mutationId: 'kickoff:stale',
  }).run;
  store.claimNextExecutionRun(111);
  assert.equal(store.interruptStaleExecutionRuns('2026-07-10T16:01:00.000Z'), 1);
  assert.equal(store.getExecutionRun(queued.id).status, 'interrupted');
  assert.equal(store.claimNextExecutionRun(222), undefined);
  assert.equal(store.listExecutionRuns(plan.id).length, 1);
});

test('running cancellation flips the durable kill switch and terminates the process group', async (t) => {
  const { dir, store, plan: original } = fixture(t);
  const plan = store.mutateDayPlan({
    planId: original.id, expectedVersion: original.version, mutationId: 'owner:cancel',
    action: 'item_owner', itemId: original.items[0].id, owner: 'claude',
  }).plan;
  store.configureExecution({
    planId: plan.id, itemId: plan.items[0].id, expectedVersion: plan.version,
    mutationId: 'configure:cancel', mode: 'plan_review', modelAlias: 'sonnet',
  });
  const queued = store.kickoffItem({
    planId: plan.id, itemId: plan.items[0].id, expectedVersion: plan.version,
    mutationId: 'kickoff:cancel',
  }).run;
  const executable = path.join(dir, 'slow-claude');
  writeFileSync(executable, `#!/usr/bin/env node
process.on('SIGTERM', () => {});
process.stdin.resume();
process.stdin.on('end', () => setInterval(() => {}, 1000));
`);
  chmodSync(executable, 0o700);
  const running = runOneExecution({
    ...workerOptions(dir, store, executable),
    heartbeatIntervalMs: 20,
    terminationGraceMs: 50,
  });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (store.getExecutionRun(queued.id).status === 'running') break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(store.cancelExecutionRun(queued.id).status, 'cancelling');
  await running;
  assert.equal(store.getExecutionRun(queued.id).status, 'cancelled');
  assert.equal(store.getExecutionRun(queued.id).errorCode, 'user_cancelled');
});

test('orphan identity requires both the exact Claude command and resumable session', () => {
  const command = '/Users/test/.local/bin/claude -p --session-id session-123 --safe-mode';
  assert.equal(isExpectedClaudeProcess(command, '/Users/test/.local/bin/claude', 'session-123'), true);
  assert.equal(isExpectedClaudeProcess(command, '/Users/test/.local/bin/claude', 'other-session'), false);
  assert.equal(isExpectedClaudeProcess('/usr/bin/node other-worker', '/Users/test/.local/bin/claude', 'session-123'), false);
});

test('queue acknowledgement never claims a detached subprocess started', (t) => {
  const { store, plan } = fixture(t);
  const turn = store.createAssistantTurn({
    id: 'assistant-trigger', planId: plan.id, expectedVersion: plan.version,
    userText: 'Clarify this.',
  }).turn;
  const result = triggerOneShotWorker('assistant');
  assert.deepEqual(result, { queued: true, workerAvailable: false, lane: 'assistant' });
  assert.equal('triggered' in result, false);
  assert.equal(store.getAssistantTurn(turn.id).state, 'queued');
});

test('worker availability requires a fresh supervised heartbeat', (t) => {
  const dir = path.join(os.tmpdir(), `forge-heartbeat-${process.pid}-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  const heartbeatPath = path.join(dir, 'claude-worker.heartbeat');
  writeFileSync(heartbeatPath, 'alive\n');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const now = statSync(heartbeatPath).mtimeMs + 5_000;
  assert.equal(isClaudeWorkerAvailable({ configured: true, heartbeatPath, now }), true);
  assert.equal(
    isClaudeWorkerAvailable({ configured: true, heartbeatPath, now: now + 10_001 }),
    false,
  );
  assert.equal(isClaudeWorkerAvailable({ configured: false, heartbeatPath, now }), false);
});

test('installer provisions a supervised watch worker without enabling autonomy', () => {
  const installer = readFileSync(
    new URL('../scripts/install-forge-local.sh', import.meta.url),
    'utf8',
  );
  assert.match(installer, /com\.forge\.claude-worker/);
  assert.match(installer, /<string>watch<\/string>/);
  assert.match(installer, /TSX_BIN/);
  assert.match(installer, /CLAUDE_BIN/);
  assert.doesNotMatch(installer, /<key>FORGE_CLAUDE_EXECUTION_ENABLED<\/key>/);
});

test('standalone worker script compiles before launchd supervision', () => {
  const result = spawnSync(
    path.join(process.cwd(), 'node_modules', '.bin', 'tsx'),
    [path.join(process.cwd(), 'scripts', 'forge-claude-worker.ts'), '--lane', 'invalid'],
    { cwd: process.cwd(), encoding: 'utf8' },
  );
  assert.equal(result.status, 2);
  assert.doesNotMatch(result.stderr, /Transform failed|top-level await/i);
});
