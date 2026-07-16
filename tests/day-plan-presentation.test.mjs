import assert from 'node:assert/strict';
import test from 'node:test';
import {
  allSettlementDecisionsMade,
  claudeResumeUrl,
  combineSurfaceErrors,
  firstCarriedItem,
  executionReadinessMessage,
  executionRunStatusLabel,
  helpfulProjectLabel,
  morningArrivalGreeting,
  ownerDescription,
  reorderDayPlanItems,
  resolveArrivalEscape,
  resolveRitualContentSwap,
  selectBoardExecutionPresentation,
  selectCurrentExecutionRow,
  selectEssentialItems,
  selectRecommendedHumanFocus,
  shortArrivalSummary,
  shouldPollBriefGeneration,
  staleSettlementNotice,
} from '../src/lib/day-plan/presentation.ts';

test('morning arrival greeting follows the plan timezone', () => {
  const timezone = 'America/Los_Angeles';
  assert.equal(morningArrivalGreeting(new Date('2026-07-16T17:00:00.000Z'), timezone), 'Good morning.');
  assert.equal(morningArrivalGreeting(new Date('2026-07-16T21:00:00.000Z'), timezone), 'Good afternoon.');
  assert.equal(morningArrivalGreeting(new Date('2026-07-17T02:00:00.000Z'), timezone), 'Good evening.');
});
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

test('arrival keeps an explicit addition visible beyond the generated three-item cap', () => {
  const addition = {
    ...item('added', 'together', 3),
    sourceRefs: [{ sourceType: 'decision' }],
    rankReasons: ['accepted_today'],
  };
  assert.deepEqual(
    selectEssentialItems([item('a'), item('b'), item('c'), addition]).map((entry) => entry.id),
    ['a', 'b', 'c', 'added'],
  );
});

test('arrival keeps three generated priorities when an explicit addition is reordered into the cap', () => {
  const addition = {
    ...item('added', 'together', 0),
    sourceRefs: [{ sourceType: 'decision' }],
    rankReasons: ['accepted_today'],
  };
  assert.deepEqual(
    selectEssentialItems([addition, item('a'), item('b'), item('c')]).map((entry) => entry.id),
    ['added', 'a', 'b', 'c'],
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

test('execution states use truthful non-completion labels', () => {
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

test('board execution selector drives hero actions and retry-only kickoff visibility', () => {
  assert.deepEqual(
    selectBoardExecutionPresentation({ owner: 'claude' }),
    { action: 'start_plan', showKickoff: true, reviewable: false },
  );
  assert.deepEqual(
    selectBoardExecutionPresentation({ owner: 'me' }),
    { action: 'none', showKickoff: false, reviewable: false },
  );

  for (const status of ['failed', 'interrupted', 'cancelled']) {
    assert.deepEqual(
      selectBoardExecutionPresentation({ owner: 'claude', run: run({ status }) }),
      {
        statusLabel: 'Failed · Retry',
        action: 'retry',
        showKickoff: true,
        reviewable: false,
      },
      status,
    );
  }

  for (const [status, statusLabel] of [
    ['queued', 'Claude · queued'],
    ['starting', 'Claude · working'],
    ['running', 'Claude · working'],
  ]) {
    const presentation = selectBoardExecutionPresentation({ owner: 'together', run: run({ status }) });
    assert.equal(presentation.statusLabel, statusLabel, status);
    assert.equal(presentation.action, 'open', status);
    assert.equal(presentation.showKickoff, false, status);
  }

  for (const status of ['plan_ready', 'ready_to_join', 'awaiting_review']) {
    const presentation = selectBoardExecutionPresentation({ owner: 'claude', run: run({ status }) });
    assert.equal(presentation.statusLabel, 'Plan ready · Review', status);
    assert.equal(presentation.action, 'open', status);
    assert.equal(presentation.reviewable, true, status);
    assert.equal(presentation.showKickoff, false, status);
  }

  assert.deepEqual(
    selectBoardExecutionPresentation({ owner: 'claude', run: run(), taskDone: true }),
    { statusLabel: 'Done', action: 'none', showKickoff: false, reviewable: false },
  );
});

test('brief-generation poll runs only on a visible, untouched arrival while writing', () => {
  const base = {
    view: 'arrival',
    documentVisible: true,
    interacted: false,
    hasConsumedBrief: false,
    generationState: 'running',
  };
  assert.equal(shouldPollBriefGeneration(base), true);
  assert.equal(shouldPollBriefGeneration({ ...base, generationState: 'queued' }), true);
  // The gate closes on every off condition.
  assert.equal(shouldPollBriefGeneration({ ...base, view: 'none' }), false);
  assert.equal(shouldPollBriefGeneration({ ...base, documentVisible: false }), false);
  assert.equal(shouldPollBriefGeneration({ ...base, interacted: true }), false);
  assert.equal(shouldPollBriefGeneration({ ...base, hasConsumedBrief: true }), false);
  // A resolved generation stops the poll: nothing is being written.
  assert.equal(shouldPollBriefGeneration({ ...base, generationState: 'failed' }), false);
  assert.equal(shouldPollBriefGeneration({ ...base, generationState: 'idle' }), false);
  assert.equal(shouldPollBriefGeneration({ ...base, generationState: undefined }), false);
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
    resolveRitualContentSwap({ displayedKey: 'arrival', nextKey: 'settlement', reducedMotion: false }),
    'crossfade',
  );
  assert.equal(
    resolveRitualContentSwap({ displayedKey: 'arrival', nextKey: 'settlement', reducedMotion: true }),
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
