import assert from 'node:assert/strict';
import test from 'node:test';
import { NextRequest } from 'next/server';
import { buildDayPlanCandidates } from '../src/lib/day-plan/candidates.ts';
import {
  POST,
  hasDayPlanRouteAccess,
  parseDayPlanPostBody,
} from '../src/app/api/day-plan/route.ts';

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

test('non-loopback day-plan access requires the separate remote session secret', () => {
  const previous = process.env.FORGE_ALLOWED_HOSTS;
  process.env.FORGE_ALLOWED_HOSTS = 'forge.example.test';
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
    assert.equal(hasDayPlanRouteAccess(localRequest), false);
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
      false,
    );
  } finally {
    if (previous === undefined) delete process.env.FORGE_ALLOWED_HOSTS;
    else process.env.FORGE_ALLOWED_HOSTS = previous;
  }
});
