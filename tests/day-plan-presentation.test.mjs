import assert from 'node:assert/strict';
import test from 'node:test';
import {
  allSettlementDecisionsMade,
  firstCarriedItem,
  moveAnnouncement,
  moveDayPlanItem,
  ownerDescription,
  reorderDayPlanItems,
  selectEssentialItems,
  selectRecommendedHumanFocus,
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

test('Move Up and Move Down reorder only the day plan sequence', () => {
  const original = [item('a', 'me', 0), item('b', 'me', 1), item('c', 'me', 2)];
  const movedUp = moveDayPlanItem(original, 'b', -1);
  const movedDown = moveDayPlanItem(original, 'b', 1);
  assert.deepEqual(movedUp.map((entry) => entry.id), ['b', 'a', 'c']);
  assert.deepEqual(movedUp.map((entry) => entry.position), [0, 1, 2]);
  assert.deepEqual(movedDown.map((entry) => entry.id), ['a', 'c', 'b']);
  assert.deepEqual(movedDown.map((entry) => entry.position), [0, 1, 2]);
  assert.deepEqual(moveDayPlanItem(original, 'a', -1).map((entry) => entry.id), ['a', 'b', 'c']);
  assert.deepEqual(original.map((entry) => entry.id), ['a', 'b', 'c']);
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

test('move announcements include title and the new one-based position', () => {
  assert.equal(
    moveAnnouncement('Prepare the proposal', 1, 3),
    'Prepare the proposal moved to priority 2 of 3.',
  );
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
