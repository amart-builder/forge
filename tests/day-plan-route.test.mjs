import assert from 'node:assert/strict';
import { mkdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { NextRequest } from 'next/server';
import { buildDayPlanCandidates } from '../src/lib/day-plan/candidates.ts';
import { createDayPlanStore } from '../src/lib/day-plan/store.ts';
import {
  GET,
  POST,
  parseDayPlanPostBody,
} from '../src/app/api/day-plan/route.ts';
import { hasDayPlanRouteAccess } from '../src/lib/request-security.ts';

function candidate() {
  return buildDayPlanCandidates({
    localDate: '2026-07-10',
    timezone: 'America/Los_Angeles',
    tasks: [
      {
        id: 'task-a',
        title: 'Finish the proposal',
        priority: 'high',
        position: 0,
        column: 'today',
        status: 'open',
        updatedAt: '2026-07-10T15:00:00.000Z',
        refreshedAt: '2026-07-10T16:00:00.000Z',
      },
    ],
  })[0];
}

test('parses a bounded task-backed ensure request', () => {
  const parsed = parseDayPlanPostBody({
    action: 'ensure',
    localDate: '2026-07-10',
    timezone: 'America/Los_Angeles',
    mutationId: 'ensure:2026-07-10',
    candidates: [candidate()],
  });
  assert.equal(parsed.action, 'ensure');
  assert.equal(parsed.input.candidates[0].taskId, 'task-a');
});

test('rejects unstructured, stale, duplicate, and oversized candidates', () => {
  const base = candidate();
  assert.throws(
    () =>
      parseDayPlanPostBody({
        action: 'ensure',
        localDate: '2026-07-10',
        timezone: 'America/Los_Angeles',
        mutationId: 'ensure:2026-07-10',
        candidates: [{ ...base, sourceRefs: [] }],
      }),
    /requires one source/,
  );
  assert.throws(
    () =>
      parseDayPlanPostBody({
        action: 'ensure',
        localDate: '2026-07-10',
        timezone: 'America/Los_Angeles',
        mutationId: 'ensure:2026-07-10',
        candidates: [
          { ...base, sourceRefs: [{ ...base.sourceRefs[0], freshness: 'stale' }] },
        ],
      }),
    /current task evidence/,
  );
  assert.throws(
    () =>
      parseDayPlanPostBody({
        action: 'ensure',
        localDate: '2026-07-10',
        timezone: 'America/Los_Angeles',
        mutationId: 'ensure:2026-07-10',
        candidates: [base, base],
      }),
    /distinct tasks/,
  );
  assert.throws(
    () =>
      parseDayPlanPostBody({
        action: 'ensure',
        localDate: '2026-07-10',
        timezone: 'America/Los_Angeles',
        mutationId: 'ensure:2026-07-10',
        candidates: Array.from({ length: 11 }, () => base),
      }),
    /at most ten/,
  );
  assert.throws(
    () =>
      parseDayPlanPostBody({
        action: 'ensure',
        localDate: '2026-07-10',
        timezone: 'America/Los_Angeles',
        mutationId: 'ensure:2026-07-10',
        candidates: [{ ...base, whyToday: 'A person is urgently waiting.' }],
      }),
    /deterministic evidence/,
  );
  assert.throws(
    () =>
      parseDayPlanPostBody({
        action: 'ensure',
        localDate: '2026-07-10',
        timezone: 'America/Los_Angeles',
        mutationId: 'ensure:2026-07-10',
        candidates: [{
          ...base,
          newestSourceRefreshAt: undefined,
          sourceRefs: [{ ...base.sourceRefs[0], refreshedAt: undefined }],
        }],
      }),
    /refreshedAt is required/,
  );
});

test('requires positive expected versions and allowlisted actions', () => {
  assert.throws(
    () =>
      parseDayPlanPostBody({
        action: 'item_owner',
        planId: 'plan-a',
        mutationId: 'owner:1',
        expectedVersion: 0,
        owner: 'me',
      }),
    /positive integer/,
  );
  assert.throws(
    () =>
      parseDayPlanPostBody({
        action: 'run_autonomously',
        planId: 'plan-a',
        mutationId: 'run:1',
        expectedVersion: 1,
      }),
    /Unknown day-plan action/,
  );
  const reconciliation = parseDayPlanPostBody({
    action: 'reconciliation_applied',
    reconciliationId: 'reconciliation-a',
  });
  assert.equal(reconciliation.action, 'reconciliation_applied');
});

test('parses a complete item_add mutation and requires its bounded payload', () => {
  const parsed = parseDayPlanPostBody({
    action: 'item_add',
    planId: 'plan-a',
    mutationId: 'add:1',
    expectedVersion: 2,
    title: 'Prepare the client follow-up',
    outcome: 'A send-ready follow-up is drafted.',
    why: 'The client is waiting on the next step.',
    owner: 'claude',
  });
  assert.equal(parsed.action, 'item_add');
  assert.equal(parsed.input.owner, 'claude');
  assert.equal(parsed.input.why, 'The client is waiting on the next step.');
  assert.throws(
    () => parseDayPlanPostBody({
      action: 'item_add',
      planId: 'plan-a',
      mutationId: 'add:2',
      expectedVersion: 2,
      title: 'Missing fields',
    }),
    /required/,
  );
});

test('POST rejects untrusted hosts and missing CSRF before touching state', async () => {
  const untrusted = await POST(
    new NextRequest('http://evil.example/api/day-plan', {
      method: 'POST',
      headers: {
        host: 'evil.example',
        origin: 'http://evil.example',
        'content-type': 'application/json',
      },
      body: '{}',
    }),
  );
  assert.equal(untrusted.status, 403);

  const missingToken = await POST(
    new NextRequest('http://localhost:3200/api/day-plan', {
      method: 'POST',
      headers: {
        host: 'localhost:3200',
        origin: 'http://localhost:3200',
        'content-type': 'application/json',
      },
      body: '{}',
    }),
  );
  assert.equal(missingToken.status, 403);
});

test('GET exposes briefGeneration on loopback and strips it for a remote session', async (t) => {
  const dir = path.join(os.tmpdir(), `forge-route-gen-${process.pid}-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  const store = createDayPlanStore({ dbPath: path.join(dir, 'forge.db') });
  const globalRef = globalThis;
  const previousStore = globalRef.__forgeDayPlanStore;
  const previousEnv = {
    access: process.env.FORGE_DAY_PLAN_ACCESS_MODE,
    token: process.env.FORGE_DAY_PLAN_REMOTE_TOKEN,
    hosts: process.env.FORGE_ALLOWED_HOSTS,
  };
  globalRef.__forgeDayPlanStore = store;
  t.after(() => {
    if (previousStore === undefined) delete globalRef.__forgeDayPlanStore;
    else globalRef.__forgeDayPlanStore = previousStore;
    for (const [key, value] of [
      ['FORGE_DAY_PLAN_ACCESS_MODE', previousEnv.access],
      ['FORGE_DAY_PLAN_REMOTE_TOKEN', previousEnv.token],
      ['FORGE_ALLOWED_HOSTS', previousEnv.hosts],
    ]) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  // An open plan for the date, with a brief still queued (never consumed): the
  // in-flight scenario the arrival cares about.
  store.ensureDayPlan({
    localDate: '2026-07-10',
    timezone: 'America/Los_Angeles',
    mutationId: 'ensure:2026-07-10',
    candidates: [candidate()],
  });
  store.enqueueMorningBrief('2026-07-10', { modelAlias: 'opus', effort: 'high', budgetUsd: 1.5 });

  process.env.FORGE_DAY_PLAN_ACCESS_MODE = 'loopback';
  const loopback = await GET(
    new NextRequest('http://localhost:3200/api/day-plan', {
      headers: { host: 'localhost:3200', 'x-forwarded-for': '127.0.0.1' },
    }),
  );
  assert.equal(loopback.status, 200);
  const loopbackBody = await loopback.json();
  assert.equal(loopbackBody.briefGeneration.state, 'queued');
  assert.ok(loopbackBody.currentPlan);

  // The same store over a remote session strips briefGeneration exactly like
  // brief content: a remote caller never learns a brief is being written.
  process.env.FORGE_DAY_PLAN_ACCESS_MODE = 'session';
  process.env.FORGE_DAY_PLAN_REMOTE_TOKEN = 'secret-value';
  process.env.FORGE_ALLOWED_HOSTS = 'forge.example.test';
  const remote = await GET(
    new NextRequest('https://forge.example.test/api/day-plan', {
      headers: {
        host: 'forge.example.test',
        origin: 'https://forge.example.test',
        'x-forge-day-plan-session': 'secret-value',
      },
    }),
  );
  assert.equal(remote.status, 200);
  const remoteBody = await remote.json();
  assert.equal(remoteBody.briefGeneration, undefined);
  assert.ok(remoteBody.currentPlan);
  assert.equal(remoteBody.currentPlan.briefId, undefined);
});

test('non-loopback day-plan access requires the separate remote session secret', () => {
  const previous = {
    allowedHosts: process.env.FORGE_ALLOWED_HOSTS,
    accessMode: process.env.FORGE_DAY_PLAN_ACCESS_MODE,
    trustProxy: process.env.FORGE_TRUST_PROXY,
  };
  process.env.FORGE_ALLOWED_HOSTS = 'forge.example.test';
  delete process.env.FORGE_DAY_PLAN_ACCESS_MODE;
  delete process.env.FORGE_TRUST_PROXY;
  try {
    const request = (session) => new NextRequest('https://forge.example.test/api/day-plan', {
      headers: {
        host: 'forge.example.test',
        origin: 'https://forge.example.test',
        ...(session ? { 'x-forge-day-plan-session': session } : {}),
      },
    });
    const sessionOptions = { accessMode: 'session', sessionToken: 'secret-value' };
    assert.equal(hasDayPlanRouteAccess(request(), sessionOptions), false);
    assert.equal(hasDayPlanRouteAccess(request('wrong-value'), sessionOptions), false);
    assert.equal(hasDayPlanRouteAccess(request('secret-value'), sessionOptions), true);

    const spoofedForwardedHost = new NextRequest('http://forge.example.test/api/day-plan', {
      headers: {
        host: 'forge.example.test',
        'x-forwarded-host': 'localhost:3200',
      },
    });
    assert.equal(hasDayPlanRouteAccess(spoofedForwardedHost, sessionOptions), false);

    const spoofedDirectHost = new NextRequest('http://forge.example.test/api/day-plan', {
      headers: {
        host: 'localhost:3200',
        'x-forwarded-for': '203.0.113.10',
      },
    });
    assert.equal(hasDayPlanRouteAccess(spoofedDirectHost, sessionOptions), false);

    const localRequest = new NextRequest('http://localhost:3200/api/day-plan', {
      headers: {
        host: 'localhost:3200',
        'x-forwarded-for': '127.0.0.1',
      },
    });
    assert.equal(hasDayPlanRouteAccess(localRequest), true);
    assert.equal(
      hasDayPlanRouteAccess(localRequest, { accessMode: 'loopback' }),
      true,
    );

    const proxiedToLoopback = new NextRequest('http://127.0.0.1:3200/api/day-plan', {
      headers: {
        host: '127.0.0.1:3200',
        'x-forwarded-host': 'forge.example.test',
        'x-forwarded-proto': 'https',
      },
    });
    assert.equal(
      hasDayPlanRouteAccess(proxiedToLoopback, { accessMode: 'loopback' }),
      true,
    );
    process.env.FORGE_TRUST_PROXY = '1';
    assert.equal(
      hasDayPlanRouteAccess(proxiedToLoopback, { accessMode: 'loopback' }),
      false,
    );
  } finally {
    for (const [key, value] of [
      ['FORGE_ALLOWED_HOSTS', previous.allowedHosts],
      ['FORGE_DAY_PLAN_ACCESS_MODE', previous.accessMode],
      ['FORGE_TRUST_PROXY', previous.trustProxy],
    ]) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('unset and empty day-plan access mode default to loopback', () => {
  const previous = process.env.FORGE_DAY_PLAN_ACCESS_MODE;
  const localRequest = new NextRequest('http://localhost:3200/api/day-plan', {
    headers: { host: 'localhost:3200', origin: 'http://localhost:3200' },
  });
  try {
    delete process.env.FORGE_DAY_PLAN_ACCESS_MODE;
    assert.equal(hasDayPlanRouteAccess(localRequest), true);
    process.env.FORGE_DAY_PLAN_ACCESS_MODE = '   ';
    assert.equal(hasDayPlanRouteAccess(localRequest), true);
  } finally {
    if (previous === undefined) delete process.env.FORGE_DAY_PLAN_ACCESS_MODE;
    else process.env.FORGE_DAY_PLAN_ACCESS_MODE = previous;
  }
});
