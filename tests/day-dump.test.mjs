import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildDayPlanCandidates } from '../src/lib/day-plan/candidates.ts';
import { createDayPlanStore } from '../src/lib/day-plan/store.ts';
import {
  buildDayDumpCommand,
  buildDayDumpPrompt,
  DAY_DUMP_JSON_SCHEMA,
  validateDayDump,
} from '../src/lib/claude-execution/dump-commands.ts';
import { runOneDayDump } from '../src/lib/claude-execution/worker.ts';

const CLOCK = '2026-07-18T02:00:00.000Z';
const RAW_DUMP = 'I promised Maya I would send the deck Tuesday. Idea: make a client FAQ.';
const VALID_WIRE = {
  items: [
    {
      kind: 'promise',
      title: 'Send Maya the deck',
      details: null,
      counterparty: 'Maya',
      source_quote: 'I promised Maya I would send the deck Tuesday.',
      due_at: '2026-07-21T09:00:00-07:00',
      review_at: null,
      confidence: 'high',
      status: 'open',
    },
    {
      kind: 'idea',
      title: 'Make a client FAQ',
      details: null,
      counterparty: null,
      source_quote: 'Idea: make a client FAQ.',
      due_at: null,
      review_at: '2026-07-20T09:00:00-07:00',
      confidence: 'high',
      status: 'open',
    },
  ],
  skipped_duplicates: [],
  nothing_found: false,
};

function fixture(t) {
  const dir = path.join(os.tmpdir(), `forge-day-dump-${process.pid}-${Date.now()}-${Math.random()}`);
  mkdirSync(dir, { recursive: true });
  const store = createDayPlanStore({
    dbPath: path.join(dir, 'forge.db'),
    now: () => new Date(CLOCK),
  });
  writeFileSync(path.join(dir, 'empty-mcp.json'), '{"mcpServers":{}}');
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return { dir, store };
}

function mutate(store, plan, action, patch = {}) {
  return store.mutateDayPlan({
    planId: plan.id,
    mutationId: `${action}:${plan.version}:${Math.random()}`,
    expectedVersion: plan.version,
    action,
    ...patch,
  }).plan;
}

function settleWithDump(store, rawText = RAW_DUMP) {
  const candidates = buildDayPlanCandidates({
    localDate: '2026-07-17',
    timezone: 'America/Los_Angeles',
    tasks: [{
      id: 'task-a',
      title: 'Finish the client deck',
      priority: 'high',
      position: 0,
      column: 'today',
      status: 'open',
      updatedAt: '2026-07-17T18:00:00.000Z',
      refreshedAt: '2026-07-17T18:00:00.000Z',
    }],
  });
  let plan = store.ensureDayPlan({
    localDate: '2026-07-17',
    timezone: 'America/Los_Angeles',
    mutationId: `ensure:${Math.random()}`,
    candidates,
  }).plan;
  plan = mutate(store, plan, 'arrival_open');
  plan = mutate(store, plan, 'start_day');
  plan = mutate(store, plan, 'settlement_start');
  plan = mutate(store, plan, 'settlement_commit', {
    completedHumanTaskIds: ['task-a'],
    nextDayNote: rawText,
  });
  return plan;
}

function fakeCodex(dir, outputs) {
  const executable = path.join(dir, `fake-codex-${Math.random()}`);
  const capture = path.join(dir, `codex-capture-${Math.random()}.jsonl`);
  const state = path.join(dir, `codex-state-${Math.random()}`);
  writeFileSync(executable, `#!/usr/bin/env node
const fs = require('node:fs');
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  let index = 0;
  try { index = Number(fs.readFileSync(${JSON.stringify(state)}, 'utf8')); } catch {}
  fs.writeFileSync(${JSON.stringify(state)}, String(index + 1));
  const args = process.argv.slice(2);
  fs.appendFileSync(${JSON.stringify(capture)}, JSON.stringify({ args, input, cwd: process.cwd() }) + '\\n');
  const outputPath = args[args.indexOf('--output-last-message') + 1];
  fs.writeFileSync(outputPath, ${JSON.stringify(outputs)}[index] ?? '');
});
`);
  chmodSync(executable, 0o700);
  return { executable, capture };
}

