import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type {
  DayPlan,
  DayPlanEvent,
  DayPlanItem,
  DayPlanMutationInput,
  DayPlanMutationResult,
  DayPlanReconciliation,
  DayPlanReconciliationResult,
  DayPlanReadModel,
  DaySnapshot,
  DaySnapshotBody,
  EnsureDayPlanInput,
} from "./types";

type Clock = () => Date;

type DayPlanRow = {
  id: string;
  local_date: string;
  timezone: string;
  plan_state: DayPlan["state"];
  arrival_state: DayPlan["arrivalState"];
  settlement_state: DayPlan["settlementState"];
  version: number;
  last_mutation_id: string | null;
  items_json: string;
  recommended_first_item_id: string | null;
  recommended_first_task_id: string | null;
  snoozed_until: string | null;
  next_day_note: string | null;
  confirmed_at: string | null;
  settled_at: string | null;
  created_at: string;
  updated_at: string;
};

type SnapshotRow = {
  id: string;
  day_plan_id: string;
  local_date: string;
  timezone: string;
  version: 1;
  body_json: string;
  created_at: string;
};

type EventRow = {
  id: string;
  day_plan_id: string;
  event_type: DayPlanEvent["eventType"];
  expected_version: number | null;
  result_version: number;
  before_json: string | null;
  after_json: string | null;
  created_at: string;
};

type ReconciliationRow = {
  id: string;
  day_plan_id: string;
  snapshot_id: string;
  task_id: string;
  action: DayPlanReconciliation["action"];
  available_at: string | null;
  state: DayPlanReconciliation["state"];
  created_at: string;
  applied_at: string | null;
};

const DAY_PLAN_SCHEMA = `
CREATE TABLE IF NOT EXISTS day_plans (
  id TEXT PRIMARY KEY,
  local_date TEXT NOT NULL UNIQUE,
  timezone TEXT NOT NULL,
  open_slot INTEGER UNIQUE CHECK (open_slot IS NULL OR open_slot = 1),
  plan_state TEXT NOT NULL CHECK (plan_state IN ('draft','proposed','active','settling','settled','abandoned')),
  arrival_state TEXT NOT NULL CHECK (arrival_state IN ('not_due','due','opened','snoozed','skipped','confirmed','bypassed','failed')),
  settlement_state TEXT NOT NULL CHECK (settlement_state IN ('not_due','offered','in_progress','skipped','committed','settled')),
  version INTEGER NOT NULL CHECK (version > 0),
  last_mutation_id TEXT,
  items_json TEXT NOT NULL,
  recommended_first_item_id TEXT,
  recommended_first_task_id TEXT,
  snoozed_until TEXT,
  next_day_note TEXT,
  confirmed_at TEXT,
  settled_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS day_plan_events (
  id TEXT PRIMARY KEY,
  day_plan_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  expected_version INTEGER,
  result_version INTEGER NOT NULL,
  before_json TEXT,
  after_json TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (day_plan_id) REFERENCES day_plans(id)
);
CREATE INDEX IF NOT EXISTS day_plan_events_by_plan
  ON day_plan_events(day_plan_id, created_at, id);
CREATE TABLE IF NOT EXISTS day_snapshots (
  id TEXT PRIMARY KEY,
  day_plan_id TEXT NOT NULL UNIQUE,
  local_date TEXT NOT NULL,
  timezone TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version = 1),
  body_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (day_plan_id) REFERENCES day_plans(id)
);
CREATE INDEX IF NOT EXISTS day_snapshots_by_date
  ON day_snapshots(local_date DESC, created_at DESC);
CREATE TABLE IF NOT EXISTS day_plan_reconciliations (
  id TEXT PRIMARY KEY,
  day_plan_id TEXT NOT NULL,
  snapshot_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('defer','drop','resurface')),
  available_at TEXT,
  state TEXT NOT NULL CHECK (state IN ('pending','scheduled','applied')),
  created_at TEXT NOT NULL,
  applied_at TEXT,
  UNIQUE (snapshot_id, task_id, action),
  FOREIGN KEY (day_plan_id) REFERENCES day_plans(id),
  FOREIGN KEY (snapshot_id) REFERENCES day_snapshots(id)
);
CREATE INDEX IF NOT EXISTS day_plan_reconciliations_pending
  ON day_plan_reconciliations(state, created_at, id);
`;

