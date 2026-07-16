import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import {
  BUDDY_DATA_ALLOWED_TOOL,
  BUDDY_DATA_CD_ALLOWED_TOOL,
  BUDDY_HOME,
  buildBuddyCompactionSummaryCommand,
  buildBuddyHandoffSeedCommand,
  buildBuddyTurnCommand,
} from '../src/lib/buddy/commands.ts';

test('new Buddy commands use a bounded read-only Claude session and contextual stdin', () => {
  const command = buildBuddyTurnCommand({
    headSessionId: null,
    newSessionId: 'new-session',
    model: 'sonnet',
    effort: 'low',
    userText: 'Hello',
    pageContext: { view: 'tasks' },
    now: new Date('2026-07-16T00:00:00.000Z'),
  });
  assert.equal(command.cwd, BUDDY_HOME);
  assert.equal(command.args.at(0), '-p');
  assert.ok(command.args.includes('--include-partial-messages'));
  assert.ok(command.args.includes('--disable-slash-commands'));
  assert.deepEqual(command.args.slice(command.args.indexOf('--tools'), command.args.indexOf('--tools') + 2), ['--tools', 'Read,Grep,Glob,Bash']);
  assert.deepEqual(command.args.slice(command.args.indexOf('--allowedTools'), command.args.indexOf('--allowedTools') + 3),
    ['--allowedTools', BUDDY_DATA_ALLOWED_TOOL, BUDDY_DATA_CD_ALLOWED_TOOL]);
  assert.deepEqual(command.args.slice(command.args.indexOf('--permission-mode'), command.args.indexOf('--permission-mode') + 2), ['--permission-mode', 'dontAsk']);
  assert.deepEqual(command.args.slice(-2), ['--session-id', 'new-session']);
  assert.ok(command.args.includes(path.join(process.cwd(), 'scripts/forge-empty-mcp.json')));
  assert.match(command.stdin, /^PAGE_CONTEXT: {"view":"tasks"}\nNOW: /);
  assert.match(command.stdin, /\n\nHello$/);
});

test('continued Buddy commands resume the saved head', () => {
  const command = buildBuddyTurnCommand({
    headSessionId: 'head-session', newSessionId: 'unused', model: 'opus', effort: 'high',
  });
  assert.deepEqual(command.args.slice(-2), ['--resume', 'head-session']);
  assert.equal(command.args.includes('--session-id'), false);
});

test('Morning Arrival page context is preserved in the Buddy prompt header', () => {
  const command = buildBuddyTurnCommand({
    headSessionId: null,
    newSessionId: 'arrival-session',
    model: 'sonnet',
    effort: 'low',
    pageContext: {
      view: 'morning-arrival', step: 'priorities', planId: 'plan-1', planVersion: 7,
    },
  });
  assert.match(command.stdin,
    /^PAGE_CONTEXT: {"view":"morning-arrival","step":"priorities","planId":"plan-1","planVersion":7}/);
});

test('compaction commands are tool-free and capped at twenty-five cents', () => {
  const summary = buildBuddyCompactionSummaryCommand('old-head');
  const seed = buildBuddyHandoffSeedCommand({ newSessionId: 'fresh-head', summary: 'Keep this context.' });
  for (const command of [summary, seed]) {
    assert.deepEqual(command.args.slice(command.args.indexOf('--tools'), command.args.indexOf('--tools') + 2), [
      '--tools', '',
    ]);
    assert.deepEqual(command.args.slice(
      command.args.indexOf('--max-budget-usd'), command.args.indexOf('--max-budget-usd') + 2,
    ), ['--max-budget-usd', '0.25']);
  }
  assert.deepEqual(summary.args.slice(-2), ['--resume', 'old-head']);
  assert.deepEqual(seed.args.slice(-2), ['--session-id', 'fresh-head']);
  assert.match(seed.stdin, /HANDOFF_SUMMARY:\nKeep this context\./);
});
