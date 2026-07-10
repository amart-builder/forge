import type {
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
