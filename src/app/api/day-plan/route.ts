import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { getQuietCurrentCsrfToken } from "@/lib/quiet-current/store";
import { isTrustedForgeRequest } from "@/lib/request-security";
import {
  DayPlanInvalidTransition,
  DayPlanNotFound,
  DayPlanVersionConflict,
  getDayPlanStore,
} from "@/lib/day-plan/store";
import type {
  DayPlanMutationAction,
  DayPlanMutationInput,
  DayPlanOwner,
  EnsureDayPlanInput,
  RecommendationCandidate,
  RecommendationSourceRef,
  SettlementDisposition,
} from "@/lib/day-plan/types";
import { isClaudeWorkerAvailable } from "@/lib/claude-execution/trigger";
import {
  publicExecutionRun,
  publicUnreadyItem,
} from "@/lib/day-plan/public-execution";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 32 * 1024;
const ACTIONS = new Set<DayPlanMutationAction>([
  "arrival_open",
  "arrival_snooze",
  "arrival_skip",
  "arrival_bypass",
  "arrival_reopen",
  "item_accept",
  "item_edit",
  "item_later",
  "item_dismiss",
  "item_owner",
  "item_reorder",
  "start_day",
  "settlement_offer",
  "settlement_skip",
  "settlement_start",
  "settlement_decide",
  "settlement_commit",
]);
const OWNERS = new Set<DayPlanOwner>(["me", "claude", "together"]);
const DISPOSITIONS = new Set<SettlementDisposition>(["carry", "defer", "drop"]);
const PRIORITIES = new Set(["low", "medium", "high"]);
const SOURCE_TYPES = new Set(["task", "suggestion", "snapshot", "email", "crm", "decision"]);
const SUPPORTS = new Set([
  "commitment",
  "deadline",
  "waiting_person",
  "carryover",
  "returned_work",
  "priority",
]);
const TASK_SUPPORTS = new Set(["commitment", "deadline", "priority"]);
const WHY_TODAY = new Set([
  "This is accepted work already in flight.",
  "This is accepted work already committed for today.",
  "This accepted commitment has a verified overdue date.",
  "This accepted commitment has a verified due date today.",
]);
const RANK_REASONS = new Set([
  "accepted_in_flight",
  "accepted_today",
  "priority_low",
  "priority_medium",
  "priority_high",
  "verified_overdue",
  "verified_due_today",
]);
const MUTATION_ID = /^[A-Za-z0-9:_-]+$/;
const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;
type DayPlanAccessMode = "loopback" | "session";
const LOOPBACK_ACCESS_HOSTS = ["localhost", "127.0.0.1", "[::1]"];

type ParsedPost =
  | { action: "ensure"; input: EnsureDayPlanInput }
  | { action: "reconciliation_applied"; reconciliationId: string }
  | { action: DayPlanMutationAction; input: DayPlanMutationInput };

export function hasDayPlanRouteAccess(
  request: NextRequest,
  options: {
    accessMode?: DayPlanAccessMode;
    sessionToken?: string;
  } = {
    accessMode: process.env.FORGE_DAY_PLAN_ACCESS_MODE as DayPlanAccessMode | undefined,
    sessionToken: process.env.FORGE_DAY_PLAN_REMOTE_TOKEN,
  },
): boolean {
  if (options.accessMode === "loopback") {
    return isTrustedForgeRequest(request, LOOPBACK_ACCESS_HOSTS);
  }
  if (!isTrustedForgeRequest(request)) return false;
  if (options.accessMode !== "session") return false;
  const supplied = request.headers.get("x-forge-day-plan-session");
  if (!options.sessionToken || !supplied) return false;
  const expectedBytes = Buffer.from(options.sessionToken);
  const suppliedBytes = Buffer.from(supplied);
  return expectedBytes.length === suppliedBytes.length &&
    timingSafeEqual(expectedBytes, suppliedBytes);
}

function recordValue(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function stringValue(
  value: unknown,
  name: string,
  options: { required?: boolean; max?: number; pattern?: RegExp } = {},
): string | undefined {
  if (value === undefined || value === null || value === "") {
    if (options.required) throw new Error(`${name} is required.`);
    return undefined;
  }
  if (typeof value !== "string") throw new Error(`${name} must be text.`);
  const trimmed = value.trim();
  if (options.required && !trimmed) throw new Error(`${name} is required.`);
  if (trimmed.length > (options.max ?? 4000)) throw new Error(`${name} is too long.`);
  if (options.pattern && !options.pattern.test(trimmed)) {
    throw new Error(`${name} has an invalid format.`);
  }
  return trimmed;
}

function isoValue(
  value: unknown,
  name: string,
  options: { required?: boolean } = {},
): string | undefined {
  const text = stringValue(value, name, { required: options.required, max: 80 });
  if (!text) return undefined;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) throw new Error(`${name} must be a valid date.`);
  return date.toISOString();
}

