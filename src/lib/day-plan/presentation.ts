import type {
  DayPlanExecutionConfig,
  DayPlanExecutionReadiness,
  DayPlanExecutionRun,
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

export function morningArrivalGreeting(date: Date, timezone: string): string {
  const hourPart = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    hourCycle: 'h23',
    timeZone: timezone,
  }).formatToParts(date).find((part) => part.type === 'hour')?.value;
  const hour = Number(hourPart);
  if (hour < 12) return 'Good morning.';
  if (hour < 17) return 'Good afternoon.';
  return 'Good evening.';
}

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
  const limit = Math.max(0, maximum);
  const isExplicitArrivalAddition = (item: T) =>
    item.sourceRefs?.some((source) => source.sourceType === 'decision') &&
    item.rankReasons?.includes('accepted_today');
  const essentialIds = new Set(
    items
      .filter((item) => !isExplicitArrivalAddition(item))
      .slice(0, limit)
      .map((item) => item.id),
  );
  return items.filter(
    (item) => essentialIds.has(item.id) || isExplicitArrivalAddition(item),
  );
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

export type CurrentExecutionRow = {
  latestRun?: DayPlanExecutionRun;
  currentRun?: DayPlanExecutionRun;
};

// Shared, pure "current execution row" selector. Applies the latest-attempt rule
// (newest createdAt for the item) and the brief/authorization/mode hash match, so a
// run whose brief or authorization drifted from the saved config is never treated as
// current. Reused by the board's hero and downstream execution indicators.
export function selectCurrentExecutionRow(
  runs: readonly DayPlanExecutionRun[],
  itemId: string,
  config: DayPlanExecutionConfig | undefined,
): CurrentExecutionRow {
  const latestRun = [...runs]
    .filter((run) => run.itemId === itemId)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
  const currentRun = latestRun && config &&
    latestRun.briefHash === config.briefHash &&
    latestRun.authorizationHash === config.authorizationHash &&
    latestRun.mode === config.mode
    ? latestRun
    : undefined;
  return { latestRun, currentRun };
}

const RETRYABLE_RUN_STATUSES = new Set<DayPlanExecutionRunStatus>([
  'failed',
  'interrupted',
  'cancelled',
]);

// Terminal statuses the store explicitly supports retrying with a fresh attempt under
// the same current authorization. A run in one of these states must not block kickoff.
export function isRetryableRunStatus(status: DayPlanExecutionRunStatus): boolean {
  return RETRYABLE_RUN_STATUSES.has(status);
}

export type BoardExecutionPresentation = {
  statusLabel?: string;
  action: 'none' | 'open' | 'start_plan' | 'retry';
  showKickoff: boolean;
  reviewable: boolean;
};

export function selectBoardExecutionPresentation(input: {
  owner: DayOwner;
  run?: DayPlanExecutionRun;
  taskDone?: boolean;
}): BoardExecutionPresentation {
  if (input.taskDone) {
    return { statusLabel: 'Done', action: 'none', showKickoff: false, reviewable: false };
  }
  const run = input.run;
  if (!run) {
    return input.owner === 'claude' || input.owner === 'together'
      ? { action: 'start_plan', showKickoff: true, reviewable: false }
      : { action: 'none', showKickoff: false, reviewable: false };
  }
  if (isRetryableRunStatus(run.status)) {
    return {
      statusLabel: 'Failed · Retry',
      action: 'retry',
      showKickoff: true,
      reviewable: false,
    };
  }
  if (
    run.status === 'plan_ready' ||
    run.status === 'ready_to_join' ||
    run.status === 'awaiting_review'
  ) {
    return {
      statusLabel: 'Plan ready · Review',
      action: run.claudeSessionId ? 'open' : 'none',
      showKickoff: false,
      reviewable: Boolean(run.claudeSessionId),
    };
  }
  if (run.status === 'queued') {
    return {
      statusLabel: 'Claude · queued',
      action: run.claudeSessionId ? 'open' : 'none',
      showKickoff: false,
      reviewable: false,
    };
  }
  if (run.status === 'starting' || run.status === 'running') {
    return {
      statusLabel: 'Claude · working',
      action: run.claudeSessionId ? 'open' : 'none',
      showKickoff: false,
      reviewable: false,
    };
  }
  return {
    statusLabel: 'Claude · cancelling',
    action: 'none',
    showKickoff: false,
    reviewable: false,
  };
}

