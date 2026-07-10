import assert from 'node:assert/strict';
import test from 'node:test';
import {
  allSettlementDecisionsMade,
  assistantTurnStatusLabel,
  combineSurfaceErrors,
  firstCarriedItem,
  executionReadinessMessage,
  executionRunStatusLabel,
  helpfulProjectLabel,
  ownerDescription,
  reorderDayPlanItems,
  selectEssentialItems,
  selectRecommendedHumanFocus,
  shortArrivalSummary,
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
