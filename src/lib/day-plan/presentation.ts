import type {
  DayPlanItem,
  DayPlanOwner as DayOwner,
  SettlementDisposition,
} from './types';

export type SettlementDecision = SettlementDisposition;
export type MoveDirection = -1 | 1;

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

export function moveDayPlanItem<T extends DayPlanItem>(
  items: readonly T[],
  itemId: string,
  direction: MoveDirection,
): T[] {
  const currentIndex = items.findIndex((item) => item.id === itemId);
  if (currentIndex < 0) return [...items];

  const nextIndex = currentIndex + direction;
  if (nextIndex < 0 || nextIndex >= items.length) return [...items];

  const next = [...items];
  [next[currentIndex], next[nextIndex]] = [next[nextIndex], next[currentIndex]];
  return withNormalizedPositions(next);
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

export function moveAnnouncement(
  title: string,
  nextIndex: number,
  total: number,
): string {
  return `${title} moved to priority ${nextIndex + 1} of ${total}.`;
}
