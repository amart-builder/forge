import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { assembleMorningBriefContext } from '../src/lib/day-plan/brief.ts';
import { collectMorningBriefSources } from '../src/lib/day-plan/brief-sources.ts';

const NOW = new Date('2026-07-16T12:00:00.000Z');

function fixture(t) {
  const dir = path.join(os.tmpdir(), `forge-brief-sources-${process.pid}-${Date.now()}-${Math.random()}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'goals.md'), 'Grow Edge AI.');
  writeFileSync(path.join(dir, 'operator-profile.md'), 'Alex runs three operating lanes.');
  writeFileSync(path.join(dir, 'leadup.md'), 'This week started with client delivery.');
  writeFileSync(path.join(dir, 'memo.md'), 'Ship the current sprint.');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return {
    dir,
    options: {
      store: { listRecentSnapshots: () => [] },
      goalsPath: path.join(dir, 'goals.md'),
      operatorProfilePath: path.join(dir, 'operator-profile.md'),
      leadupPath: path.join(dir, 'leadup.md'),
      sprintMemoPath: path.join(dir, 'memo.md'),
      dataDir: dir,
      webBaseUrl: 'http://forge.test',
      targetLocalDate: '2026-07-16',
      targetTimezone: 'America/Los_Angeles',
      now: NOW,
    },
  };
}

function setEnv(t, changes) {
  const previous = new Map();
  for (const [name, value] of Object.entries(changes)) {
    previous.set(name, Object.prototype.hasOwnProperty.call(process.env, name) ? process.env[name] : undefined);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  t.after(() => {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
}

function disableExternalSources(t, dir, overrides = {}) {
  setEnv(t, {
    FORGE_BRIEF_COMPOSIO_KEY: '',
    FORGE_BRIEF_COMPOSIO_KEY_PATH: path.join(dir, 'missing-composio-key'),
    ATTIO_API_KEY: '',
    ATTIO_TOKEN: '',
    FORGE_BRIEF_MEMORY_PATH: '',
    FORGE_BRIEF_JARVIS_TOKEN_PATH: path.join(dir, 'missing-jarvis-token'),
    ...overrides,
  });
}

function forgeRowsResponse(url) {
  if (!String(url).startsWith('http://forge.test/api/forge-rest/')) return undefined;
  return new Response(JSON.stringify([]), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function calendarSse(items) {
  const toolText = JSON.stringify({ data: { results: [{ response: { data: { items } } }] } });
  const message = JSON.stringify({
    jsonrpc: '2.0',
    id: 2,
    result: { content: [{ type: 'text', text: toolText }] },
  });
  return `event: message\ndata: {"progress":true}\n\nevent: message\ndata: ${message}\n\nevent: ping\ndata: {"keepalive":true}\n\n`;
}

test('calendar fetches MCP SSE, derives DST-aware bounds, and formats visible events', async (t) => {
  const { dir, options } = fixture(t);
  disableExternalSources(t, dir, { FORGE_BRIEF_COMPOSIO_KEY: 'composio-test-key' });
  const requests = [];
  let initializeResponse;
  const items = [
    {
      summary: 'Strategy call',
      start: { dateTime: '2026-11-01T09:00:00-08:00' },
      end: { dateTime: '2026-11-01T09:30:00-08:00' },
      attendees: [
        { email: 'alex@example.com', self: true, responseStatus: 'accepted' },
        { email: 'one@example.com' },
        { email: 'two@example.com' },
        { email: 'three@example.com' },
        { email: 'four@example.com' },
      ],
      hangoutLink: 'https://meet.google.com/example',
    },
    { summary: 'Planning day', start: { date: '2026-11-01' }, end: { date: '2026-11-02' } },
    {
      summary: 'Malformed time',
      start: { dateTime: 'not-a-date' },
      end: { dateTime: '2026-11-01T10:30:00-08:00' },
    },
    {
      summary: 'Declined event',
      start: { dateTime: '2026-11-01T11:00:00-08:00' },
      end: { dateTime: '2026-11-01T12:00:00-08:00' },
      attendees: [{ email: 'alex@example.com', self: true, responseStatus: 'declined' }],
    },
  ];
  const fetchImpl = async (url, init = {}) => {
    const forge = forgeRowsResponse(url);
    if (forge) return forge;
    requests.push(JSON.parse(init.body));
    assert.ok(init.signal instanceof AbortSignal);
    if (requests.length === 1) {
      initializeResponse = new Response('{"initialized":true}', {
        status: 200,
        headers: { 'mcp-session-id': 'session-1' },
      });
      return initializeResponse;
    }
    return new Response(calendarSse(items), { status: 200, headers: { 'content-type': 'text/event-stream' } });
  };
  const collected = await collectMorningBriefSources({
    ...options,
    targetLocalDate: '2026-11-01',
    now: new Date('2026-11-01T16:00:00.000Z'),
    fetchImpl,
  });
  const calendar = collected.sources.find((source) => source.id === 'calendar');
  assert.equal(
    calendar.content,
    'all day — Planning day\n9:00am-9:30am — Strategy call (with one@example.com, two@example.com, three@example.com) [Meet]\ntime unknown — Malformed time',
  );
  assert.equal(initializeResponse.bodyUsed, true);
  assert.equal(calendar.priority, 7);
  const toolArguments = requests[1].params.arguments.tools[0].arguments;
  assert.equal(toolArguments.timeMin, '2026-11-01T00:00:00-07:00');
  assert.equal(toolArguments.timeMax, '2026-11-02T00:00:00-08:00');
});

test('calendar reports not_configured for a missing key file', async (t) => {
  const { dir, options } = fixture(t);
  disableExternalSources(t, dir);
  const collected = await collectMorningBriefSources({ ...options, fetchImpl: async (url) => forgeRowsResponse(url) });
  const calendar = collected.sources.find((source) => source.id === 'calendar');
  assert.equal(calendar.content, undefined);
  assert.equal(calendar.note, 'not_configured');
});

test('calendar fetch failures stay optional and leave the other sources available', async (t) => {
  const { dir, options } = fixture(t);
  disableExternalSources(t, dir, { FORGE_BRIEF_COMPOSIO_KEY: 'composio-test-key' });
  const fetchImpl = async (url) => {
    const forge = forgeRowsResponse(url);
    if (forge) return forge;
    throw new Error('gateway unavailable');
  };
  const collected = await collectMorningBriefSources({ ...options, fetchImpl });
  assert.match(collected.sources.find((source) => source.id === 'calendar').note, /^error:gateway unavailable/);
  assert.equal(collected.sources.find((source) => source.id === 'goals').content, 'Grow Edge AI.');
  assert.ok(collected.sources.find((source) => source.id === 'task_snapshot').content);
});

test('CRM handles Attio value variants and formats recent and quiet contacts', async (t) => {
  const { dir, options } = fixture(t);
  disableExternalSources(t, dir, { ATTIO_API_KEY: 'attio-test-key' });
  const daysAgo = (days) => new Date(NOW.getTime() - days * 86_400_000).toISOString();
  const records = [
    {
      values: {
        name: [{ full_name: 'Alice Adams' }],
        last_email_interaction: [{ interacted_at: daysAgo(2), interaction_type: 'email' }],
        // Email wins even though the general interaction is newer.
        last_interaction: [{ interacted_at: daysAgo(1), interaction_type: 'meeting' }],
      },
    },
    {
      values: {
        name: [{ first_name: 'Bob', last_name: 'Baker' }],
        last_email_interaction: [{ value: { interacted_at: daysAgo(20), interaction_type: 'email' } }],
      },
    },
    {
      values: {
        name: [{ full_name: 'Cara Cole' }],
        last_email_interaction: [],
        last_interaction: [{ interacted_at: daysAgo(3), interaction_type: 'call' }],
      },
    },
    {
      values: {
        name: [{ full_name: 'Timezone Tina' }],
        last_interaction: [{ interacted_at: '2026-07-14T02:00:00.000Z', interaction_type: 'meeting' }],
      },
    },
    {
      values: {
        name: [],
        email_addresses: [{ value: { email_address: 'fallback@example.com' } }],
        last_interaction: [{ interacted_at: daysAgo(4), interaction_type: 'email' }],
      },
    },
    {
      values: {
        name: [],
        email_addresses: [],
        last_interaction: [{ interacted_at: daysAgo(5), interaction_type: 'call' }],
      },
    },
    {
      values: {
        name: [{ full_name: 'Alex Martin' }],
        email_addresses: [
          { email_address: 'other@example.com' },
          { value: { email_address: 'Alex@JoinEdgeAI.com' } },
        ],
        last_interaction: [{ interacted_at: daysAgo(1), interaction_type: 'email' }],
      },
    },
    {
      values: {
        name: [{ full_name: 'Dormant Dana' }],
        last_email_interaction: [{ interacted_at: daysAgo(121) }],
      },
    },
    { values: { name: [{ full_name: 'No History' }], last_email_interaction: [], last_interaction: [] } },
  ];
  const fetchImpl = async (url, init = {}) => {
    const forge = forgeRowsResponse(url);
    if (forge) return forge;
    assert.equal(String(url), 'https://api.attio.com/v2/objects/people/records/query');
    assert.deepEqual(JSON.parse(init.body), {
      limit: 250,
      sorts: [{ attribute: 'last_interaction', field: 'interacted_at', direction: 'desc' }],
    });
    assert.ok(init.signal instanceof AbortSignal);
    return new Response(JSON.stringify({ data: { data: records } }), { status: 200 });
  };
  const collected = await collectMorningBriefSources({ ...options, fetchImpl });
  const crm = collected.sources.find((source) => source.id === 'crm_last_touch');
  assert.equal(
    crm.content,
    'Recent touches:\nAlice Adams — last touch 2d ago (2026-07-14, email)\nTimezone Tina — last touch 2d ago (2026-07-13, meeting)\nCara Cole — last touch 3d ago (2026-07-13, call)\nfallback@example.com — last touch 4d ago (2026-07-12, email)\nBob Baker — last touch 20d ago (2026-06-26, email)\nDormant Dana — last touch 121d ago (2026-03-17)\n\nGone quiet (>14d): Bob Baker',
  );
  assert.equal(crm.content.includes('fallback@example.com — last touch 4d ago'), true);
  assert.equal(crm.content.includes('Alex Martin'), false);
  assert.equal(crm.priority, 10);
});

test('.env.local strips unquoted inline comments but preserves hashes inside quotes', async (t) => {
  const { dir, options } = fixture(t);
  disableExternalSources(t, dir, { ATTIO_API_KEY: undefined });
  const previousCwd = process.cwd();
  const authorizations = [];
  const fetchImpl = async (url, init = {}) => {
    const forge = forgeRowsResponse(url);
    if (forge) return forge;
    assert.equal(String(url), 'https://api.attio.com/v2/objects/people/records/query');
    authorizations.push(init.headers.Authorization);
    return new Response(JSON.stringify({ data: [] }), { status: 200 });
  };
  try {
    process.chdir(dir);
    writeFileSync(path.join(dir, '.env.local'), 'ATTIO_API_KEY=unquoted-secret # operator note\n');
    await collectMorningBriefSources({ ...options, fetchImpl });
    writeFileSync(path.join(dir, '.env.local'), 'ATTIO_API_KEY="quoted # secret"\n');
    await collectMorningBriefSources({ ...options, fetchImpl });
  } finally {
    process.chdir(previousCwd);
  }
  assert.deepEqual(authorizations, [
    'Bearer unquoted-secret',
    'Bearer quoted # secret',
  ]);
});

test('CRM reports not_configured when neither Attio credential is present', async (t) => {
  const { dir, options } = fixture(t);
  disableExternalSources(t, dir);
  const collected = await collectMorningBriefSources({ ...options, fetchImpl: async (url) => forgeRowsResponse(url) });
  assert.equal(collected.sources.find((source) => source.id === 'crm_last_touch').note, 'not_configured');
});

test('memory decisions prefer decision-tagged Jarvis results and bound each line', async (t) => {
  const { dir, options } = fixture(t);
  const tokenPath = path.join(dir, 'jarvis-token');
  writeFileSync(tokenPath, 'jarvis-test-token\n');
  disableExternalSources(t, dir, { FORGE_BRIEF_JARVIS_TOKEN_PATH: tokenPath });
  const longDecision = `[DECISION] ${'x'.repeat(450)}`;
  const requests = [];
  const resultsByQuery = new Map([
    ['recent decisions, commitments, and direction changes', [
      { uuid: 'long', score: 0.9, content: longDecision },
      { uuid: 'background', score: 0.4, content: 'Background context that should be filtered out.' },
      { uuid: 'forge', score: 0.8, content: '[DECISION] Keep Forge as the command center.' },
    ]],
    ['what Alex worked on in Claude sessions the last three days', [
      { uuid: 'forge', score: 0.95, content: '[DECISION] Keep Forge as the source of truth.' },
      { uuid: 'route', score: 0.7, content: '[DECISION] Route from the latest saved state.' },
    ]],
    ['current state of Jarvis Pro, Boomer AI (Slipstream community), content engine', [
      { uuid: 'jarvis', score: 0.6, content: '[DECISION] Keep Jarvis Pro moving.' },
    ]],
  ]);
  const fetchImpl = async (url, init = {}) => {
    const forge = forgeRowsResponse(url);
    if (forge) return forge;
    assert.equal(String(url), 'http://100.102.6.81:3510/api/v2/scored_search');
    const body = JSON.parse(init.body);
    requests.push(body.query);
    assert.equal(body.limit, 12);
    assert.ok(init.signal instanceof AbortSignal);
    return new Response(JSON.stringify({ results: resultsByQuery.get(body.query) }), { status: 200 });
  };
  const collected = await collectMorningBriefSources({ ...options, fetchImpl });
  const memory = collected.sources.find((source) => source.id === 'memory_decisions');
  const lines = memory.content.split('\n');
  assert.deepEqual(requests, [...resultsByQuery.keys()]);
  assert.equal(lines.length, 4);
  assert.equal(lines[1].length, 402);
  assert.equal(lines.filter((line) => line.includes('Keep Forge')).length, 1);
  assert.equal(memory.content.includes('Background context'), false);
  assert.equal(memory.priority, 11);
});

test('memory decisions preserve file-path mode without calling Jarvis', async (t) => {
  const { dir, options } = fixture(t);
  const memoryPath = path.join(dir, 'decisions.md');
  writeFileSync(memoryPath, '[DECISION] Preserve the file fallback.\n');
  disableExternalSources(t, dir);
  const fetchImpl = async (url) => {
    const forge = forgeRowsResponse(url);
    if (forge) return forge;
    throw new Error(`unexpected network call: ${url}`);
  };
  const collected = await collectMorningBriefSources({ ...options, memoryDecisionsPath: memoryPath, fetchImpl });
  const memory = collected.sources.find((source) => source.id === 'memory_decisions');
  assert.equal(memory.content, '[DECISION] Preserve the file fallback.\n');
  assert.equal(memory.note, memoryPath);
});

test('memory decisions report not_configured when the hub token file is missing', async (t) => {
  const { dir, options } = fixture(t);
  disableExternalSources(t, dir);
  const collected = await collectMorningBriefSources({ ...options, fetchImpl: async (url) => forgeRowsResponse(url) });
  assert.equal(collected.sources.find((source) => source.id === 'memory_decisions').note, 'not_configured');
});

test('memory decisions stop after the first Jarvis search fails', async (t) => {
  const { dir, options } = fixture(t);
  const tokenPath = path.join(dir, 'jarvis-token');
  writeFileSync(tokenPath, 'jarvis-test-token');
  disableExternalSources(t, dir, { FORGE_BRIEF_JARVIS_TOKEN_PATH: tokenPath });
  let searches = 0;
  const collected = await collectMorningBriefSources({
    ...options,
    fetchImpl: async (url) => {
      const forge = forgeRowsResponse(url);
      if (forge) return forge;
      searches += 1;
      throw new Error('Jarvis unavailable');
    },
  });
  const memory = collected.sources.find((source) => source.id === 'memory_decisions');
  assert.equal(searches, 1);
  assert.match(memory.note, /^error:Jarvis unavailable/);
});

test('computed commitments source exposes open loops, clarification, and factual content gaps', async (t) => {
  const { dir, options } = fixture(t);
  disableExternalSources(t, dir);
  const engineDir = path.join(dir, 'supernova-engine');
  const queueDir = path.join(engineDir, 'pipeline', 'queue');
  const postedDir = path.join(engineDir, 'pipeline', 'posted');
  mkdirSync(queueDir, { recursive: true });
  mkdirSync(postedDir, { recursive: true });
  writeFileSync(path.join(queueDir, 'scheduled.md'), [
    '---',
    'status: scheduled',
    'scheduled_for: 2026-07-16T15:00:00Z',
    '---',
  ].join('\n'));
  writeFileSync(path.join(queueDir, 'review.md'), [
    '---',
    'status: review',
    '---',
  ].join('\n'));
  writeFileSync(path.join(postedDir, 'posted.md'), [
    '---',
    'status: scheduled',
    'posted_at: 2026-07-16T18:00:00Z',
    '---',
  ].join('\n'));
  setEnv(t, {
    FORGE_SUPERNOVA_ENGINE_DIR: engineDir,
    FORGE_CONTENT_QUOTA_POSTS: '3',
  });
  const commitments = [
    {
      id: 'follow-1',
      kind: 'follow_up',
      title: 'Send Maya the proposal',
      counterparty: 'Maya',
      source_kind: 'brain_dump',
      source_quote: 'I promised Maya the proposal.',
      due_at: '2026-07-16T17:00:00-07:00',
      review_at: null,
      confidence: 'low',
      confirmed: false,
      status: 'open',
      created_at: '2026-07-01T12:00:00.000Z',
      updated_at: '2026-07-01T12:00:00.000Z',
    },
    {
      id: 'overnight-1',
      kind: 'overnight_request',
      title: 'Draft the FAQ overnight',
      source_kind: 'brain_dump',
      source_quote: 'Draft the FAQ overnight.',
      due_at: null,
      review_at: '2026-07-19T09:00:00-07:00',
      confidence: 'high',
      confirmed: false,
      status: 'open',
      created_at: NOW.toISOString(),
      updated_at: NOW.toISOString(),
    },
  ];
  const fetchImpl = async (url) => {
    if (String(url).includes('/api/forge-rest/commitments')) {
      return new Response(JSON.stringify(commitments), { status: 200 });
    }
    const forge = forgeRowsResponse(url);
    if (forge) return forge;
    throw new Error(`unexpected network call: ${url}`);
  };
  const collected = await collectMorningBriefSources({ ...options, fetchImpl });
  const source = collected.sources.find((entry) => entry.id === 'commitments');
  assert.equal(source.label, 'OPEN_COMMITMENTS_AND_GAPS');
  assert.equal(source.required, false);
  assert.equal(source.maxChars, 4500);
  assert.equal(source.priority, 5);
  assert.equal(source.freshness, 'current');
  assert.match(source.content, /FOLLOW_UP:\n- Send Maya the proposal \| counterparty=Maya/);
  assert.match(source.content, /due_or_review_by_tomorrow/);
  assert.match(source.content, /stale_open_over_7d/);
  assert.match(source.content, /NEEDS CLARIFICATION\n- Send Maya the proposal \| confidence=low \| confirmed=false/);
  assert.match(source.content, /scheduled=1 \| posted=1 \| awaiting_approval=1 \| quota=3 \| gap=1/);
  assert.match(source.content, /Draft the FAQ overnight \| recorded — overnight execution not yet live/);
});

test('real source ids overwrite coverage fallbacks, while failed fetches remain missing', async (t) => {
  const { dir, options } = fixture(t);
  const tokenPath = path.join(dir, 'jarvis-token');
  writeFileSync(tokenPath, 'jarvis-test-token');
  disableExternalSources(t, dir, {
    FORGE_BRIEF_COMPOSIO_KEY: 'composio-test-key',
    ATTIO_API_KEY: 'attio-test-key',
    FORGE_BRIEF_JARVIS_TOKEN_PATH: tokenPath,
  });
  const successFetch = async (url, init = {}) => {
    const forge = forgeRowsResponse(url);
    if (forge) return forge;
    if (String(url).includes('connect.composio.dev')) {
      const body = JSON.parse(init.body);
      if (body.method === 'initialize') {
        return new Response('{}', { status: 200, headers: { 'mcp-session-id': 'session-1' } });
      }
      return new Response(calendarSse([]), { status: 200 });
    }
    if (String(url).includes('api.attio.com')) {
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    }
    return new Response(JSON.stringify({ results: [] }), { status: 200 });
  };
  const included = await collectMorningBriefSources({ ...options, fetchImpl: successFetch });
  assert.deepEqual(
    included.sources.map((source) => [source.id, source.priority]),
    [
      ['goals', 1],
      ['operator_profile', 2],
      ['leadup', 3],
      ['sprint_memo', 4],
      ['commitments', 5],
      ['task_snapshot', 6],
      ['calendar', 7],
      ['settlement_summary', 8],
      ['email_brief', 9],
      ['crm_last_touch', 10],
      ['memory_decisions', 11],
    ],
  );
  assert.deepEqual(
    included.sources
      .filter((source) => source.id === 'operator_profile' || source.id === 'leadup')
      .map(({ id, label, required, maxChars }) => ({ id, label, required, maxChars })),
    [
      { id: 'operator_profile', label: 'OPERATOR_PROFILE', required: false, maxChars: 6000 },
      { id: 'leadup', label: 'LEADUP', required: false, maxChars: 9000 },
    ],
  );
  const includedCoverage = assembleMorningBriefContext(included.sources, { now: NOW }).manifest.coverage;
  assert.equal(includedCoverage.calendar, 'included');
  assert.equal(includedCoverage.crm_last_touch, 'included');
  assert.equal(includedCoverage.memory_decisions, 'included');

  const failedFetch = async (url) => {
    const forge = forgeRowsResponse(url);
    if (forge) return forge;
    throw new Error('network down');
  };
  const failed = await collectMorningBriefSources({ ...options, fetchImpl: failedFetch });
  const failedCoverage = assembleMorningBriefContext(failed.sources, { now: NOW }).manifest.coverage;
  assert.equal(failedCoverage.calendar, 'missing');
  assert.equal(failedCoverage.crm_last_touch, 'missing');
});
