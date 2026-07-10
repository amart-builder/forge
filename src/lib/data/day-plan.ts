import type {
  DayPlan,
  DayPlanAssistantTurn,
  DayPlanExecutionConfig,
  DayPlanExecutionConfigResult,
  DayPlanExecutionReadiness,
  DayPlanExecutionRun,
  DayPlanExecutionWorkspaceMetadata,
  DayPlanMutationInput,
  DayPlanMutationResult,
  DayPlanReadModel,
  DayPlanReconciliationResult,
  EnsureDayPlanInput,
  KickoffDayPlanItemInput,
  KickoffDayPlanItemResult,
  ConfigureDayPlanExecutionInput,
} from "../day-plan/types";

export type DayPlanApiSnapshot = DayPlanReadModel & { csrfToken: string };
export type DayPlanExecutionState = {
  items: Array<{
    itemId: string;
    config?: DayPlanExecutionConfig;
    readiness: DayPlanExecutionReadiness;
  }>;
  runs: DayPlanExecutionRun[];
  workspaces: DayPlanExecutionWorkspaceMetadata[];
};

export class DayPlanApiConflict extends Error {
  constructor(public readonly currentPlan: DayPlan) {
    super("The day plan changed. Forge refreshed the newest version.");
    this.name = "DayPlanApiConflict";
  }
}

let csrfToken: string | undefined;

async function responsePayload(response: Response): Promise<Record<string, unknown>> {
  return (await response.json().catch(() => ({}))) as Record<string, unknown>;
}

export async function getDayPlanState(): Promise<DayPlanApiSnapshot> {
  const response = await fetch("/api/day-plan", { cache: "no-store" });
  const payload = await responsePayload(response);
  if (!response.ok) {
    throw new Error(
      typeof payload.error === "string" ? payload.error : "Forge couldn't load the day plan.",
    );
  }
  const snapshot = payload as DayPlanApiSnapshot;
  csrfToken = snapshot.csrfToken;
  return snapshot;
}

async function postDayPlan<T = DayPlanMutationResult>(
  body: Record<string, unknown>,
): Promise<T> {
  if (!csrfToken) await getDayPlanState();
  const response = await fetch("/api/day-plan", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Forge-CSRF": csrfToken!,
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const payload = await responsePayload(response);
  if (response.status === 409 && payload.currentPlan) {
    throw new DayPlanApiConflict(payload.currentPlan as DayPlan);
  }
  if (!response.ok) {
    throw new Error(
      typeof payload.error === "string" ? payload.error : "Forge couldn't update the day plan.",
    );
  }
  return payload as T;
}

async function postProtected<T>(endpoint: string, body: Record<string, unknown>): Promise<T> {
  if (!csrfToken) await getDayPlanState();
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Forge-CSRF": csrfToken!,
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const payload = await responsePayload(response);
  if (response.status === 409 && payload.currentPlan) {
    throw new DayPlanApiConflict(payload.currentPlan as DayPlan);
  }
  if (!response.ok) {
    throw new Error(
      typeof payload.error === "string" ? payload.error : "Forge request failed.",
    );
  }
  return payload as T;
}

export function ensureDayPlan(input: EnsureDayPlanInput): Promise<DayPlanMutationResult> {
  return postDayPlan({ action: "ensure", ...input });
}

export function mutateDayPlan(
  input: DayPlanMutationInput,
): Promise<DayPlanMutationResult> {
  return postDayPlan(input);
}

export function acknowledgeDayPlanReconciliation(
  reconciliationId: string,
): Promise<DayPlanReconciliationResult> {
  return postDayPlan<DayPlanReconciliationResult>({
    action: "reconciliation_applied",
    reconciliationId,
  });
}

export function createDayPlanAssistantTurn(input: {
  planId: string;
  expectedVersion: number;
  mutationId: string;
  userText: string;
}): Promise<{ turn: DayPlanAssistantTurn; replayed: boolean }> {
  return postProtected("/api/day-plan/assistant-turn", input);
}

export async function getDayPlanAssistantTurn(
  id: string,
): Promise<DayPlanAssistantTurn> {
  const response = await fetch(
    `/api/day-plan/assistant-turn?id=${encodeURIComponent(id)}`,
    { cache: "no-store" },
  );
  const payload = await responsePayload(response);
  if (!response.ok) {
    throw new Error(
      typeof payload.error === "string" ? payload.error : "Assistant turn failed.",
    );
  }
  return payload.turn as DayPlanAssistantTurn;
}

export function configureDayPlanExecution(
  input: ConfigureDayPlanExecutionInput,
): Promise<DayPlanExecutionConfigResult> {
  return postProtected("/api/day-plan/execution", { action: "configure", ...input });
}

export function kickoffDayPlanItem(
  input: KickoffDayPlanItemInput,
): Promise<KickoffDayPlanItemResult> {
  return postProtected("/api/day-plan/execution", { action: "kickoff", ...input });
}

export function cancelDayPlanExecutionRun(
  runId: string,
): Promise<{ run: DayPlanExecutionRun }> {
  return postProtected("/api/day-plan/execution", { action: "cancel", runId });
}

export async function getDayPlanExecutionState(
  planId: string,
): Promise<DayPlanExecutionState> {
  const response = await fetch(
    `/api/day-plan/execution?planId=${encodeURIComponent(planId)}`,
    { cache: "no-store" },
  );
  const payload = await responsePayload(response);
  if (!response.ok) {
    throw new Error(
      typeof payload.error === "string" ? payload.error : "Forge couldn't load Claude execution state.",
    );
  }
  return payload as DayPlanExecutionState;
}

export function newDayPlanMutationId(): string {
  return crypto.randomUUID();
}

export function onceOnlyDayPlanMutationId(
  action: "ensure" | "start-day" | "settlement-commit",
  stableId: string,
): string {
  return `${action}:${stableId}`;
}