function stringArray(
  value: unknown,
  name: string,
  options: { maxItems: number; maxLength: number } = { maxItems: 20, maxLength: 200 },
): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > options.maxItems) {
    throw new Error(`${name} has too many values.`);
  }
  return value.map((item, index) =>
    stringValue(item, `${name}[${index}]`, {
      required: true,
      max: options.maxLength,
    })!,
  );
}

function sourceRef(value: unknown, index: number): RecommendationSourceRef {
  const source = recordValue(value, `sourceRefs[${index}]`);
  const sourceType = stringValue(source.sourceType, "sourceType", {
    required: true,
    max: 30,
  });
  const freshness = stringValue(source.freshness, "freshness", {
    required: true,
    max: 20,
  });
  if (!sourceType || !SOURCE_TYPES.has(sourceType)) throw new Error("Unknown source type.");
  if (freshness !== "current") {
    throw new Error("Arrival candidates require current task evidence.");
  }
  const supports = stringArray(source.supports, "supports", {
    maxItems: 6,
    maxLength: 40,
  });
  if (supports.some((support) => !SUPPORTS.has(support))) {
    throw new Error("Unknown recommendation support.");
  }
  if (supports.some((support) => !TASK_SUPPORTS.has(support))) {
    throw new Error("Task candidates cannot claim unsupported evidence.");
  }
  return {
    sourceType: sourceType as RecommendationSourceRef["sourceType"],
    recordId: stringValue(source.recordId, "recordId", { required: true, max: 200 })!,
    sourceUpdatedAt: isoValue(source.sourceUpdatedAt, "sourceUpdatedAt", { required: true })!,
    refreshedAt: isoValue(source.refreshedAt, "refreshedAt", { required: true })!,
    freshness: "current",
    supports: supports as RecommendationSourceRef["supports"],
  };
}

