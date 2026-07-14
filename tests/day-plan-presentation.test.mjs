import assert from 'node:assert/strict';
import test from 'node:test';
import {
  allSettlementDecisionsMade,
  assistantTurnStatusLabel,
  claudeResumeUrl,
  combineSurfaceErrors,
  firstCarriedItem,
  executionReadinessMessage,
  executionRunStatusLabel,
  hasAgentOwnedAcceptedWork,
  helpfulProjectLabel,
  isRetryableRunStatus,
  ownerDescription,
  reorderDayPlanItems,
  resolveArrivalEscape,
  resolveRitualContentSwap,
  selectCurrentExecutionRow,
  selectEssentialItems,
  selectRecommendedHumanFocus,
  selectStartedExecutionRows,
  shortArrivalSummary,
  shouldKeepStartedView,
  staleSettlementNotice,
} from '../src/lib/day-plan/presentation.ts';
import {
  planTaskReconciliation,
  reconciliationStateMatches,
} from '../src/lib/day-plan/reconciliation.ts';

function item(id, owner = 'me', position = 0) {
  return { id, taskId: `task-${id}`, owner, position };
}

test('arrival shows no more than three real plan items without padding', () => {
  const two = [item('a'), item('b')];
  assert.deepEqual(selectEssentialItems(two).map((entry) => entry.id), ['a', 'b']);
  assert.deepEqual(
    selectEssentialItems([...two, item('c'), item('d')]).map((entry) => entry.id),
    ['a', 'b', 'c'],
  );
});

test('drag reorder produces the same ordered plan without mutating input', () => {
  const original = [item('a', 'me', 0), item('b', 'me', 1), item('c', 'me', 2)];
  const reordered = reorderDayPlanItems(original, 'c', 'a');
  assert.deepEqual(reordered.map((entry) => entry.id), ['c', 'a', 'b']);
  assert.deepEqual(reordered.map((entry) => entry.position), [0, 1, 2]);
  assert.deepEqual(original.map((entry) => entry.id), ['a', 'b', 'c']);
  assert.deepEqual(original.map((entry) => entry.position), [0, 1, 2]);
});

test('recommended focus is the highest ordered item involving the person', () => {
  const items = [item('claude', 'claude'), item('together', 'together'), item('me', 'me')];
  assert.equal(selectRecommendedHumanFocus(items)?.id, 'together');
  assert.equal(selectRecommendedHumanFocus(items, 'me')?.id, 'me');
});

test('an all-Claude plan still yields one deterministic handoff-preparation focus', () => {
  const items = [item('first', 'claude'), item('second', 'claude')];
  assert.equal(selectRecommendedHumanFocus(items)?.id, 'first');
  assert.match(ownerDescription('claude'), /Execution has not started\./);
});

test('settlement derives tomorrow from the first carried item', () => {
  const items = [item('a'), item('b'), item('c')];
  const decisions = { a: 'defer', b: 'carry', c: 'drop' };
  assert.equal(firstCarriedItem(items, decisions)?.id, 'b');
  assert.equal(allSettlementDecisionsMade(items, decisions), true);
  assert.equal(allSettlementDecisionsMade(items, { a: 'carry' }), false);
});

test('arrival summaries stay genuinely short while preserving the stored description elsewhere', () => {
  const description = 'Review the complete client proposal, resolve the open pricing question, and prepare the final version for the decision meeting tomorrow morning.';
  const summary = shortArrivalSummary(description, 'Finalize the proposal');
  assert.ok(summary);
  assert.ok(summary.length <= 96);
  assert.match(summary, /…$/);
  assert.equal(shortArrivalSummary('Finalize the proposal', 'Finalize the proposal'), undefined);
});

test('project pills suppress operational tags and overlong labels', () => {
  assert.equal(helpfulProjectLabel('Catalyst'), 'Catalyst');
  assert.equal(helpfulProjectLabel('captured-today'), undefined);
  assert.equal(helpfulProjectLabel('x'.repeat(33)), undefined);
});

test('assistant and execution states use truthful non-completion labels', () => {
  assert.equal(assistantTurnStatusLabel({ state: 'queued' }), 'Queued');
  assert.equal(
    assistantTurnStatusLabel({
      state: 'proposed',
      proposal: { needsClarification: true, assistantText: 'Which client?', operations: [] },
    }),
    'Clarification needed',
  );
  assert.equal(executionRunStatusLabel('running'), 'Claude is working');
  assert.equal(executionRunStatusLabel('plan_ready'), 'Plan ready');
  assert.equal(executionRunStatusLabel('awaiting_review'), 'Awaiting review');
  assert.equal(executionRunStatusLabel('cancelling'), 'Cancelling');
  assert.notEqual(executionRunStatusLabel('plan_ready'), 'Completed');
});

