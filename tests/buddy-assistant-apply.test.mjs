import assert from 'node:assert/strict';
import { mkdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { NextRequest } from 'next/server';
import { POST } from '../src/app/api/day-plan/assistant-apply/route.ts';
import { buildDayPlanCandidates } from '../src/lib/day-plan/candidates.ts';
import { createDayPlanStore } from '../src/lib/day-plan/store.ts';
import { getQuietCurrentCsrfToken } from '../src/lib/quiet-current/store.ts';

test('assistant-apply enforces access and CSRF, applies valid ops, and returns conflicts', async (t) => {
  const root = path.join(os.tmpdir(), `forge-buddy-apply-${process.pid}-${Date.now()}`);
  mkdirSync(root, { recursive: true });
  const store = createDayPlanStore({ dbPath: path.join(root, 'forge.db') });
  const previousStore = globalThis.__forgeDayPlanStore;
  const previousMode = process.env.FORGE_DAY_PLAN_ACCESS_MODE;
  const previousQuietFile = process.env.FORGE_QUIET_CURRENT_FILE;
  const quietFile = `buddy-apply-${process.pid}-${Date.now()}.json`;
  globalThis.__forgeDayPlanStore = store;
  process.env.FORGE_DAY_PLAN_ACCESS_MODE = 'loopback';
  process.env.FORGE_QUIET_CURRENT_FILE = quietFile;
  t.after(() => {
    if (previousStore === undefined) delete globalThis.__forgeDayPlanStore;
    else globalThis.__forgeDayPlanStore = previousStore;
    if (previousMode === undefined) delete process.env.FORGE_DAY_PLAN_ACCESS_MODE;
    else process.env.FORGE_DAY_PLAN_ACCESS_MODE = previousMode;
    if (previousQuietFile === undefined) delete process.env.FORGE_QUIET_CURRENT_FILE;
    else process.env.FORGE_QUIET_CURRENT_FILE = previousQuietFile;
    store.close();
    rmSync(root, { recursive: true, force: true });
    rmSync(path.join(process.cwd(), 'data', quietFile), { force: true });
    rmSync(path.join(process.cwd(), 'data', `${quietFile}.token`), { force: true });
  });

  const untrusted = await POST(new NextRequest('http://evil.example/api/day-plan/assistant-apply', {
    method: 'POST', headers: { host: 'evil.example', origin: 'http://evil.example' }, body: '{}',
  }));
  assert.equal(untrusted.status, 403);
  const missingCsrf = await POST(new NextRequest('http://localhost:3200/api/day-plan/assistant-apply', {
    method: 'POST', headers: { host: 'localhost:3200', origin: 'http://localhost:3200' }, body: '{}',
  }));
  assert.equal(missingCsrf.status, 403);

  let plan = store.ensureDayPlan({
    localDate: '2026-07-15', timezone: 'America/Los_Angeles', mutationId: 'ensure:buddy-apply',
    candidates: buildDayPlanCandidates({
      localDate: '2026-07-15', timezone: 'America/Los_Angeles',
      tasks: [{
        id: 'task-a', title: 'Write proposal', description: 'Finish the proposal.', priority: 'high',
        position: 0, column: 'today', status: 'open', updatedAt: '2026-07-15T15:00:00.000Z',
        refreshedAt: '2026-07-15T16:00:00.000Z',
      }],
    }),
  }).plan;
  plan = store.mutateDayPlan({
    planId: plan.id, expectedVersion: plan.version, mutationId: 'open:buddy-apply', action: 'arrival_open',
  }).plan;
  const body = {
    expectedVersion: plan.version,
    operations: [{ operation: 'set_owner', itemId: plan.items[0].id, owner: 'claude' }],
  };
  const request = () => new NextRequest('http://localhost:3200/api/day-plan/assistant-apply', {
    method: 'POST',
    headers: {
      host: 'localhost:3200', origin: 'http://localhost:3200', 'content-type': 'application/json',
      'x-forge-csrf': getQuietCurrentCsrfToken(),
    },
    body: JSON.stringify(body),
  });
  const applied = await POST(request());
  assert.equal(applied.status, 200);
  const appliedBody = await applied.json();
  assert.equal(appliedBody.plan.version, plan.version + 1);
  assert.equal(appliedBody.plan.items[0].owner, 'claude');
  assert.deepEqual(appliedBody.changes[0], {
    table: 'day_plan', action: 'update', id: plan.items[0].id,
    summary: "Assigned 'Write proposal' to Claude",
  });

  const conflict = await POST(request());
  assert.equal(conflict.status, 409);
  const conflictBody = await conflict.json();
  assert.equal(conflictBody.error, 'version_conflict');
  assert.equal(conflictBody.currentPlan.version, plan.version + 1);

  const originalApply = store.applyAssistantOperations;
  const originalConsoleError = console.error;
  store.applyAssistantOperations = () => { throw new Error('sqlite write failed'); };
  console.error = () => {};
  const failed = await POST(request());
  store.applyAssistantOperations = originalApply;
  console.error = originalConsoleError;
  assert.equal(failed.status, 500);
  assert.deepEqual(await failed.json(), { error: 'Assistant apply failed.' });
});
