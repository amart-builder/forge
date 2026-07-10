import type {
  DayPlanAssistantTurn,
  DayPlanExecutionReadiness,
  DayPlanExecutionRunStatus,
  DayPlanItem,
  DayPlanOwner as DayOwner,
  SettlementDisposition,
} from './types';

export type SettlementDecision = SettlementDisposition;

function withNormalizedPositions<T extends DayPlanItem>(items: readonly T[]): T[] {
  return items.map((item, position) => ({ ...item, position }));
}

const OWNER_LABELS: Record<DayOwner, string> = {
  me: 'Me',
  claude: 'Claude',
  together: 'Together',
};

const OWNER_DESCRIPTIONS: Record<DayOwner, string> = {
  me: 'This needs your judgment or direct action.',
  claude: 'Planned for Claude. Execution has not started.',
  together: 'You and Claude will work through this together. Execution has not started.',
};

const NON_PROJECT_TAGS = new Set([
  'blocked',
  'captured-today',
  'email',
  'high',
  'jarvis-held',
  'low',
  'medium',
  'today',
  'urgent',
]);

export function shortArrivalSummary(value: string | undefined, title?: string): string | undefined {
  const cleaned = value?.replace(/\s+/g, ' ').trim();
  if (!cleaned || cleaned.toLocaleLowerCase() === title?.trim().toLocaleLowerCase()) {
    return undefined;
  }

  const maximum = 96;
  const firstSentence = cleaned.match(/^.*?[.!?](?:\s|$)/)?.[0]?.trim() ?? cleaned;
  if (firstSentence.length <= maximum) return firstSentence;

  const bounded = firstSentence.slice(0, maximum - 1);
  const lastSpace = bounded.lastIndexOf(' ');
  return `${bounded.slice(0, lastSpace > maximum * 0.6 ? lastSpace : bounded.length).trimEnd()}…`;
}

export function helpfulProjectLabel(value: string | undefined): string | undefined {
  const cleaned = value?.replace(/\s+/g, ' ').trim();
  if (!cleaned || cleaned.length > 32 || NON_PROJECT_TAGS.has(cleaned.toLocaleLowerCase())) {
    return undefined;
  }
  return cleaned;
}

export function assistantTurnStatusLabel(turn: DayPlanAssistantTurn): string {
  if (turn.state === 'queued') return 'Queued';
  if (turn.state === 'running') return 'Claude is working';
  if (turn.state === 'applied') return 'Applied';
  if (turn.state === 'proposed' && turn.proposal?.needsClarification) {
    return 'Clarification needed';
  }
  if (turn.state === 'proposed') return 'Ready to review';
  if (turn.state === 'conflict') return 'Plan changed before this could apply';
  if (turn.state === 'cancelled') return 'Cancelled';
  return 'Error';
}

export function executionRunStatusLabel(status: DayPlanExecutionRunStatus): string {
  if (status === 'queued') return 'Queued';
  if (status === 'starting' || status === 'running') return 'Claude is working';
  if (status === 'plan_ready') return 'Plan ready';
  if (status === 'ready_to_join') return 'Ready to join';
  if (status === 'awaiting_review') return 'Awaiting review';
  if (status === 'cancelling') return 'Cancelling';
  if (status === 'failed') return 'Failed';
  return 'Interrupted';
}

export function executionReadinessMessage(
  readiness: DayPlanExecutionReadiness | undefined,
  owner: DayOwner,
): string {
  if (owner === 'me') return 'Choose Claude or Together before selecting an execution mode.';
  if (
    !readiness ||
    readiness.codes.includes('mode_required') ||
    readiness.codes.includes('owner_not_agent')
  ) {
    return owner === 'together'
      ? 'Choose Plan with Claude before kickoff.'
      : 'Choose Plan with Claude or Autonomous before kickoff.';
  }
  if (readiness.ready) return 'Ready to queue.';
  if (readiness.codes.includes('brief_changed')) {
    return 'The brief changed. Choose a mode again to refresh it.';
  }
  if (readiness.codes.includes('together_requires_plan_review')) {
    return 'Together can only use Plan with Claude.';
  }
  if (readiness.codes.includes('execution_disabled')) {
    return 'Autonomous work is not enabled on this Forge setup.';
  }
  if (readiness.codes.includes('definition_of_done_required')) {
    return 'Add a definition of done before autonomous kickoff.';
  }
  if (
    readiness.codes.includes('workspace_required') ||
    readiness.codes.includes('workspace_not_allowlisted') ||
    readiness.codes.includes('workspace_missing') ||
    readiness.codes.includes('workspace_not_git')
  ) {
    return 'This task is not linked to an approved project for autonomous work.';
  }
  if (readiness.codes.includes('workspace_dirty')) {
    return 'The approved project has uncommitted changes, so autonomous work is paused.';
  }
  if (readiness.codes.includes('project_not_opted_in')) {
    return 'This project has not opted into autonomous work.';
  }
  if (
    readiness.codes.includes('budget_required') ||
    readiness.codes.includes('budget_exceeds_limit')
  ) {
    return 'Autonomous budget setup is incomplete.';
  }
  return 'This brief needs more context before kickoff.';
}

export function ownerLabel(owner: DayOwner): string {
  return OWNER_LABELS[owner];
}

export function ownerDescription(owner: DayOwner): string {
  return OWNER_DESCRIPTIONS[owner];
}

export function selectEssentialItems<T extends DayPlanItem>(
  items: readonly T[],
  maximum = 3,
): T[] {
  return items.slice(0, Math.max(0, maximum));
}

export function reorderDayPlanItems<T extends DayPlanItem>(
  items: readonly T[],
  activeId: string,
  overId: string,
): T[] {
  const activeIndex = items.findIndex((item) => item.id === activeId);
  const overIndex = items.findIndex((item) => item.id === overId);
  if (activeIndex < 0 || overIndex < 0 || activeIndex === overIndex) return [...items];

  const next = [...items];
  const [active] = next.splice(activeIndex, 1);
  next.splice(overIndex, 0, active);
  return withNormalizedPositions(next);
}

export function selectRecommendedHumanFocus<T extends DayPlanItem>(
  items: readonly T[],
  preferredItemId?: string,
): T | undefined {
  const preferred = preferredItemId
    ? items.find((item) => item.id === preferredItemId)
    : undefined;

  if (preferred && preferred.owner !== 'claude') return preferred;
  return items.find((item) => item.owner !== 'claude') ?? preferred ?? items[0];
}

export function firstCarriedItem<T extends DayPlanItem>(
  items: readonly T[],
  decisions: Readonly<Record<string, SettlementDecision | undefined>>,
): T | undefined {
  return items.find((item) => decisions[item.id] === 'carry');
}

export function allSettlementDecisionsMade<T extends DayPlanItem>(
  items: readonly T[],
  decisions: Readonly<Record<string, SettlementDecision | undefined>>,
): boolean {
  return items.every((item) => Boolean(decisions[item.id]));
}

export function combineSurfaceErrors(...errors: Array<string | undefined>): string | undefined {
  const messages = [...new Set(errors.map((error) => error?.trim()).filter(Boolean))];
  return messages.length > 0 ? messages.join(' ') : undefined;
}