function fakeClaude(dir, output) {
  const executable = path.join(dir, `fake-claude-${Math.random()}`);
  writeFileSync(executable, `#!/usr/bin/env node
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => process.stdout.write(${JSON.stringify(output)}));
`);
  chmodSync(executable, 0o700);
  return executable;
}

function workerOptions(dir, store, overrides = {}) {
  return {
    store,
    claudePath: path.join(dir, 'claude-must-not-run'),
    emptyMcpConfigPath: path.join(dir, 'empty-mcp.json'),
    logDir: path.join(dir, 'logs'),
    fallbackCwd: dir,
    now: () => new Date(CLOCK),
    dumpTimeoutMs: 5_000,
    dumpFetchTimeoutMs: 5_000,
    webBaseUrl: 'http://forge.test',
    ...overrides,
  };
}

function fakeForgeFetch(insertStatuses = [201, 201], posts = []) {
  let insertIndex = 0;
  return async (url, init = {}) => {
    const value = String(url);
    if (value.includes('/api/forge-rest/commitments') && !init.method) {
      return new Response('[]', { status: 200 });
    }
    if (value.endsWith('/api/day-plan')) {
      return new Response(JSON.stringify({ csrfToken: 'csrf-token' }), { status: 200 });
    }
    if (value.endsWith('/api/forge-rest/commitments') && init.method === 'POST') {
      posts.push({ body: JSON.parse(init.body), headers: init.headers });
      const status = insertStatuses[insertIndex++] ?? 201;
      return new Response(status === 201 ? '[]' : 'failed', { status });
    }
    throw new Error(`unexpected request: ${value}`);
  };
}

test('settlement stores the note and enqueues one append-only dump row', (t) => {
  const { store } = fixture(t);
  const plan = settleWithDump(store);
  assert.equal(plan.nextDayNote, RAW_DUMP);
  const dumps = store.listDayDumps('2026-07-17');
  assert.equal(dumps.length, 1);
  assert.equal(dumps[0].rawText, RAW_DUMP);
  assert.equal(dumps[0].status, 'queued');
  assert.equal(store.getPlanForDate('2026-07-17').items[0].title, 'Finish the client deck');
});

test('dump prompt and validator enforce the bounded grounded contract', () => {
  const prompt = buildDayDumpPrompt({
    rawDump: RAW_DUMP,
    targetLocalDate: '2026-07-17',
    planItems: [{ id: 'item-a', title: 'Finish the client deck' }],
    openCommitments: [],
  });
  assert.match(prompt, /DUMP_TIMEZONE=America\/Los_Angeles/);
  assert.match(prompt, /DEFAULT_REVIEW_AT=2026-07-20T09:00:00-07:00/);
  assert.match(prompt, /CONTEXT TODAY_PLAN_ITEMS=\[{"id":"item-a","title":"Finish the client deck"}\]/);
  const command = buildDayDumpCommand({
    claudePath: '/fake/claude',
    emptyMcpConfigPath: '/fake/empty.json',
    prompt,
    modelAlias: 'opus',
    effort: 'high',
    budgetUsd: 1.5,
  });
  assert.deepEqual(command.args, [
    '-p', '--no-session-persistence', '--permission-mode', 'plan', '--tools', '',
    '--strict-mcp-config', '--mcp-config', '/fake/empty.json',
    '--model', 'opus', '--effort', 'high', '--output-format', 'json',
    '--json-schema', DAY_DUMP_JSON_SCHEMA, '--max-budget-usd', '1.5',
  ]);
  assert.deepEqual(validateDayDump(VALID_WIRE, RAW_DUMP), VALID_WIRE);
  assert.throws(
    () => validateDayDump({
      ...VALID_WIRE,
      items: [{ ...VALID_WIRE.items[0], source_quote: 'Maya needs a deck.' }],
    }, RAW_DUMP),
    /source_quote_not_verbatim/,
  );
  assert.throws(
    () => validateDayDump({
      ...VALID_WIRE,
      items: [{ ...VALID_WIRE.items[0], due_at: 'Tuesday' }],
    }, RAW_DUMP),
    /due_at_iso/,
  );
  assert.throws(
    () => validateDayDump({ ...VALID_WIRE, items: Array.from({ length: 21 }, () => VALID_WIRE.items[0]) }, RAW_DUMP),
    /items_bounds/,
  );
});

