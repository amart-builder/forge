export type DayPlanState =
  | "draft"
  | "proposed"
  | "active"
  | "settling"
  | "settled"
  | "abandoned";

export type ArrivalState =
  | "not_due"
  | "due"
  | "opened"
  | "snoozed"
  | "skipped"
  | "confirmed"
  | "bypassed"
  | "failed";

export type SettlementState =
  | "not_due"
  | "offered"
  | "in_progress"
  | "skipped"
  | "committed"
  | "settled";

export type DayPlanOwner = "me" | "claude" | "together";
export type DayPlanCommitment = "ink" | "pencil";
export type DayPlanItemDecision =
  | "pending"
  | "preselected"
  | "accepted"
  | "later"
  | "dismissed";
export type SettlementDisposition = "carry" | "defer" | "drop";

export type RecommendationSourceType =
  | "task"
  | "suggestion"
  | "snapshot"
  | "email"
  | "crm"
  | "decision";

export type RecommendationSupport =
  | "commitment"
  | "deadline"
  | "waiting_person"
  | "carryover"
  | "returned_work"
  | "priority";

export type RecommendationSourceRef = {
  sourceType: RecommendationSourceType;
  recordId: string;
  sourceUpdatedAt: string;
  refreshedAt: string;
  freshness: "current" | "stale" | "missing" | "contradicted";
  supports: RecommendationSupport[];
};

export type RecommendationCandidate = {
  candidateId: string;
  taskId: string;
  outcomeKey: string;
  title: string;
  outcome: string;
  definitionOfDone?: string;
  project?: string;
  owner: DayPlanOwner;
  commitment: "ink";
  whyToday: string;
  priority: "low" | "medium" | "high";
  dueAt?: string;
  sourceRefs: RecommendationSourceRef[];
  newestSourceRefreshAt: string;
  conflicts: string[];
  humanDecisionEventIds: string[];
  rankReasons: string[];
};

export type DayPlanItem = RecommendationCandidate & {
  id: string;
  position: number;
  decision: DayPlanItemDecision;
  settlementDecision?: {
    disposition: SettlementDisposition;
    deferUntil?: string;
    decidedAt: string;
  };
};

export type DayPlan = {
  id: string;
  localDate: string;
  timezone: string;
  state: DayPlanState;
  arrivalState: ArrivalState;
  settlementState: SettlementState;
  version: number;
  lastMutationId?: string;
  items: DayPlanItem[];
  recommendedFirstItemId?: string;
  recommendedFirstTaskId?: string;
  snoozedUntil?: string;
  nextDayNote?: string;
  confirmedAt?: string;
  settledAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type DaySnapshotItem = {
  dayPlanItemId: string;
  taskId: string;
  title: string;
  owner: DayPlanOwner;
  disposition: SettlementDisposition;
  deferUntil?: string;
};

export type DaySnapshotBody = {
  completedHumanTaskIds: string[];
  returnedAgentWork: [];
  unresolvedItems: DaySnapshotItem[];
  humanDecisionEventIds: string[];
  overnightQueue: [];
  nextDayRecommendationSeed?: {
    dayPlanItemId: string;
    taskId: string;
    title: string;
  };
};

export type DaySnapshot = {
  id: string;
  dayPlanId: string;
  localDate: string;
  timezone: string;
  version: 1;
  body: DaySnapshotBody;
  createdAt: string;
};

export type DayPlanReconciliation = {
  id: string;
  dayPlanId: string;
  snapshotId: string;
  taskId: string;
  action: "defer" | "drop" | "resurface";
  availableAt?: string;
  state: "pending" | "scheduled" | "applied";
  createdAt: string;
  appliedAt?: string;
};

export type DayPlanEvent = {
  id: string;
  dayPlanId: string;
  eventType: DayPlanEventType;
  expectedVersion?: number;
  resultVersion: number;
  before?: unknown;
  after?: unknown;
  createdAt: string;
};

export type DayPlanEventType = "ensure" | DayPlanMutationAction;

export type DayPlanMutationAction =
  | "arrival_open"
  | "arrival_snooze"
  | "arrival_skip"
  | "arrival_bypass"
  | "arrival_reopen"
  | "item_accept"
  | "item_edit"
  | "item_later"
  | "item_dismiss"
  | "item_owner"
  | "item_reorder"
  | "start_day"
  | "settlement_offer"
  | "settlement_skip"
  | "settlement_start"
  | "settlement_decide"
  | "settlement_commit";

export type EnsureDayPlanInput = {
  localDate: string;
  timezone: string;
  mutationId: string;
  candidates: RecommendationCandidate[];
};

export type DayPlanMutationInput = {
  planId: string;
  mutationId: string;
  expectedVersion: number;
  action: DayPlanMutationAction;
  itemId?: string;
  title?: string;
  outcome?: string;
  definitionOfDone?: string;
  owner?: DayPlanOwner;
  position?: number;
  snoozedUntil?: string;
  disposition?: SettlementDisposition;
  deferUntil?: string;
  completedHumanTaskIds?: string[];
  nextDayNote?: string;
};

export type DayPlanMutationResult = {
  plan: DayPlan;
  snapshot?: DaySnapshot;
  pendingReconciliations?: DayPlanReconciliation[];
  replayed: boolean;
};

export type DayPlanReconciliationResult = {
  reconciliation: DayPlanReconciliation;
  replayed: boolean;
};

export type DayPlanReadModel = {
  currentPlan?: DayPlan;
  latestSnapshot?: DaySnapshot;
  pendingReconciliations: DayPlanReconciliation[];
};