export class DayPlanVersionConflict extends Error {
  constructor(public readonly currentPlan: DayPlan) {
    super("The day plan changed before this action was saved.");
    this.name = "DayPlanVersionConflict";
  }
}

export class DayPlanNotFound extends Error {
  constructor() {
    super("Day plan not found.");
    this.name = "DayPlanNotFound";
  }
}

export class DayPlanInvalidTransition extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DayPlanInvalidTransition";
  }
}

function parseJson<T>(value: string, name: string): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    throw new Error(`Stored ${name} is not valid JSON.`);
  }
}

function planFromRow(row: DayPlanRow): DayPlan {
  return {
    id: row.id,
    localDate: row.local_date,
    timezone: row.timezone,
    state: row.plan_state,
    arrivalState: row.arrival_state,
    settlementState: row.settlement_state,
    version: row.version,
    lastMutationId: row.last_mutation_id ?? undefined,
    items: parseJson<DayPlanItem[]>(row.items_json, "day plan items"),
    recommendedFirstItemId: row.recommended_first_item_id ?? undefined,
    recommendedFirstTaskId: row.recommended_first_task_id ?? undefined,
    snoozedUntil: row.snoozed_until ?? undefined,
    nextDayNote: row.next_day_note ?? undefined,
    confirmedAt: row.confirmed_at ?? undefined,
    settledAt: row.settled_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function snapshotFromRow(row: SnapshotRow): DaySnapshot {
  return {
    id: row.id,
    dayPlanId: row.day_plan_id,
    localDate: row.local_date,
    timezone: row.timezone,
    version: 1,
    body: parseJson<DaySnapshotBody>(row.body_json, "day snapshot"),
    createdAt: row.created_at,
  };
}

function eventFromRow(row: EventRow): DayPlanEvent {
  return {
    id: row.id,
    dayPlanId: row.day_plan_id,
    eventType: row.event_type,
    expectedVersion: row.expected_version ?? undefined,
    resultVersion: row.result_version,
    before: row.before_json ? parseJson<unknown>(row.before_json, "event before") : undefined,
    after: row.after_json ? parseJson<unknown>(row.after_json, "event after") : undefined,
    createdAt: row.created_at,
  };
}

function reconciliationFromRow(row: ReconciliationRow): DayPlanReconciliation {
  return {
    id: row.id,
    dayPlanId: row.day_plan_id,
    snapshotId: row.snapshot_id,
    taskId: row.task_id,
    action: row.action,
    availableAt: row.available_at ?? undefined,
    state: row.state,
    createdAt: row.created_at,
    appliedAt: row.applied_at ?? undefined,
  };
}

function clonePlan(plan: DayPlan): DayPlan {
  return structuredClone(plan);
}

function requireItem(plan: DayPlan, itemId?: string): DayPlanItem {
  const item = itemId ? plan.items.find((candidate) => candidate.id === itemId) : undefined;
  if (!item) throw new DayPlanInvalidTransition("Day plan item not found.");
  return item;
}

function requireArrivalEditing(plan: DayPlan): void {
  if (plan.state !== "proposed" || plan.arrivalState !== "opened") {
    throw new DayPlanInvalidTransition("Arrival items can change only while arrival is open.");
  }
}

function requireState<T extends string>(current: T, allowed: readonly T[], message: string): void {
  if (!allowed.includes(current)) throw new DayPlanInvalidTransition(message);
}

function cleanOptional(value?: string): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

export type DayPlanStore = ReturnType<typeof createDayPlanStore>;

export function createDayPlanStore(options: { dbPath: string; now?: Clock }) {
  mkdirSync(path.dirname(options.dbPath), { recursive: true });
  const db = new Database(options.dbPath);
  const now = options.now ?? (() => new Date());
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  db.exec(DAY_PLAN_SCHEMA);

  const selectPlan = db.prepare("SELECT * FROM day_plans WHERE id = ?");
  const selectOpenPlan = db.prepare("SELECT * FROM day_plans WHERE open_slot = 1 LIMIT 1");
  const selectDatePlan = db.prepare("SELECT * FROM day_plans WHERE local_date = ? LIMIT 1");
  const selectEvent = db.prepare("SELECT * FROM day_plan_events WHERE id = ?");
  const selectSnapshot = db.prepare("SELECT * FROM day_snapshots WHERE day_plan_id = ?");
  const selectLatestSnapshot = db.prepare(
    "SELECT * FROM day_snapshots ORDER BY local_date DESC, created_at DESC LIMIT 1",
  );
  const selectReconciliation = db.prepare(
    "SELECT * FROM day_plan_reconciliations WHERE id = ?",
  );
  const selectPendingReconciliations = db.prepare(
    `SELECT * FROM day_plan_reconciliations
     WHERE state = 'pending' OR (state = 'scheduled' AND available_at <= ?)
     ORDER BY CASE state WHEN 'pending' THEN 0 ELSE 1 END, created_at, id`,
  );

  function immediate<T>(work: () => T): T {
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = work();
      db.exec("COMMIT");
      return result;
    } catch (error) {
      try {
        db.exec("ROLLBACK");
      } catch {
        // Preserve the original error.
      }
      throw error;
    }
  }

  function getPlan(id: string): DayPlan | undefined {
    const row = selectPlan.get(id) as DayPlanRow | undefined;
    return row ? planFromRow(row) : undefined;
  }

  function getSnapshot(planId: string): DaySnapshot | undefined {
    const row = selectSnapshot.get(planId) as SnapshotRow | undefined;
    return row ? snapshotFromRow(row) : undefined;
  }

  function listPendingReconciliations(): DayPlanReconciliation[] {
    return (selectPendingReconciliations.all(now().toISOString()) as ReconciliationRow[]).map(
      reconciliationFromRow,
    );
  }

  function appendEvent(input: {
    id: string;
    planId: string;
    eventType: DayPlanEvent["eventType"];
    expectedVersion?: number;
    resultVersion: number;
    before?: unknown;
    after?: unknown;
    createdAt: string;
  }): void {
    db.prepare(
      `INSERT INTO day_plan_events
        (id, day_plan_id, event_type, expected_version, result_version, before_json, after_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      input.id,
      input.planId,
      input.eventType,
      input.expectedVersion ?? null,
      input.resultVersion,
      input.before === undefined ? null : JSON.stringify(input.before),
      input.after === undefined ? null : JSON.stringify(input.after),
      input.createdAt,
    );
  }

  function persistPlan(plan: DayPlan): void {
    db.prepare(
      `UPDATE day_plans SET
        timezone = ?, open_slot = ?, plan_state = ?, arrival_state = ?, settlement_state = ?,
        version = ?, last_mutation_id = ?, items_json = ?, recommended_first_item_id = ?,
        recommended_first_task_id = ?, snoozed_until = ?, next_day_note = ?, confirmed_at = ?,
        settled_at = ?, updated_at = ?
       WHERE id = ?`,
    ).run(
      plan.timezone,
      plan.state === "settled" || plan.state === "abandoned" ? null : 1,
      plan.state,
      plan.arrivalState,
      plan.settlementState,
      plan.version,
      plan.lastMutationId ?? null,
      JSON.stringify(plan.items),
      plan.recommendedFirstItemId ?? null,
      plan.recommendedFirstTaskId ?? null,
      plan.snoozedUntil ?? null,
      plan.nextDayNote ?? null,
      plan.confirmedAt ?? null,
      plan.settledAt ?? null,
      plan.updatedAt,
      plan.id,
    );
  }

  function ensureDayPlan(input: EnsureDayPlanInput): DayPlanMutationResult {
    return immediate(() => {
      const existingEvent = selectEvent.get(input.mutationId) as EventRow | undefined;
      if (existingEvent) {
        if (existingEvent.event_type !== "ensure") {
          throw new DayPlanInvalidTransition("Mutation ID was already used for another action.");
        }
        const replayed = getPlan(existingEvent.day_plan_id);
        if (!replayed) throw new DayPlanNotFound();
        return { plan: replayed, snapshot: getSnapshot(replayed.id), replayed: true };
      }

      const existingRow =
        (selectOpenPlan.get() as DayPlanRow | undefined) ??
        (selectDatePlan.get(input.localDate) as DayPlanRow | undefined);
      if (existingRow) {
        const existing = planFromRow(existingRow);
        appendEvent({
          id: input.mutationId,
          planId: existing.id,
          eventType: "ensure",
          resultVersion: existing.version,
          after: { returnedExisting: true },
          createdAt: now().toISOString(),
        });
        return { plan: existing, snapshot: getSnapshot(existing.id), replayed: false };
      }

      if (input.candidates.length > 3) {
        throw new DayPlanInvalidTransition("Arrival supports at most three candidates.");
      }
      if (
        new Set(input.candidates.map((candidate) => candidate.taskId)).size !==
          input.candidates.length ||
        new Set(input.candidates.map((candidate) => candidate.outcomeKey)).size !==
          input.candidates.length
      ) {
        throw new DayPlanInvalidTransition("Arrival candidates must be unique.");
      }
      if (
        input.candidates.some(
          (candidate) =>
            candidate.commitment !== "ink" ||
            candidate.conflicts.length > 0 ||
            candidate.sourceRefs.length !== 1 ||
            candidate.sourceRefs[0].sourceType !== "task" ||
            candidate.sourceRefs[0].recordId !== candidate.taskId ||
            candidate.sourceRefs[0].freshness !== "current",
        )
      ) {
        throw new DayPlanInvalidTransition(
          "Arrival candidates require current accepted task evidence.",
        );
      }

      const createdAt = now().toISOString();
      const id = randomUUID();
      const items: DayPlanItem[] = input.candidates.map((candidate, position) => ({
        ...structuredClone(candidate),
        id: candidate.candidateId,
        position,
        decision: "preselected",
      }));
      const plan: DayPlan = {
        id,
        localDate: input.localDate,
        timezone: input.timezone,
        state: "proposed",
        arrivalState: "due",
        settlementState: "not_due",
        version: 1,
        lastMutationId: input.mutationId,
        items,
        createdAt,
        updatedAt: createdAt,
      };

      db.prepare(
        `INSERT INTO day_plans
          (id, local_date, timezone, open_slot, plan_state, arrival_state, settlement_state,
           version, last_mutation_id, items_json, created_at, updated_at)
         VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        plan.id,
        plan.localDate,
        plan.timezone,
        plan.state,
        plan.arrivalState,
        plan.settlementState,
        plan.version,
        plan.lastMutationId,
        JSON.stringify(plan.items),
        plan.createdAt,
        plan.updatedAt,
      );
      appendEvent({
        id: input.mutationId,
        planId: plan.id,
        eventType: "ensure",
        resultVersion: plan.version,
        after: plan,
        createdAt,
      });
      return { plan, replayed: false };
    });
  }

  function mutateDayPlan(input: DayPlanMutationInput): DayPlanMutationResult {
    return immediate(() => {
      const existingEvent = selectEvent.get(input.mutationId) as EventRow | undefined;
      if (existingEvent) {
        if (
          existingEvent.day_plan_id !== input.planId ||
          existingEvent.event_type !== input.action
        ) {
          throw new DayPlanInvalidTransition("Mutation ID was already used for another action.");
        }
        const replayed = getPlan(input.planId);
        if (!replayed) throw new DayPlanNotFound();
        return {
          plan: replayed,
          snapshot: getSnapshot(input.planId),
          pendingReconciliations: listPendingReconciliations(),
          replayed: true,
        };
      }

      const plan = getPlan(input.planId);
      if (!plan) throw new DayPlanNotFound();
      if (plan.version !== input.expectedVersion) {
        throw new DayPlanVersionConflict(plan);
      }
      if (plan.state === "settled" || plan.state === "abandoned") {
        throw new DayPlanInvalidTransition(`Day plan is already ${plan.state}.`);
      }

      const before = clonePlan(plan);
      const changedAt = now().toISOString();
      let snapshot: DaySnapshot | undefined;

      switch (input.action) {
        case "arrival_open":
          requireState(
            plan.arrivalState,
            ["not_due", "due", "snoozed", "failed"],
            "Arrival cannot open from its current state.",
          );
          plan.arrivalState = "opened";
          plan.snoozedUntil = undefined;
          break;
        case "arrival_snooze": {
          requireState(
            plan.arrivalState,
            ["due", "opened"],
            "Arrival can be snoozed only once while due or open.",
          );
          const snoozedUntil = input.snoozedUntil
            ? new Date(input.snoozedUntil)
            : undefined;
          if (!snoozedUntil || Number.isNaN(snoozedUntil.getTime()) || snoozedUntil <= now()) {
            throw new DayPlanInvalidTransition("Snooze time must be in the future.");
          }
          plan.arrivalState = "snoozed";
          plan.snoozedUntil = snoozedUntil.toISOString();
          break;
        }
        case "arrival_skip":
          requireState(
            plan.arrivalState,
            ["not_due", "due", "opened", "snoozed"],
            "Arrival cannot be skipped from its current state.",
          );
          plan.arrivalState = "skipped";
          plan.snoozedUntil = undefined;
          break;
        case "arrival_bypass":
          requireState(
            plan.arrivalState,
            ["not_due", "due", "opened", "snoozed"],
            "Arrival cannot be bypassed from its current state.",
          );
          plan.arrivalState = "bypassed";
          plan.snoozedUntil = undefined;
          break;
        case "arrival_reopen":
          requireState(
            plan.arrivalState,
            ["skipped", "bypassed", "failed"],
            "Arrival cannot be reopened from its current state.",
          );
          plan.arrivalState = "opened";
          plan.snoozedUntil = undefined;
          break;
        case "item_accept": {
          requireArrivalEditing(plan);
          const item = requireItem(plan, input.itemId);
          requireState(
            item.decision,
            ["pending", "preselected"],
            "Only a proposed item can be accepted.",
          );
          item.decision = "accepted";
          break;
        }
        case "item_edit": {
          requireArrivalEditing(plan);
          const item = requireItem(plan, input.itemId);
          requireState(
            item.decision,
            ["pending", "preselected", "accepted"],
            "A resolved item cannot be edited.",
          );
          const title = cleanOptional(input.title);
          const outcome = cleanOptional(input.outcome);
          if (input.title !== undefined && !title) {
            throw new DayPlanInvalidTransition("Item title cannot be empty.");
          }
          if (input.outcome !== undefined && !outcome) {
            throw new DayPlanInvalidTransition("Item outcome cannot be empty.");
          }
          if (title) item.title = title;
          if (outcome) item.outcome = outcome;
          if (input.definitionOfDone !== undefined) {
            item.definitionOfDone = cleanOptional(input.definitionOfDone);
          }
          break;
        }
        case "item_later": {
          requireArrivalEditing(plan);
          const item = requireItem(plan, input.itemId);
          requireState(
            item.decision,
            ["pending", "preselected", "accepted"],
            "A resolved item cannot be set aside.",
          );
          item.decision = "later";
          plan.items = [
            ...plan.items.filter((candidate) => candidate.id !== item.id),
            item,
          ];
          plan.items.forEach((candidate, index) => {
            candidate.position = index;
          });
          break;
        }
        case "item_dismiss": {
          requireArrivalEditing(plan);
          const item = requireItem(plan, input.itemId);
          requireState(
            item.decision,
            ["pending", "preselected", "accepted"],
            "A resolved item cannot be dismissed.",
          );
          item.decision = "dismissed";
          plan.items = [
            ...plan.items.filter((candidate) => candidate.id !== item.id),
            item,
          ];
          plan.items.forEach((candidate, index) => {
            candidate.position = index;
          });
          break;
        }
        case "item_owner": {
          requireArrivalEditing(plan);
          const item = requireItem(plan, input.itemId);
          requireState(
            item.decision,
            ["pending", "preselected", "accepted"],
            "A resolved item's owner cannot change.",
          );
          if (!input.owner) throw new DayPlanInvalidTransition("Item owner is required.");
          item.owner = input.owner;
          break;
        }
        case "item_reorder": {
          requireArrivalEditing(plan);
          const item = requireItem(plan, input.itemId);
          if (!Number.isInteger(input.position)) {
            throw new DayPlanInvalidTransition("Item position must be an integer.");
          }
          const target = Math.max(0, Math.min(plan.items.length - 1, input.position!));
          const ordered = [...plan.items].sort((left, right) => left.position - right.position);
          ordered.splice(ordered.indexOf(item), 1);
          ordered.splice(target, 0, item);
          ordered.forEach((candidate, index) => {
            candidate.position = index;
          });
          plan.items = ordered;
          break;
        }
        case "start_day": {
          if (plan.state !== "proposed" || plan.arrivalState !== "opened") {
            throw new DayPlanInvalidTransition("Start My Day requires an open proposed arrival.");
          }
          const accepted = [...plan.items]
            .filter(
              (item) => item.decision === "accepted" || item.decision === "preselected",
            )
            .sort((left, right) => left.position - right.position);
          const firstHuman = accepted.find(
            (item) => item.owner === "me" || item.owner === "together",
          );
          const first = firstHuman ?? accepted[0];
          if (!first) {
            throw new DayPlanInvalidTransition(
              "Start My Day requires one accepted focus.",
            );
          }
          for (const item of accepted) {
            item.decision = "accepted";
            item.humanDecisionEventIds = [
              ...new Set([...item.humanDecisionEventIds, input.mutationId]),
            ];
          }
          plan.state = "active";
          plan.arrivalState = "confirmed";
          plan.recommendedFirstItemId = first.id;
          plan.recommendedFirstTaskId = first.taskId;
          plan.confirmedAt = changedAt;
          break;
        }
        case "settlement_offer":
          if (
            plan.state !== "active" &&
            !(plan.state === "proposed" && ["bypassed", "skipped"].includes(plan.arrivalState))
          ) {
            throw new DayPlanInvalidTransition("Settlement cannot be offered yet.");
          }
          requireState(
            plan.settlementState,
            ["not_due", "skipped"],
            "Settlement is already open or complete.",
          );
          plan.settlementState = "offered";
          break;
        case "settlement_skip":
          requireState(
            plan.settlementState,
            ["offered"],
            "Only an offered settlement can be skipped.",
          );
          plan.settlementState = "skipped";
          break;
        case "settlement_start":
          if (
            plan.state !== "active" &&
            !(plan.state === "proposed" && ["bypassed", "skipped"].includes(plan.arrivalState))
          ) {
            throw new DayPlanInvalidTransition("Settlement cannot start yet.");
          }
          requireState(
            plan.settlementState,
            ["not_due", "offered", "skipped"],
            "Settlement is already in progress or complete.",
          );
          plan.state = "settling";
          plan.settlementState = "in_progress";
          break;
        case "settlement_decide": {
          if (plan.state !== "settling" || plan.settlementState !== "in_progress") {
            throw new DayPlanInvalidTransition("Settlement decisions require an active settlement.");
          }
          const item = requireItem(plan, input.itemId);
          if (item.decision !== "accepted") {
            throw new DayPlanInvalidTransition("Only accepted work needs a settlement decision.");
          }
          if (!input.disposition) {
            throw new DayPlanInvalidTransition("Settlement disposition is required.");
          }
          let deferUntil: string | undefined;
          if (input.disposition === "defer") {
            const deferDate = input.deferUntil ? new Date(input.deferUntil) : undefined;
            if (!deferDate || Number.isNaN(deferDate.getTime()) || deferDate <= now()) {
              throw new DayPlanInvalidTransition("Deferred work needs a future return time.");
            }
            deferUntil = deferDate.toISOString();
          }
          item.settlementDecision = {
            disposition: input.disposition,
            deferUntil,
            decidedAt: changedAt,
          };
          break;
        }
        case "settlement_commit": {
          if (plan.state !== "settling" || plan.settlementState !== "in_progress") {
            throw new DayPlanInvalidTransition("Settlement is not ready to commit.");
          }
          const accepted = plan.items.filter((item) => item.decision === "accepted");
          const acceptedTaskIds = new Set(accepted.map((item) => item.taskId));
          const completed = [...new Set(input.completedHumanTaskIds ?? [])];
          if (completed.some((taskId) => !acceptedTaskIds.has(taskId))) {
            throw new DayPlanInvalidTransition("Completed work must belong to this day plan.");
          }
          const unresolved = accepted.filter((item) => !completed.includes(item.taskId));
          if (unresolved.some((item) => !item.settlementDecision)) {
            throw new DayPlanInvalidTransition(
              "Every unfinished accepted item needs Carry, Defer, or Drop.",
            );
          }
          const eventRows = db
            .prepare(
              "SELECT * FROM day_plan_events WHERE day_plan_id = ? ORDER BY created_at, id",
            )
            .all(plan.id) as EventRow[];
          const firstCarry = unresolved
            .filter((item) => item.settlementDecision?.disposition === "carry")
            .sort((left, right) => left.position - right.position)[0];
          const body: DaySnapshotBody = {
            completedHumanTaskIds: completed,
            returnedAgentWork: [],
            unresolvedItems: unresolved.map((item) => ({
              dayPlanItemId: item.id,
              taskId: item.taskId,
              title: item.title,
              owner: item.owner,
              disposition: item.settlementDecision!.disposition,
              deferUntil: item.settlementDecision!.deferUntil,
            })),
            humanDecisionEventIds: [
              ...eventRows
                .filter((event) => event.event_type !== "ensure")
                .map((event) => event.id),
              input.mutationId,
            ],
            overnightQueue: [],
            nextDayRecommendationSeed: firstCarry
              ? {
                  dayPlanItemId: firstCarry.id,
                  taskId: firstCarry.taskId,
                  title: firstCarry.title,
                }
              : undefined,
          };
          snapshot = {
            id: randomUUID(),
            dayPlanId: plan.id,
            localDate: plan.localDate,
            timezone: plan.timezone,
            version: 1,
            body,
            createdAt: changedAt,
          };
          db.prepare(
            `INSERT INTO day_snapshots
              (id, day_plan_id, local_date, timezone, version, body_json, created_at)
             VALUES (?, ?, ?, ?, 1, ?, ?)`,
          ).run(
            snapshot.id,
            snapshot.dayPlanId,
            snapshot.localDate,
            snapshot.timezone,
            JSON.stringify(snapshot.body),
            snapshot.createdAt,
          );
          const insertReconciliation = db.prepare(
            `INSERT INTO day_plan_reconciliations
              (id, day_plan_id, snapshot_id, task_id, action, available_at, state, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          );
          for (const item of unresolved) {
            const disposition = item.settlementDecision!.disposition;
            if (disposition !== "defer" && disposition !== "drop") continue;
            insertReconciliation.run(
              randomUUID(),
              plan.id,
              snapshot.id,
              item.taskId,
              disposition,
              null,
              "pending",
              changedAt,
            );
            if (disposition === "defer") {
              insertReconciliation.run(
                randomUUID(),
                plan.id,
                snapshot.id,
                item.taskId,
                "resurface",
                item.settlementDecision!.deferUntil!,
                "scheduled",
                changedAt,
              );
            }
          }
          plan.nextDayNote = cleanOptional(input.nextDayNote);
          plan.state = "settled";
          plan.settlementState = "settled";
          plan.settledAt = changedAt;
          break;
        }
      }

      if (input.action.startsWith("item_") && input.itemId) {
        const changedItem = requireItem(plan, input.itemId);
        changedItem.humanDecisionEventIds = [
          ...new Set([...changedItem.humanDecisionEventIds, input.mutationId]),
        ];
      }

      plan.version += 1;
      plan.lastMutationId = input.mutationId;
      plan.updatedAt = changedAt;
      persistPlan(plan);
      appendEvent({
        id: input.mutationId,
        planId: plan.id,
        eventType: input.action,
        expectedVersion: input.expectedVersion,
        resultVersion: plan.version,
        before,
        after: plan,
        createdAt: changedAt,
      });
      return {
        plan,
        snapshot,
        pendingReconciliations: listPendingReconciliations(),
        replayed: false,
      };
    });
  }

  function acknowledgeReconciliation(
    reconciliationId: string,
  ): DayPlanReconciliationResult {
    return immediate(() => {
      const row = selectReconciliation.get(reconciliationId) as
        | ReconciliationRow
        | undefined;
      if (!row) {
        throw new DayPlanInvalidTransition("Day-plan reconciliation not found.");
      }
      if (row.state === "applied") {
        return { reconciliation: reconciliationFromRow(row), replayed: true };
      }
      const appliedAt = now().toISOString();
      if (
        row.state === "scheduled" &&
        row.available_at &&
        new Date(row.available_at) > new Date(appliedAt)
      ) {
        throw new DayPlanInvalidTransition("Day-plan reconciliation is not due yet.");
      }
      db.prepare(
        `UPDATE day_plan_reconciliations
         SET state = 'applied', applied_at = ?
         WHERE id = ? AND state IN ('pending', 'scheduled')`,
      ).run(appliedAt, reconciliationId);
      const applied = selectReconciliation.get(reconciliationId) as ReconciliationRow;
      return { reconciliation: reconciliationFromRow(applied), replayed: false };
    });
  }

  function getReadModel(): DayPlanReadModel {
    const open = selectOpenPlan.get() as DayPlanRow | undefined;
    const latestSnapshot = selectLatestSnapshot.get() as SnapshotRow | undefined;
    return {
      currentPlan: open ? planFromRow(open) : undefined,
      latestSnapshot: latestSnapshot ? snapshotFromRow(latestSnapshot) : undefined,
      pendingReconciliations: listPendingReconciliations(),
    };
  }

  function listEvents(planId: string): DayPlanEvent[] {
    const rows = db
      .prepare("SELECT * FROM day_plan_events WHERE day_plan_id = ? ORDER BY created_at, id")
      .all(planId) as EventRow[];
    return rows.map(eventFromRow);
  }

  return {
    ensureDayPlan,
    mutateDayPlan,
    acknowledgeReconciliation,
    getReadModel,
    getPlan,
    getSnapshot,
    listEvents,
    listPendingReconciliations,
    close: () => {
      if (db.open) db.close();
    },
  };
}

type DayPlanGlobal = { __forgeDayPlanStore?: DayPlanStore };

export function getDayPlanStore(): DayPlanStore {
  const global = globalThis as unknown as DayPlanGlobal;
  if (!global.__forgeDayPlanStore) {
    global.__forgeDayPlanStore = createDayPlanStore({
      dbPath:
        process.env.FORGE_DB_PATH ?? path.join(process.cwd(), "data", "forge.db"),
    });
  }
  return global.__forgeDayPlanStore;
}