test('Codex retries one invalid extraction, inserts grounded commitments, and stores a receipt', async (t) => {
  const { dir, store } = fixture(t);
  settleWithDump(store);
  const invalid = { ...VALID_WIRE, items: [{ ...VALID_WIRE.items[0], source_quote: 'not in dump' }] };
  const fake = fakeCodex(dir, [
    JSON.stringify(invalid),
    `\`\`\`json\n${JSON.stringify(VALID_WIRE)}\n\`\`\``,
  ]);
  const posts = [];
  assert.equal(await runOneDayDump(workerOptions(dir, store, {
    dumpWriter: 'codex',
    codexPath: fake.executable,
    fetchImpl: fakeForgeFetch([201, 201], posts),
  })), true);

  const dump = store.listDayDumps()[0];
  assert.equal(dump.status, 'succeeded');
  const receipt = JSON.parse(dump.resultJson);
  assert.deepEqual(receipt.counts, {
    extracted: 2,
    created: 2,
    skipped_duplicates: 0,
    failed: 0,
  });
  assert.equal(receipt.created.length, 2);
  assert.equal(posts.length, 2);
  assert.equal(posts[0].body.source_kind, 'brain_dump');
  assert.equal(posts[0].body.source_ref, dump.id);
  assert.equal(posts[0].body.confirmed, false);
  assert.equal(posts[0].headers['X-Forge-CSRF'], 'csrf-token');
  const captures = readFileSync(fake.capture, 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(captures.length, 2);
  assert.equal(captures[0].cwd.includes('forge-day-dump-'), true);
  assert.match(captures[1].input, /previous output failed validation/);
  assert.deepEqual(captures[0].args.slice(0, 9), [
    'exec', '--sandbox', 'read-only', '--skip-git-repo-check',
    '-m', 'gpt-5.6-sol', '-c', 'model_reasoning_effort=high',
    '--output-last-message',
  ]);
});

test('partial commitment insert failures stay honest without failing the dump row', async (t) => {
  const { dir, store } = fixture(t);
  settleWithDump(store);
  const posts = [];
  const claudePath = fakeClaude(dir, JSON.stringify(VALID_WIRE));
  await runOneDayDump(workerOptions(dir, store, {
    dumpWriter: 'claude',
    claudePath,
    fetchImpl: fakeForgeFetch([500, 201], posts),
  }));
  const dump = store.listDayDumps()[0];
  const receipt = JSON.parse(dump.resultJson);
  assert.equal(dump.status, 'succeeded');
  assert.equal(receipt.created.length, 1);
  assert.equal(receipt.failed.length, 1);
  assert.deepEqual(receipt.counts, {
    extracted: 2,
    created: 1,
    skipped_duplicates: 0,
    failed: 1,
  });
});

test('the dump row fails only when every extracted commitment insert fails', async (t) => {
  const { dir, store } = fixture(t);
  settleWithDump(store);
  const claudePath = fakeClaude(dir, JSON.stringify(VALID_WIRE));
  await runOneDayDump(workerOptions(dir, store, {
    dumpWriter: 'claude',
    claudePath,
    fetchImpl: fakeForgeFetch([500, 500]),
  }));
  const dump = store.listDayDumps()[0];
  const receipt = JSON.parse(dump.resultJson);
  assert.equal(dump.status, 'failed');
  assert.equal(dump.errorCode, 'commitment_insert_failed');
  assert.equal(receipt.counts.failed, 2);
  assert.equal(receipt.counts.created, 0);
});