test('readiness copy explains mode and brief resets without exposing paths', () => {
  assert.equal(
    executionReadinessMessage({ ready: false, codes: ['mode_required'], checkedAt: '' }, 'claude'),
    'Choose Plan with Claude or Autonomous before kickoff.',
  );
  assert.equal(
    executionReadinessMessage({ ready: false, codes: ['owner_not_agent'], checkedAt: '' }, 'claude'),
    'Choose Plan with Claude or Autonomous before kickoff.',
  );
  assert.equal(
    executionReadinessMessage({ ready: false, codes: ['brief_changed'], checkedAt: '' }, 'together'),
    'The brief changed. Choose a mode again to refresh it.',
  );
  const workspaceCopy = executionReadinessMessage({
    ready: false,
    codes: ['workspace_dirty'],
    checkedAt: '',
    workspacePath: '/secret/client/repo',
  }, 'claude');
  assert.equal(workspaceCopy.includes('/secret'), false);
});

test('an overdue defer is applied before its resurface against updated task state', () => {
  const columns = { notStartedId: 'not-started', todayId: 'today' };
  let state = { columnId: 'today', status: 'open' };

  const deferred = planTaskReconciliation('defer', state, columns);
  assert.deepEqual(deferred.patch, { columnId: 'not-started', status: 'open' });
  state = deferred.nextState;
  assert.equal(reconciliationStateMatches(state, deferred.nextState), true);

  const resurfaced = planTaskReconciliation('resurface', state, columns);
  assert.deepEqual(resurfaced.patch, { columnId: 'today', status: 'open' });
  state = resurfaced.nextState;
  assert.equal(reconciliationStateMatches(state, resurfaced.nextState), true);
});

function run(overrides = {}) {
  return {
    id: 'run-1',
    itemId: 'item-a',
    briefHash: 'brief-1',
    authorizationHash: 'auth-1',
    mode: 'plan_review',
    status: 'queued',
    createdAt: '2026-07-10T16:00:00.000Z',
    claudeSessionId: '00000000-0000-4000-8000-000000000000',
    ...overrides,
  };
}

function config(overrides = {}) {
  return { briefHash: 'brief-1', authorizationHash: 'auth-1', mode: 'plan_review', ...overrides };
}

function acceptedItem(id, owner, position = 0) {
  return { id, taskId: `task-${id}`, title: `Task ${id}`, owner, position, decision: 'accepted', outcome: '' };
}

test('current execution row takes the latest attempt only when brief, authorization, and mode still match', () => {
  const older = run({ id: 'old', createdAt: '2026-07-10T15:00:00.000Z' });
  const newer = run({ id: 'new', createdAt: '2026-07-10T16:00:00.000Z' });
  const other = run({ id: 'other-item', itemId: 'item-b' });
  const matched = selectCurrentExecutionRow([older, newer, other], 'item-a', config());
  assert.equal(matched.latestRun.id, 'new');
  assert.equal(matched.currentRun.id, 'new');

  // A drifted brief makes the latest run stale, so it is never surfaced as current.
  const stale = selectCurrentExecutionRow([newer], 'item-a', config({ briefHash: 'brief-2' }));
  assert.equal(stale.latestRun.id, 'new');
  assert.equal(stale.currentRun, undefined);

  assert.equal(selectCurrentExecutionRow([newer], 'item-a', undefined).currentRun, undefined);
});

test('started rows cover only accepted agent work and flag unready items as needing setup', () => {
  const items = [
    acceptedItem('a', 'claude', 0),
    acceptedItem('b', 'together', 1),
    acceptedItem('c', 'me', 2),
    { ...acceptedItem('d', 'claude', 3), decision: 'dismissed' },
  ];
  const executionItems = [
    { itemId: 'a', config: config(), readiness: { ready: true, codes: ['ready'], checkedAt: '' } },
    { itemId: 'b', config: undefined, readiness: { ready: false, codes: ['workspace_required'], checkedAt: '' } },
  ];
  const runs = [run({ id: 'run-a', itemId: 'a', status: 'running' })];
  const rows = selectStartedExecutionRows(items, executionItems, runs);
  assert.deepEqual(rows.map((row) => row.item.id), ['a', 'b']);
  assert.equal(rows[0].needsSetup, false);
  assert.equal(rows[0].currentRun.status, 'running');
  assert.equal(rows[0].retryable, false);
  assert.equal(rows[1].needsSetup, true);
  assert.equal(rows[1].currentRun, undefined);
  assert.equal(rows[1].retryable, false);
});