function candidateValue(value: unknown, index: number): RecommendationCandidate {
  const candidate = recordValue(value, `candidates[${index}]`);
  const taskId = stringValue(candidate.taskId, "taskId", { required: true, max: 200 })!;
  const owner = stringValue(candidate.owner, "owner", { required: true, max: 20 });
  const priority = stringValue(candidate.priority, "priority", { required: true, max: 20 });
  if (!owner || !OWNERS.has(owner as DayPlanOwner)) throw new Error("Unknown owner.");
  if (!priority || !PRIORITIES.has(priority)) throw new Error("Unknown priority.");
  if (candidate.commitment !== "ink") {
    throw new Error("Phase 1A candidates must be accepted task-backed work.");
  }
  if (!Array.isArray(candidate.sourceRefs) || candidate.sourceRefs.length !== 1) {
    throw new Error("A task-backed candidate requires one source record.");
  }
  const sourceRefs = candidate.sourceRefs.map(sourceRef);
  if (
    sourceRefs[0].sourceType !== "task" ||
    sourceRefs[0].recordId !== taskId ||
    !sourceRefs[0].supports.includes("commitment")
  ) {
    throw new Error("Candidate provenance must identify its accepted task.");
  }
  const conflicts = stringArray(candidate.conflicts, "conflicts", {
    maxItems: 3,
    maxLength: 240,
  });
  if (conflicts.length) throw new Error("Conflicted candidates cannot enter arrival.");
  const candidateId = stringValue(candidate.candidateId, "candidateId", {
    required: true,
    max: 240,
  })!;
  if (candidateId !== `task:${taskId}`) {
    throw new Error("Candidate ID must be stable for its task.");
  }
  const whyToday = stringValue(candidate.whyToday, "whyToday", {
    required: true,
    max: 600,
  })!;
  if (!WHY_TODAY.has(whyToday)) {
    throw new Error("Task candidate urgency must come from deterministic evidence.");
  }
  const dueAt = isoValue(candidate.dueAt, "dueAt");
  const hasDeadline = sourceRefs[0].supports.includes("deadline");
  if (hasDeadline && !dueAt) {
    throw new Error("Deadline evidence requires a verified due date.");
  }
  if (
    hasDeadline !==
    (whyToday === "This accepted commitment has a verified overdue date." ||
      whyToday === "This accepted commitment has a verified due date today.")
  ) {
    throw new Error("Task candidate reason does not match its deadline evidence.");
  }
  const rankReasons = stringArray(candidate.rankReasons, "rankReasons", {
    maxItems: 8,
    maxLength: 80,
  });
  if (rankReasons.some((reason) => !RANK_REASONS.has(reason))) {
    throw new Error("Task candidate has an unsupported rank reason.");
  }
  if (!rankReasons.includes(`priority_${priority}`)) {
    throw new Error("Task candidate rank must preserve its explicit priority.");
  }
  if (
    !rankReasons.includes("accepted_today") &&
    !rankReasons.includes("accepted_in_flight")
  ) {
    throw new Error("Task candidate rank must preserve its accepted column.");
  }
  if (
    rankReasons.some((reason) => reason.startsWith("verified_")) !== hasDeadline
  ) {
    throw new Error("Task candidate rank does not match its deadline evidence.");
  }
  const newestSourceRefreshAt = isoValue(
    candidate.newestSourceRefreshAt,
    "newestSourceRefreshAt",
    { required: true },
  )!;
  if (newestSourceRefreshAt !== sourceRefs[0].refreshedAt) {
    throw new Error("Candidate freshness must match its newest source refresh.");
  }
  return {
    candidateId,
    taskId,
    outcomeKey: stringValue(candidate.outcomeKey, "outcomeKey", {
      required: true,
      max: 240,
    })!,
    title: stringValue(candidate.title, "title", { required: true, max: 240 })!,
    outcome: stringValue(candidate.outcome, "outcome", { required: true, max: 1200 })!,
    definitionOfDone: stringValue(candidate.definitionOfDone, "definitionOfDone", {
      max: 1200,
    }),
    project: stringValue(candidate.project, "project", { max: 120 }),
    owner: owner as DayPlanOwner,
    commitment: "ink",
    whyToday,
    priority: priority as RecommendationCandidate["priority"],
    dueAt,
    sourceRefs,
    newestSourceRefreshAt,
    conflicts: [],
    humanDecisionEventIds: stringArray(
      candidate.humanDecisionEventIds,
      "humanDecisionEventIds",
      { maxItems: 20, maxLength: 200 },
    ),
    rankReasons,
  };
}

function timezoneValue(value: unknown): string {
  const timezone = stringValue(value, "timezone", { required: true, max: 100 })!;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
  } catch {
    throw new Error("timezone must be a valid IANA timezone.");
  }
  return timezone;
}

