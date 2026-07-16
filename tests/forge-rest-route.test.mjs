import assert from 'node:assert/strict';
import test from 'node:test';
import { NextRequest } from 'next/server';
import {
  forgeRestMutationAccessFailure,
  GET,
  POST,
} from '../src/app/api/forge-rest/[table]/route.ts';

const context = { params: Promise.resolve({ table: 'not_a_forge_table' }) };

test('forge-rest keeps GET host-only while mutations require route access and CSRF', async (t) => {
  const previousAccessMode = process.env.FORGE_DAY_PLAN_ACCESS_MODE;
  delete process.env.FORGE_DAY_PLAN_ACCESS_MODE;
  t.after(() => {
    if (previousAccessMode === undefined) delete process.env.FORGE_DAY_PLAN_ACCESS_MODE;
    else process.env.FORGE_DAY_PLAN_ACCESS_MODE = previousAccessMode;
  });

  const untrustedGet = await GET(new NextRequest('http://evil.example/api/forge-rest/tasks', {
    headers: { host: 'evil.example', origin: 'http://evil.example' },
  }), context);
  assert.equal(untrustedGet.status, 403);

  const trustedGet = await GET(new NextRequest('http://localhost:3200/api/forge-rest/not_a_forge_table', {
    headers: { host: 'localhost:3200', origin: 'http://localhost:3200' },
  }), context);
  assert.equal(trustedGet.status, 404);

  const missingToken = await POST(new NextRequest('http://localhost:3200/api/forge-rest/not_a_forge_table', {
    method: 'POST',
    headers: { host: 'localhost:3200', origin: 'http://localhost:3200', 'content-type': 'application/json' },
    body: '{}',
  }), context);
  assert.equal(missingToken.status, 403);

  const allowedMutation = new NextRequest('http://localhost:3200/api/forge-rest/not_a_forge_table', {
    method: 'POST',
    headers: {
      host: 'localhost:3200',
      origin: 'http://localhost:3200',
      'content-type': 'application/json',
      'x-forge-csrf': 'test-token',
    },
    body: '{}',
  });
  assert.equal(forgeRestMutationAccessFailure(allowedMutation, 'test-token'), undefined);
});