test('a terminal current run marks the row retryable instead of blocking a new attempt', () => {
  const items = [acceptedItem('a', 'claude', 0)];
  const executionItems = [
    { itemId: 'a', config: config(), readiness: { ready: true, codes: ['ready'], checkedAt: '' } },
  ];
  for (const status of ['failed', 'interrupted', 'cancelled']) {
    const rows = selectStartedExecutionRows(items, executionItems, [
      run({ id: `run-${status}`, itemId: 'a', status }),
    ]);
    assert.equal(rows[0].needsSetup, false, status);
    assert.equal(rows[0].currentRun.status, status);
    assert.equal(rows[0].retryable, true, status);
  }
  for (const status of ['queued', 'starting', 'running', 'cancelling', 'plan_ready', 'ready_to_join', 'awaiting_review']) {
    const rows = selectStartedExecutionRows(items, executionItems, [
      run({ id: `run-${status}`, itemId: 'a', status }),
    ]);
    assert.equal(rows[0].retryable, false, status);
    assert.equal(isRetryableRunStatus(status), false, status);
  }
});

test('the started view survives accepted responses while the day stays active', () => {
  // Configure/kickoff round-trips keep an active plan inferring 'none': stay on started.
  assert.equal(shouldKeepStartedView('started', 'none', 'active'), true);
  // Real transitions still win: settlement opens, or the plan leaves active.
  assert.equal(shouldKeepStartedView('started', 'settlement', 'settling'), false);
  assert.equal(shouldKeepStartedView('started', 'none', 'settled'), false);
  assert.equal(shouldKeepStartedView('started', 'arrival', 'proposed'), false);
  // Other views never hijack the inferred view.
  assert.equal(shouldKeepStartedView('arrival', 'none', 'active'), false);
  assert.equal(shouldKeepStartedView('none', 'none', 'active'), false);
});

test('the started view opens only when accepted agent work exists', () => {
  assert.equal(hasAgentOwnedAcceptedWork([acceptedItem('a', 'claude')]), true);
  assert.equal(hasAgentOwnedAcceptedWork([acceptedItem('a', 'me')]), false);
  assert.equal(
    hasAgentOwnedAcceptedWork([{ ...acceptedItem('a', 'claude'), decision: 'later' }]),
    false,
  );
});

test('claude resume deep link encodes the session id', () => {
  assert.equal(
    claudeResumeUrl('00000000-0000-4000-8000-000000000000'),
    'claude://resume?session=00000000-0000-4000-8000-000000000000',
  );
  assert.equal(claudeResumeUrl('a b/c'), 'claude://resume?session=a%20b%2Fc');
});

test('escape collapses an expanded card and otherwise does nothing, never bypassing', () => {
  assert.deepEqual(
    resolveArrivalEscape({ dragging: false, expandedItemId: 'item-a' }),
    { type: 'collapse', itemId: 'item-a' },
  );
  assert.deepEqual(resolveArrivalEscape({ dragging: false, expandedItemId: null }), { type: 'none' });
  assert.deepEqual(resolveArrivalEscape({ dragging: true, expandedItemId: 'item-a' }), { type: 'none' });
});

test('ritual view swaps crossfade, cut immediately under reduced motion, and skip no-ops', () => {
  assert.equal(
    resolveRitualContentSwap({ displayedKey: 'arrival', nextKey: 'arrival', reducedMotion: false }),
    'none',
  );
  assert.equal(
    resolveRitualContentSwap({ displayedKey: 'arrival', nextKey: 'arrival', reducedMotion: true }),
    'none',
  );
  assert.equal(
    resolveRitualContentSwap({ displayedKey: 'arrival', nextKey: 'started', reducedMotion: false }),
    'crossfade',
  );
  assert.equal(
    resolveRitualContentSwap({ displayedKey: 'arrival', nextKey: 'started', reducedMotion: true }),
    'immediate',
  );
});

test('settlement explains itself only when the plan being closed is not today', () => {
  assert.equal(staleSettlementNotice('2026-07-14', '2026-07-14'), undefined);
  assert.equal(
    staleSettlementNotice('2026-07-11', '2026-07-14'),
    "July 11 was never closed. Settle it before today's plan begins.",
  );
});

test('ritual and secondary surface failures remain visible together', () => {
  assert.equal(
    combineSurfaceErrors('Morning Arrival could not load.', 'Suggestions are unavailable.'),
    'Morning Arrival could not load. Suggestions are unavailable.',
  );
  assert.equal(
    combineSurfaceErrors('Morning Arrival could not load.', 'Morning Arrival could not load.'),
    'Morning Arrival could not load.',
  );
});