function localDateValue(value: unknown): string {
  const localDate = stringValue(value, "localDate", {
    required: true,
    max: 10,
    pattern: LOCAL_DATE,
  })!;
  const parsed = new Date(`${localDate}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== localDate) {
    throw new Error("localDate must be a real calendar date.");
  }
  return localDate;
}

function mutationIdValue(value: unknown): string {
  return stringValue(value, "mutationId", {
    required: true,
    max: 240,
    pattern: MUTATION_ID,
  })!;
}

export function parseDayPlanPostBody(value: unknown): ParsedPost {
  const body = recordValue(value, "request body");
  const action = stringValue(body.action, "action", { required: true, max: 40 });
  if (action === "ensure") {
    if (!Array.isArray(body.candidates) || body.candidates.length > 3) {
      throw new Error("Arrival supports at most three candidates.");
    }
    const candidates = body.candidates.map(candidateValue);
    if (new Set(candidates.map((candidate) => candidate.taskId)).size !== candidates.length) {
      throw new Error("Arrival candidates must reference distinct tasks.");
    }
    if (new Set(candidates.map((candidate) => candidate.outcomeKey)).size !== candidates.length) {
      throw new Error("Arrival candidates must have distinct outcomes.");
    }
    return {
      action: "ensure",
      input: {
        localDate: localDateValue(body.localDate),
        timezone: timezoneValue(body.timezone),
        mutationId: mutationIdValue(body.mutationId),
        candidates,
      },
    };
  }

  if (action === "reconciliation_applied") {
    return {
      action,
      reconciliationId: stringValue(body.reconciliationId, "reconciliationId", {
        required: true,
        max: 200,
      })!,
    };
  }

  if (!action || !ACTIONS.has(action as DayPlanMutationAction)) {
    throw new Error("Unknown day-plan action.");
  }
  const expectedVersion = body.expectedVersion;
  if (!Number.isInteger(expectedVersion) || (expectedVersion as number) < 1) {
    throw new Error("expectedVersion must be a positive integer.");
  }
  const owner = stringValue(body.owner, "owner", { max: 20 });
  if (owner && !OWNERS.has(owner as DayPlanOwner)) throw new Error("Unknown owner.");
  const disposition = stringValue(body.disposition, "disposition", { max: 20 });
  if (disposition && !DISPOSITIONS.has(disposition as SettlementDisposition)) {
    throw new Error("Unknown settlement disposition.");
  }
  const position = body.position;
  if (position !== undefined && !Number.isInteger(position)) {
    throw new Error("position must be an integer.");
  }
  return {
    action: action as DayPlanMutationAction,
    input: {
      action: action as DayPlanMutationAction,
      planId: stringValue(body.planId, "planId", { required: true, max: 200 })!,
      mutationId: mutationIdValue(body.mutationId),
      expectedVersion: expectedVersion as number,
      itemId: stringValue(body.itemId, "itemId", { max: 240 }),
      title: stringValue(body.title, "title", { max: 240 }),
      outcome: stringValue(body.outcome, "outcome", { max: 1200 }),
      definitionOfDone: stringValue(body.definitionOfDone, "definitionOfDone", {
        max: 1200,
      }),
      owner: owner as DayPlanOwner | undefined,
      position: position as number | undefined,
      snoozedUntil: isoValue(body.snoozedUntil, "snoozedUntil"),
      disposition: disposition as SettlementDisposition | undefined,
      deferUntil: isoValue(body.deferUntil, "deferUntil"),
      completedHumanTaskIds: stringArray(
        body.completedHumanTaskIds,
        "completedHumanTaskIds",
        { maxItems: 3, maxLength: 200 },
      ),
      nextDayNote: stringValue(body.nextDayNote, "nextDayNote", { max: 1000 }),
    },
  };
}

export async function GET(request: NextRequest) {
  if (!hasDayPlanRouteAccess(request)) {
    return NextResponse.json({ error: "Untrusted request host." }, { status: 403 });
  }
  try {
    return NextResponse.json({
      ...getDayPlanStore().getReadModel(),
      csrfToken: getQuietCurrentCsrfToken(),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Day plan failed." },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  if (!hasDayPlanRouteAccess(request)) {
    return NextResponse.json({ error: "Untrusted request host." }, { status: 403 });
  }
  const suppliedToken = request.headers.get("x-forge-csrf");
  if (!suppliedToken || suppliedToken !== getQuietCurrentCsrfToken()) {
    return NextResponse.json({ error: "Forge request token is missing." }, { status: 403 });
  }

  try {
    const declaredLength = Number(request.headers.get("content-length") ?? 0);
    if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
      return NextResponse.json({ error: "Day-plan request is too large." }, { status: 413 });
    }
    const text = await request.text();
    if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) {
      return NextResponse.json({ error: "Day-plan request is too large." }, { status: 413 });
    }
    const parsed = parseDayPlanPostBody(JSON.parse(text) as unknown);
    const store = getDayPlanStore();
    const result = parsed.action === "ensure"
      ? store.ensureDayPlan(parsed.input)
      : parsed.action === "reconciliation_applied"
        ? store.acknowledgeReconciliation(parsed.reconciliationId)
        : store.mutateDayPlan(parsed.input);
    const queuedRuns = parsed.action === "start_day" && "executionRuns" in result
      ? result.executionRuns?.filter((run) => run.status === "queued").length ?? 0
      : 0;
    const publicResult = "executionRuns" in result
      ? {
          ...result,
          executionRuns: result.executionRuns?.map(publicExecutionRun),
          unreadyItems: result.unreadyItems?.map(publicUnreadyItem),
          ...(parsed.action === "start_day"
            ? {
                worker: {
                  queuedRuns,
                  available: isClaudeWorkerAvailable(),
                },
              }
            : {}),
        }
      : result;
    return NextResponse.json(publicResult, {
      status: parsed.action === "ensure" ? 201 : 200,
    });
  } catch (error) {
    if (error instanceof DayPlanVersionConflict) {
      return NextResponse.json(
        { error: "version_conflict", currentPlan: error.currentPlan },
        { status: 409 },
      );
    }
    if (error instanceof DayPlanNotFound) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof DayPlanInvalidTransition || error instanceof SyntaxError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof Error && /required|invalid|unknown|must|supports|candidate/i.test(error.message)) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Day plan failed." },
      { status: 500 },
    );
  }
}