// Deep-link that asks the Claude desktop app to import and resume a CLI session.
export function claudeResumeUrl(sessionId: string): string {
  return `claude://resume?session=${encodeURIComponent(sessionId)}`;
}

export type RitualContentSwapDecision = 'none' | 'immediate' | 'crossfade';

// Pure decision for swapping ritual content inside the one mounted DayRitualLayer.
// Same view: nothing to do. Reduced motion: swap in place with no exit/enter motion.
// Otherwise: fade the outgoing content quickly, then let the incoming content arrive.
export function resolveRitualContentSwap(input: {
  displayedKey: string;
  nextKey: string;
  reducedMotion: boolean;
}): RitualContentSwapDecision {
  if (input.displayedKey === input.nextKey) return 'none';
  return input.reducedMotion ? 'immediate' : 'crossfade';
}

// One plain line explaining why Day Settlement is showing a date that is not today
// (a missed prior-day settlement). Today's own settlement gets no extra line.
export function staleSettlementNotice(
  planLocalDate: string,
  todayLocalDate: string,
): string | undefined {
  if (planLocalDate === todayLocalDate) return undefined;
  const label = new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${planLocalDate}T12:00:00.000Z`));
  return `${label} was never closed. Settle it before today's plan begins.`;
}

// Pure gate for polling the day-plan read model to pick up a brief that finishes
// generating after the arrival opened. Poll only while the arrival view is open,
// the document is visible, the user has not interacted (the no-hot-swap rule: a
// touched arrival never accepts a late brief), no brief is consumed yet, and a
// generation is actually queued or running. Any of those failing stops polling.
export function shouldPollBriefGeneration(input: {
  view: string;
  documentVisible: boolean;
  interacted: boolean;
  hasConsumedBrief: boolean;
  generationState?: 'idle' | 'queued' | 'running' | 'failed';
}): boolean {
  if (input.view !== 'arrival') return false;
  if (!input.documentVisible) return false;
  if (input.interacted) return false;
  if (input.hasConsumedBrief) return false;
  return input.generationState === 'queued' || input.generationState === 'running';
}

// Pure gate for the ONE-SHOT attach-only ensure fired at initialization and on
// regaining document visibility. It covers the relay's primary case, which the
// generation poll above cannot: a brief that finished while the app was closed
// leaves the plan without a brief and NO queued/running generation, so nothing
// would ever ask the server to run its guarded late-attach. Fires only for a
// pristine, proposed, due/opened arrival with fresh candidates, at most once
// per page load or visibility regain (alreadyAttempted); the durable
// arrival_interacted_at marker or any local interaction closes it for good.
export function shouldAttemptLateBriefAttach(input: {
  planState?: string;
  arrivalState?: string;
  hasConsumedBrief: boolean;
  arrivalInteractedAt?: string;
  interacted: boolean;
  documentVisible: boolean;
  candidatesReady: boolean;
  candidateCount: number;
  alreadyAttempted: boolean;
}): boolean {
  if (input.alreadyAttempted) return false;
  if (!input.documentVisible) return false;
  if (input.planState !== 'proposed') return false;
  if (input.arrivalState !== 'due' && input.arrivalState !== 'opened') return false;
  if (input.hasConsumedBrief) return false;
  if (input.arrivalInteractedAt) return false;
  if (input.interacted) return false;
  // Never ask the server to overlay onto missing/stale evidence.
  return input.candidatesReady && input.candidateCount > 0;
}

export type ArrivalEscapeDecision =
  | { type: 'collapse'; itemId: string }
  | { type: 'none' };

// Escape is a pure decision: collapse an expanded card or transient UI if one is open,
// otherwise do nothing. It never bypasses or closes the ritual.
export function resolveArrivalEscape(input: {
  dragging: boolean;
  expandedItemId?: string | null;
}): ArrivalEscapeDecision {
  if (input.dragging) return { type: 'none' };
  if (input.expandedItemId) return { type: 'collapse', itemId: input.expandedItemId };
  return { type: 'none' };
}
