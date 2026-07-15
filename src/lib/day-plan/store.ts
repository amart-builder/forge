import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type {
  DayPlan,
  DayPlanAssistantProposal,
  DayPlanAssistantTurn,
  DayPlanAssistantTurnState,
  DayPlanEvent,
  DayPlanExecutionConfig,
  DayPlanExecutionConfigResult,
  DayPlanExecutionMode,
  DayPlanExecutionReadiness,
  DayPlanExecutionResultSummary,
  DayPlanExecutionRun,
  DayPlanExecutionWorkspaceMetadata,
  DayPlanItem,
  DayPlanMutationInput,
  DayPlanMutationResult,
  DayPlanReconciliation,
  DayPlanReconciliationResult,
  DayPlanTaskMutation,
  DayPlanTaskMutationResult,
  DayPlanReadModel,
  DaySnapshot,
  DaySnapshotBody,
  DayPlanUnreadyItem,
  ConfigureDayPlanExecutionInput,
  EnsureDayPlanInput,
  KickoffDayPlanItemInput,
  KickoffDayPlanItemResult,
  RecommendationCandidate,
} from "./types";
import {
  assessDayPlanExecutionReadiness,
  dayPlanExecutionAuthorizationHash,
  dayPlanItemBriefHash,
  loadForgeExecutionEnvironment,
  selectExecutionModel,
  type ForgeExecutionEnvironment,
} from "./execution-readiness";
import { applyAssistantProposal, validateAssistantProposal } from "./assistant-patch";
import {
  morningBriefFromArtifact,
  overlayBriefOnCandidates,
  MORNING_BRIEF_PROMPT_VERSION,
  MORNING_BRIEF_SCHEMA_VERSION,
  type MorningBriefArtifact,
  type MorningBriefSalesActionRecord,
  type MorningBriefSalesActionState,
  type MorningBriefSourceManifest,
  type MorningBriefStatus,
} from "./brief";
import {
  DayPlanInvalidTransition,
  DayPlanNotFound,
  DayPlanVersionConflict,
} from "./store-errors";

type Clock = () => Date;

// Mutations that count as a meaningful arrival interaction. Each durably stamps
// arrival_interacted_at, closing the late-attach window. Arrival lifecycle
// transitions (open/snooze/skip/bypass/reopen), start_day, and settlement are
// deliberately excluded.
const CONTENT_MUTATION_ACTIONS = new Set<string>([
  "item_accept",
  "item_edit",
  "item_later",
  "item_dismiss",
  "item_owner",
  "item_reorder",
]);

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
  brief_id: string | null;
  arrival_interacted_at: string | null;
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

type AssistantTurnRow = {
  id: string;
  day_plan_id: string;
  base_version: number;
  user_text: string;
  state: DayPlanAssistantTurnState;
  proposal_json: string | null;
  result_version: number | null;
  error_code: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  applied_at: string | null;
};

type TaskMutationRow = {
  id: string;
  day_plan_id: string;
  assistant_turn_id: string;
  task_id: string;
  action: DayPlanTaskMutation["action"];
  sequence: number;
  payload_json: string;
  state: DayPlanTaskMutation["state"];
  created_at: string;
  applied_at: string | null;
};

type ExecutionConfigRow = {
  day_plan_id: string;
  item_id: string;
  mode: DayPlanExecutionMode;
  model_alias: DayPlanExecutionConfig["modelAlias"];
  workspace_id: string | null;
  budget_usd: number | null;
  brief_hash: string;
  authorization_hash: string;
  last_mutation_id: string;
  configured_at: string;
  updated_at: string;
};

type MorningBriefRow = {
  id: string;
  target_local_date: string;
  status: MorningBriefStatus;
  input_hash: string | null;
  prompt_version: number;
  schema_version: number;
  source_manifest_json: string | null;
  model_alias: string;
  effort: string;
  budget_usd: number;
  brief_json: string | null;
  error_code: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  finished_at: string | null;
};

type ExecutionRunRow = {
  id: string;
  day_plan_id: string;
  item_id: string;
  task_id: string;
  owner: DayPlanExecutionRun["owner"];
  mode: DayPlanExecutionMode;
  model_alias: DayPlanExecutionRun["modelAlias"];
  status: DayPlanExecutionRun["status"];
  idempotency_key: string;
  attempt: number;
  claude_session_id: string;
  brief_hash: string;
  authorization_hash: string;
  prompt_json: string;
  workspace_id: string | null;
  workspace_path: string | null;
  budget_usd: number | null;
  readiness_json: string;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  finished_at: string | null;
  pid: number | null;
  heartbeat_at: string | null;
  log_path: string | null;
  result_summary_json: string | null;
  exit_code: number | null;
  error_code: string | null;
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
  brief_id TEXT,
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
CREATE TABLE IF NOT EXISTS day_plan_assistant_turns (
  id TEXT PRIMARY KEY,
  day_plan_id TEXT NOT NULL,
  base_version INTEGER NOT NULL CHECK (base_version > 0),
  user_text TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('queued','running','proposed','applied','conflict','failed','cancelled')),
  proposal_json TEXT,
  result_version INTEGER,
  error_code TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  applied_at TEXT,
  FOREIGN KEY (day_plan_id) REFERENCES day_plans(id)
);
CREATE INDEX IF NOT EXISTS day_plan_assistant_turns_queue
  ON day_plan_assistant_turns(state, created_at, id);
CREATE TABLE IF NOT EXISTS day_plan_task_mutations (
  id TEXT PRIMARY KEY,
  day_plan_id TEXT NOT NULL,
  assistant_turn_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('create','update','complete')),
  sequence INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending','applied')),
  created_at TEXT NOT NULL,
  applied_at TEXT,
  UNIQUE (assistant_turn_id, task_id, action),
  FOREIGN KEY (day_plan_id) REFERENCES day_plans(id),
  FOREIGN KEY (assistant_turn_id) REFERENCES day_plan_assistant_turns(id)
);
CREATE INDEX IF NOT EXISTS day_plan_task_mutations_pending
  ON day_plan_task_mutations(state, created_at, id);
CREATE TABLE IF NOT EXISTS day_plan_execution_configs (
  day_plan_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('plan_review','autonomous')),
  model_alias TEXT NOT NULL CHECK (model_alias IN ('sonnet','opus')),
  workspace_id TEXT,
  budget_usd REAL,
  brief_hash TEXT NOT NULL,
  authorization_hash TEXT NOT NULL DEFAULT '',
  last_mutation_id TEXT NOT NULL UNIQUE,
  configured_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (day_plan_id, item_id),
  FOREIGN KEY (day_plan_id) REFERENCES day_plans(id)
);
CREATE TABLE IF NOT EXISTS day_plan_execution_runs (
  id TEXT PRIMARY KEY,
  day_plan_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  owner TEXT NOT NULL CHECK (owner IN ('claude','together')),
  mode TEXT NOT NULL CHECK (mode IN ('plan_review','autonomous')),
  model_alias TEXT NOT NULL CHECK (model_alias IN ('sonnet','opus')),
  status TEXT NOT NULL CHECK (status IN ('queued','starting','running','plan_ready','ready_to_join','awaiting_review','failed','interrupted','cancelling','cancelled')),
  idempotency_key TEXT NOT NULL UNIQUE,
  attempt INTEGER NOT NULL CHECK (attempt > 0),
  claude_session_id TEXT NOT NULL UNIQUE,
  brief_hash TEXT NOT NULL,
  authorization_hash TEXT NOT NULL DEFAULT '',
  prompt_json TEXT NOT NULL,
  workspace_id TEXT,
  workspace_path TEXT,
  budget_usd REAL,
  readiness_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  pid INTEGER,
  heartbeat_at TEXT,
  log_path TEXT,
  result_summary_json TEXT,
  exit_code INTEGER,
  error_code TEXT,
  FOREIGN KEY (day_plan_id) REFERENCES day_plans(id)
);
CREATE INDEX IF NOT EXISTS day_plan_execution_runs_by_plan
  ON day_plan_execution_runs(day_plan_id, created_at, id);
CREATE INDEX IF NOT EXISTS day_plan_execution_runs_queue
  ON day_plan_execution_runs(status, created_at, id);
CREATE TABLE IF NOT EXISTS day_plan_execution_mutations (
  id TEXT PRIMARY KEY,
  mutation_kind TEXT NOT NULL CHECK (mutation_kind IN ('configure','kickoff')),
  day_plan_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  result_id TEXT,
  result_json TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (day_plan_id) REFERENCES day_plans(id)
);
CREATE TABLE IF NOT EXISTS day_plan_briefs (
  id TEXT PRIMARY KEY,
  target_local_date TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued','running','succeeded','failed')),
  input_hash TEXT,
  prompt_version INTEGER NOT NULL,
  schema_version INTEGER NOT NULL,
  source_manifest_json TEXT,
  model_alias TEXT NOT NULL,
  effort TEXT NOT NULL,
  budget_usd REAL NOT NULL,
  brief_json TEXT,
  error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  UNIQUE (target_local_date, input_hash, prompt_version, schema_version)
);
CREATE INDEX IF NOT EXISTS day_plan_briefs_queue
  ON day_plan_briefs(status, created_at, id);
CREATE INDEX IF NOT EXISTS day_plan_briefs_by_date
  ON day_plan_briefs(target_local_date, finished_at DESC, created_at DESC);
CREATE TABLE IF NOT EXISTS day_plan_brief_action_states (
  brief_id TEXT NOT NULL,
  action_index INTEGER NOT NULL CHECK (action_index >= 0),
  state TEXT NOT NULL CHECK (state IN ('approved','edited','skipped')),
  edited_text TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (brief_id, action_index),
  FOREIGN KEY (brief_id) REFERENCES day_plan_briefs(id)
);
`;

export { DayPlanInvalidTransition, DayPlanNotFound, DayPlanVersionConflict };

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
    briefId: row.brief_id ?? undefined,
    arrivalInteractedAt: row.arrival_interacted_at ?? undefined,
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

function assistantTurnFromRow(row: AssistantTurnRow): DayPlanAssistantTurn {
  return {
    id: row.id,
    dayPlanId: row.day_plan_id,
    baseVersion: row.base_version,
    userText: row.user_text,
    state: row.state,
    proposal: row.proposal_json
      ? parseJson<DayPlanAssistantProposal>(row.proposal_json, "assistant proposal")
      : undefined,
    resultVersion: row.result_version ?? undefined,
    errorCode: row.error_code ?? undefined,
    createdAt: row.created_at,
    startedAt: row.started_at ?? undefined,
    finishedAt: row.finished_at ?? undefined,
    appliedAt: row.applied_at ?? undefined,
  };
}

function taskMutationFromRow(row: TaskMutationRow): DayPlanTaskMutation {
  return {
    id: row.id,
    dayPlanId: row.day_plan_id,
    assistantTurnId: row.assistant_turn_id,
    taskId: row.task_id,
    action: row.action,
    ...parseJson<Omit<DayPlanTaskMutation, "id" | "dayPlanId" | "assistantTurnId" | "taskId" | "action" | "state" | "createdAt" | "appliedAt">>(row.payload_json, "task mutation payload"),
    state: row.state,
    createdAt: row.created_at,
    appliedAt: row.applied_at ?? undefined,
  };
}

function executionConfigFromRow(row: ExecutionConfigRow): DayPlanExecutionConfig {
  return {
    dayPlanId: row.day_plan_id,
    itemId: row.item_id,
    mode: row.mode,
    modelAlias: row.model_alias,
    workspaceId: row.workspace_id ?? undefined,
    budgetUsd: row.budget_usd ?? undefined,
    briefHash: row.brief_hash,
    authorizationHash: row.authorization_hash,
    lastMutationId: row.last_mutation_id,
    configuredAt: row.configured_at,
    updatedAt: row.updated_at,
  };
}

function morningBriefFromRow(row: MorningBriefRow): MorningBriefArtifact {
  return {
    id: row.id,
    targetLocalDate: row.target_local_date,
    status: row.status,
    inputHash: row.input_hash ?? undefined,
    promptVersion: row.prompt_version,
    schemaVersion: row.schema_version,
    sourceManifest: row.source_manifest_json
      ? parseJson<MorningBriefSourceManifest>(row.source_manifest_json, "brief manifest")
      : undefined,
    modelAlias: row.model_alias,
    effort: row.effort,
    budgetUsd: row.budget_usd,
    briefJson: row.brief_json ?? undefined,
    errorCode: row.error_code ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at ?? undefined,
    finishedAt: row.finished_at ?? undefined,
  };
}

function executionRunFromRow(row: ExecutionRunRow): DayPlanExecutionRun {
  return {
    id: row.id,
    dayPlanId: row.day_plan_id,
    itemId: row.item_id,
    taskId: row.task_id,
    owner: row.owner,
    mode: row.mode,
    modelAlias: row.model_alias,
    status: row.status,
    idempotencyKey: row.idempotency_key,
    attempt: row.attempt,
    claudeSessionId: row.claude_session_id,
    briefHash: row.brief_hash,
    authorizationHash: row.authorization_hash,
    promptSnapshot: parseJson<DayPlanExecutionRun["promptSnapshot"]>(
      row.prompt_json,
      "execution prompt",
    ),
    workspaceId: row.workspace_id ?? undefined,
    workspacePath: row.workspace_path ?? undefined,
    budgetUsd: row.budget_usd ?? undefined,
    readiness: parseJson<DayPlanExecutionReadiness>(row.readiness_json, "execution readiness"),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at ?? undefined,
    finishedAt: row.finished_at ?? undefined,
    pid: row.pid ?? undefined,
    heartbeatAt: row.heartbeat_at ?? undefined,
    resultSummary: row.result_summary_json
      ? parseJson<DayPlanExecutionResultSummary>(row.result_summary_json, "execution result summary")
      : undefined,
    exitCode: row.exit_code ?? undefined,
    errorCode: row.error_code ?? undefined,
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

export function createDayPlanStore(options: {
  dbPath: string;
  now?: Clock;
  executionEnvironment?: ForgeExecutionEnvironment | (() => ForgeExecutionEnvironment);
}) {
  mkdirSync(path.dirname(options.dbPath), { recursive: true });
  const db = new Database(options.dbPath);
  const now = options.now ?? (() => new Date());
  const executionEnvironment = () =>
    typeof options.executionEnvironment === "function"
      ? options.executionEnvironment()
      : options.executionEnvironment ?? loadForgeExecutionEnvironment();
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  db.exec(DAY_PLAN_SCHEMA);
  const executionRunColumns = new Set(
    (db.pragma("table_info(day_plan_execution_runs)") as Array<{ name: string }>).map(
      (column) => column.name,
    ),
  );
  for (const [column, definition] of [
    ["pid", "INTEGER"],
    ["heartbeat_at", "TEXT"],
    ["log_path", "TEXT"],
    ["result_summary_json", "TEXT"],
    ["authorization_hash", "TEXT NOT NULL DEFAULT ''"],
  ] as const) {
    if (!executionRunColumns.has(column)) {
      db.exec(`ALTER TABLE day_plan_execution_runs ADD COLUMN ${column} ${definition}`);
    }
  }
  const executionConfigColumns = new Set(
    (db.pragma("table_info(day_plan_execution_configs)") as Array<{ name: string }>).map(
      (column) => column.name,
    ),
  );
  if (!executionConfigColumns.has("authorization_hash")) {
    db.exec("ALTER TABLE day_plan_execution_configs ADD COLUMN authorization_hash TEXT NOT NULL DEFAULT ''");
  }
  const taskMutationColumns = new Set(
    (db.pragma("table_info(day_plan_task_mutations)") as Array<{ name: string }>).map(
      (column) => column.name,
    ),
  );
  if (!taskMutationColumns.has("sequence")) {
    db.exec("ALTER TABLE day_plan_task_mutations ADD COLUMN sequence INTEGER NOT NULL DEFAULT 0");
  }
  const dayPlanColumns = new Set(
    (db.pragma("table_info(day_plans)") as Array<{ name: string }>).map(
      (column) => column.name,
    ),
  );
  if (!dayPlanColumns.has("brief_id")) {
    db.exec("ALTER TABLE day_plans ADD COLUMN brief_id TEXT");
  }
  if (!dayPlanColumns.has("arrival_interacted_at")) {
    db.exec("ALTER TABLE day_plans ADD COLUMN arrival_interacted_at TEXT");
  }

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
  const selectAssistantTurn = db.prepare(
    "SELECT * FROM day_plan_assistant_turns WHERE id = ?",
  );
  const selectTaskMutation = db.prepare("SELECT * FROM day_plan_task_mutations WHERE id = ?");
  const selectPendingTaskMutations = db.prepare(
    "SELECT * FROM day_plan_task_mutations WHERE state = 'pending' ORDER BY created_at, sequence, id",
  );
  const selectNextAssistantTurn = db.prepare(
    `SELECT * FROM day_plan_assistant_turns
     WHERE state = 'queued'
       AND NOT EXISTS (
         SELECT 1 FROM day_plan_assistant_turns active WHERE active.state = 'running'
       )
     ORDER BY created_at, id LIMIT 1`,
  );
  const selectExecutionConfig = db.prepare(
    "SELECT * FROM day_plan_execution_configs WHERE day_plan_id = ? AND item_id = ?",
  );
  const selectExecutionRun = db.prepare(
    "SELECT * FROM day_plan_execution_runs WHERE id = ?",
  );
  const selectNextExecutionRun = db.prepare(
    `SELECT * FROM day_plan_execution_runs
     WHERE status = 'queued' ORDER BY created_at, id LIMIT 1`,
  );
  const selectExecutionRunsByPlan = db.prepare(
    "SELECT * FROM day_plan_execution_runs WHERE day_plan_id = ? ORDER BY created_at, id",
  );
  const selectExecutionMutation = db.prepare(
    "SELECT * FROM day_plan_execution_mutations WHERE id = ?",
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

  function listPendingTaskMutations(): DayPlanTaskMutation[] {
    return (selectPendingTaskMutations.all() as TaskMutationRow[]).map(taskMutationFromRow);
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
        version = ?, last_mutation_id = ?, items_json = ?, brief_id = ?, arrival_interacted_at = ?,
        recommended_first_item_id = ?,
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
      plan.briefId ?? null,
      plan.arrivalInteractedAt ?? null,
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

  function getAssistantTurn(id: string): DayPlanAssistantTurn | undefined {
    const row = selectAssistantTurn.get(id) as AssistantTurnRow | undefined;
    return row ? assistantTurnFromRow(row) : undefined;
  }

  function getExecutionConfig(
    planId: string,
    itemId: string,
  ): DayPlanExecutionConfig | undefined {
    const row = selectExecutionConfig.get(planId, itemId) as ExecutionConfigRow | undefined;
    return row ? executionConfigFromRow(row) : undefined;
  }

  function listExecutionConfigs(planId: string): DayPlanExecutionConfig[] {
    return (db.prepare(
      "SELECT * FROM day_plan_execution_configs WHERE day_plan_id = ? ORDER BY item_id",
    ).all(planId) as ExecutionConfigRow[]).map(executionConfigFromRow);
  }

  function listExecutionRuns(planId: string): DayPlanExecutionRun[] {
    return (selectExecutionRunsByPlan.all(planId) as ExecutionRunRow[]).map(executionRunFromRow);
  }

  function itemReadiness(
    plan: DayPlan,
    item: DayPlanItem,
    config = getExecutionConfig(plan.id, item.id),
  ): DayPlanExecutionReadiness {
    return assessDayPlanExecutionReadiness({
      item,
      config,
      environment: executionEnvironment(),
    });
  }

  function executionPromptSnapshot(item: DayPlanItem): DayPlanExecutionRun["promptSnapshot"] {
    return {
      title: item.title,
      outcome: item.outcome,
      definitionOfDone: item.definitionOfDone,
      whyToday: item.whyToday,
      project: item.project,
      dueAt: item.dueAt,
    };
  }

  function findExistingItemRun(
    planId: string,
    itemId: string,
    briefHash: string,
    mode: DayPlanExecutionMode,
    authorizationHash: string,
  ): DayPlanExecutionRun | undefined {
    const row = db.prepare(
      `SELECT * FROM day_plan_execution_runs
       WHERE day_plan_id = ? AND item_id = ? AND brief_hash = ? AND mode = ?
         AND authorization_hash = ?
         AND status NOT IN ('failed','interrupted','cancelled')
       ORDER BY attempt DESC LIMIT 1`,
    ).get(planId, itemId, briefHash, mode, authorizationHash) as ExecutionRunRow | undefined;
    return row ? executionRunFromRow(row) : undefined;
  }

  function insertExecutionRun(input: {
    plan: DayPlan;
    item: DayPlanItem;
    config: DayPlanExecutionConfig;
    readiness: DayPlanExecutionReadiness;
    idempotencyKey: string;
    createdAt: string;
  }): DayPlanExecutionRun {
    const existing = findExistingItemRun(
      input.plan.id,
      input.item.id,
      input.config.briefHash,
      input.config.mode,
      input.config.authorizationHash,
    );
    if (existing) return existing;

    const priorAttempt = db.prepare(
      `SELECT COALESCE(MAX(attempt), 0) AS maximum_attempt
       FROM day_plan_execution_runs
       WHERE day_plan_id = ? AND item_id = ? AND authorization_hash = ?`,
    ).get(
      input.plan.id,
      input.item.id,
      input.config.authorizationHash,
    ) as { maximum_attempt: number };
    const run: DayPlanExecutionRun = {
      id: randomUUID(),
      dayPlanId: input.plan.id,
      itemId: input.item.id,
      taskId: input.item.taskId,
      owner: input.item.owner === "together" ? "together" : "claude",
      mode: input.config.mode,
      modelAlias: input.config.modelAlias,
      status: "queued",
      idempotencyKey: input.idempotencyKey,
      attempt: priorAttempt.maximum_attempt + 1,
      claudeSessionId: randomUUID(),
      briefHash: input.config.briefHash,
      authorizationHash: input.config.authorizationHash,
      promptSnapshot: executionPromptSnapshot(input.item),
      workspaceId: input.config.workspaceId,
      workspacePath: input.readiness.workspacePath,
      budgetUsd: input.config.budgetUsd,
      readiness: input.readiness,
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
    };
    db.prepare(
      `INSERT INTO day_plan_execution_runs
        (id, day_plan_id, item_id, task_id, owner, mode, model_alias, status,
         idempotency_key, attempt, claude_session_id, brief_hash, authorization_hash, prompt_json,
         workspace_id, workspace_path, budget_usd, readiness_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      run.id,
      run.dayPlanId,
      run.itemId,
      run.taskId,
      run.owner,
      run.mode,
      run.modelAlias,
      run.status,
      run.idempotencyKey,
      run.attempt,
      run.claudeSessionId,
      run.briefHash,
      run.authorizationHash,
      JSON.stringify(run.promptSnapshot),
      run.workspaceId ?? null,
      run.workspacePath ?? null,
      run.budgetUsd ?? null,
      JSON.stringify(run.readiness),
      run.createdAt,
      run.updatedAt,
    );
    return run;
  }

  function invalidateQueuedRunsForItem(
    plan: DayPlan,
    item: DayPlanItem,
    changedAt: string,
  ): void {
    const retained = ["pending", "preselected", "accepted"].includes(item.decision);
    const currentBriefHash = dayPlanItemBriefHash(item);
    db.prepare(
      `UPDATE day_plan_execution_runs
       SET status = 'cancelled', error_code = ?, finished_at = ?, updated_at = ?
       WHERE day_plan_id = ? AND item_id = ? AND status = 'queued'
         AND (? = 0 OR brief_hash <> ?)`,
    ).run(
      retained ? "brief_changed" : "item_not_retained",
      changedAt,
      changedAt,
      plan.id,
      item.id,
      retained ? 1 : 0,
      currentBriefHash,
    );
  }

  function configureExecution(
    input: ConfigureDayPlanExecutionInput,
  ): DayPlanExecutionConfigResult {
    return immediate(() => {
      const replay = selectExecutionMutation.get(input.mutationId) as
        | { mutation_kind: string; result_json: string | null }
        | undefined;
      if (replay) {
        if (replay.mutation_kind !== "configure" || !replay.result_json) {
          throw new DayPlanInvalidTransition("Mutation ID was already used for another action.");
        }
        const config = parseJson<DayPlanExecutionConfig>(
          replay.result_json,
          "execution configuration replay",
        );
        const plan = getPlan(config.dayPlanId);
        const item = plan?.items.find((candidate) => candidate.id === config.itemId);
        if (!plan || !item) throw new DayPlanNotFound();
        return { config, readiness: itemReadiness(plan, item, config), replayed: true };
      }

      const plan = getPlan(input.planId);
      if (!plan) throw new DayPlanNotFound();
      if (plan.version !== input.expectedVersion) throw new DayPlanVersionConflict(plan);
      // Configuring execution during an open arrival is a real interaction; freeze
      // the arrival against a late brief attach (no-op once the day is active).
      stampArrivalInteraction(input.planId, now().toISOString());
      const item = requireItem(plan, input.itemId);
      // Execution can be configured while arrival is open, and also once the day is
      // active for an accepted agent-owned item, so the started view can set up work
      // that was not ready at Start My Day. Everything else stays locked.
      const arrivalEditing = plan.state === "proposed" && plan.arrivalState === "opened";
      const activeAgentItem =
        plan.state === "active" &&
        item.decision === "accepted" &&
        (item.owner === "claude" || item.owner === "together");
      if (!arrivalEditing && !activeAgentItem) {
        throw new DayPlanInvalidTransition(
          "Execution can be configured only while arrival is open or the day is active.",
        );
      }
      requireState(
        item.decision,
        ["pending", "preselected", "accepted"],
        "Execution can be configured only for a retained arrival item.",
      );
      if (item.owner !== "claude" && item.owner !== "together") {
        throw new DayPlanInvalidTransition("Choose Claude or Together before execution mode.");
      }
      if (item.owner === "together" && input.mode !== "plan_review") {
        throw new DayPlanInvalidTransition("Together work always uses plan review.");
      }
      if (input.budgetUsd !== undefined && (!Number.isFinite(input.budgetUsd) || input.budgetUsd <= 0)) {
        throw new DayPlanInvalidTransition("Execution budget must be a positive number.");
      }

      const changedAt = now().toISOString();
      const existing = getExecutionConfig(plan.id, item.id);
      const provisional: DayPlanExecutionConfig = {
        dayPlanId: plan.id,
        itemId: item.id,
        mode: input.mode,
        modelAlias: input.modelAlias,
        workspaceId: cleanOptional(input.workspaceId),
        budgetUsd: input.budgetUsd,
        briefHash: dayPlanItemBriefHash(item),
        authorizationHash: "",
        lastMutationId: input.mutationId,
        configuredAt: existing?.configuredAt ?? changedAt,
        updatedAt: changedAt,
      };
      const readiness = itemReadiness(plan, item, provisional);
      const config: DayPlanExecutionConfig = {
        ...provisional,
        authorizationHash: dayPlanExecutionAuthorizationHash({
          briefHash: provisional.briefHash,
          mode: provisional.mode,
          modelAlias: provisional.modelAlias,
          workspaceId: provisional.workspaceId,
          workspacePath: readiness.workspacePath,
          budgetUsd: provisional.budgetUsd,
        }),
      };
      db.prepare(
        `INSERT INTO day_plan_execution_configs
          (day_plan_id, item_id, mode, model_alias, workspace_id, budget_usd,
           brief_hash, authorization_hash, last_mutation_id, configured_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(day_plan_id, item_id) DO UPDATE SET
           mode = excluded.mode, model_alias = excluded.model_alias,
           workspace_id = excluded.workspace_id, budget_usd = excluded.budget_usd,
           brief_hash = excluded.brief_hash, authorization_hash = excluded.authorization_hash,
           last_mutation_id = excluded.last_mutation_id,
           updated_at = excluded.updated_at`,
      ).run(
        config.dayPlanId,
        config.itemId,
        config.mode,
        config.modelAlias,
        config.workspaceId ?? null,
        config.budgetUsd ?? null,
        config.briefHash,
        config.authorizationHash,
        config.lastMutationId,
        config.configuredAt,
        config.updatedAt,
      );
      db.prepare(
        `UPDATE day_plan_execution_runs
         SET status = 'cancelled', error_code = 'authorization_changed',
             finished_at = ?, updated_at = ?
         WHERE day_plan_id = ? AND item_id = ? AND status = 'queued'
           AND authorization_hash <> ?`,
      ).run(changedAt, changedAt, plan.id, item.id, config.authorizationHash);
      db.prepare(
        `INSERT INTO day_plan_execution_mutations
          (id, mutation_kind, day_plan_id, item_id, result_json, created_at)
         VALUES (?, 'configure', ?, ?, ?, ?)`,
      ).run(
        input.mutationId,
        plan.id,
        item.id,
        JSON.stringify(config),
        changedAt,
      );
      return { config, readiness, replayed: false };
    });
  }

  function kickoffItem(input: KickoffDayPlanItemInput): KickoffDayPlanItemResult {
    return immediate(() => {
      const replay = selectExecutionMutation.get(input.mutationId) as
        | { mutation_kind: string; day_plan_id: string; item_id: string; result_id: string | null }
        | undefined;
      if (replay) {
        if (replay.mutation_kind !== "kickoff") {
          throw new DayPlanInvalidTransition("Mutation ID was already used for another action.");
        }
        const replayedPlan = getPlan(replay.day_plan_id);
        if (!replayedPlan) throw new DayPlanNotFound();
        const item = requireItem(replayedPlan, replay.item_id);
        const config = getExecutionConfig(replayedPlan.id, item.id);
        const readiness = itemReadiness(replayedPlan, item, config);
        const run = replay.result_id
          ? executionRunFromRow(selectExecutionRun.get(replay.result_id) as ExecutionRunRow)
          : undefined;
        return { plan: replayedPlan, run, readiness, replayed: true };
      }

      const plan = getPlan(input.planId);
      if (!plan) throw new DayPlanNotFound();
      if (plan.version !== input.expectedVersion) throw new DayPlanVersionConflict(plan);
      if (
        !(
          (plan.state === "proposed" && plan.arrivalState === "opened") ||
          plan.state === "active"
        )
      ) {
        throw new DayPlanInvalidTransition("Kickoff requires an open arrival or active day.");
      }
      // Kicking off work from an open arrival is a real interaction (no-op once
      // the day is active).
      stampArrivalInteraction(input.planId, now().toISOString());
      const before = clonePlan(plan);
      const item = requireItem(plan, input.itemId);
      requireState(
        item.decision,
        ["pending", "preselected", "accepted"],
        "Only retained work can be kicked off.",
      );
      const config = getExecutionConfig(plan.id, item.id);
      const readiness = itemReadiness(plan, item, config);
      const changedAt = now().toISOString();
      let run: DayPlanExecutionRun | undefined;
      if (readiness.ready && config) {
        item.decision = "accepted";
        item.humanDecisionEventIds = [
          ...new Set([...item.humanDecisionEventIds, input.mutationId]),
        ];
        run = insertExecutionRun({
          plan,
          item,
          config,
          readiness,
          idempotencyKey: input.mutationId,
          createdAt: changedAt,
        });
        plan.version += 1;
        plan.lastMutationId = input.mutationId;
        plan.updatedAt = changedAt;
        persistPlan(plan);
        appendEvent({
          id: input.mutationId,
          planId: plan.id,
          eventType: "item_kickoff",
          expectedVersion: input.expectedVersion,
          resultVersion: plan.version,
          before,
          after: { plan, runId: run.id },
          createdAt: changedAt,
        });
      }
      db.prepare(
        `INSERT INTO day_plan_execution_mutations
          (id, mutation_kind, day_plan_id, item_id, result_id, created_at)
         VALUES (?, 'kickoff', ?, ?, ?, ?)`,
      ).run(input.mutationId, plan.id, item.id, run?.id ?? null, changedAt);
      return { plan, run, readiness, replayed: false };
    });
  }

  function createAssistantTurn(input: {
    id: string;
    planId: string;
    expectedVersion: number;
    userText: string;
  }): { turn: DayPlanAssistantTurn; replayed: boolean } {
    return immediate(() => {
      const existing = getAssistantTurn(input.id);
      if (existing) {
        if (
          existing.dayPlanId !== input.planId ||
          existing.baseVersion !== input.expectedVersion ||
          existing.userText !== input.userText.trim()
        ) {
          throw new DayPlanInvalidTransition("Assistant turn ID was already used.");
        }
        return { turn: existing, replayed: true };
      }
      const plan = getPlan(input.planId);
      if (!plan) throw new DayPlanNotFound();
      if (plan.version !== input.expectedVersion) throw new DayPlanVersionConflict(plan);
      requireArrivalEditing(plan);
      const userText = input.userText.trim();
      if (!userText) throw new DayPlanInvalidTransition("Assistant prompt cannot be empty.");
      if (userText.length > 4000) {
        throw new DayPlanInvalidTransition("Assistant prompt is too long.");
      }
      const createdAt = now().toISOString();
      db.prepare(
        `INSERT INTO day_plan_assistant_turns
          (id, day_plan_id, base_version, user_text, state, created_at)
         VALUES (?, ?, ?, ?, 'queued', ?)`,
      ).run(input.id, plan.id, plan.version, userText, createdAt);
      // Submitting a refine-box turn is a real interaction; freeze the arrival.
      stampArrivalInteraction(plan.id, createdAt);
      return { turn: getAssistantTurn(input.id)!, replayed: false };
    });
  }

  function claimNextAssistantTurn(): DayPlanAssistantTurn | undefined {
    return immediate(() => {
      const row = selectNextAssistantTurn.get() as AssistantTurnRow | undefined;
      if (!row) return undefined;
      const plan = getPlan(row.day_plan_id);
      if (!plan) throw new DayPlanNotFound();
      const startedAt = now().toISOString();
      const changed = db.prepare(
        `UPDATE day_plan_assistant_turns
         SET state = 'running', base_version = ?, started_at = ?
         WHERE id = ? AND state = 'queued'`,
      ).run(plan.version, startedAt, row.id);
      if (changed.changes !== 1) return undefined;
      return getAssistantTurn(row.id);
    });
  }

  function completeAssistantTurn(
    turnId: string,
    proposalInput: DayPlanAssistantProposal,
  ): { turn: DayPlanAssistantTurn; plan?: DayPlan } {
    return immediate(() => {
      const row = selectAssistantTurn.get(turnId) as AssistantTurnRow | undefined;
      if (!row) throw new DayPlanInvalidTransition("Assistant turn not found.");
      if (row.state === "applied" || row.state === "proposed" || row.state === "conflict") {
        return { turn: assistantTurnFromRow(row), plan: getPlan(row.day_plan_id) };
      }
      if (row.state !== "running") {
        throw new DayPlanInvalidTransition("Assistant turn is not running.");
      }
      const plan = getPlan(row.day_plan_id);
      if (!plan) throw new DayPlanNotFound();
      const finishedAt = now().toISOString();
      if (plan.version !== row.base_version) {
        db.prepare(
          `UPDATE day_plan_assistant_turns
           SET state = 'conflict', error_code = 'version_conflict', finished_at = ?
           WHERE id = ?`,
        ).run(finishedAt, row.id);
        return { turn: getAssistantTurn(row.id)!, plan };
      }
      requireArrivalEditing(plan);
      const proposal = validateAssistantProposal(plan, proposalInput);
      if (proposal.operations.length === 0) {
        db.prepare(
          `UPDATE day_plan_assistant_turns
           SET state = 'proposed', proposal_json = ?, finished_at = ?
           WHERE id = ?`,
        ).run(JSON.stringify(proposal), finishedAt, row.id);
        return { turn: getAssistantTurn(row.id)!, plan };
      }

      const before = clonePlan(plan);
      applyAssistantProposal(plan, proposal, { now: finishedAt, idFactory: randomUUID });
      const beforeIds = new Set(before.items.map((item) => item.id));
      const createdItems = plan.items.filter((item) => !beforeIds.has(item.id));
      const descriptionFor = (item: DayPlanItem) => [
        item.outcome,
        item.definitionOfDone ? `Done means: ${item.definitionOfDone}` : undefined,
      ].filter(Boolean).join("\n\n");
      const taskMutations: Array<{
        taskId: string;
        action: DayPlanTaskMutation["action"];
        payload: Record<string, unknown>;
      }> = createdItems.map((item) => ({
        taskId: item.taskId,
        action: "create" as const,
        payload: {
          title: item.title,
          description: descriptionFor(item),
          priority: item.priority,
          project: item.project,
        },
      }));
      for (const operation of proposal.operations) {
        if (operation.operation === "edit_item") {
          const item = plan.items.find((candidate) => candidate.id === operation.itemId)!;
          const payload: Record<string, unknown> = {};
          if (operation.title !== undefined) payload.title = item.title;
          if (operation.outcome !== undefined || operation.definitionOfDone !== undefined) {
            payload.description = descriptionFor(item);
          }
          if (Object.keys(payload).length > 0) {
            taskMutations.push({ taskId: item.taskId, action: "update", payload });
          }
        } else if (operation.operation === "complete_item") {
          const item = plan.items.find((candidate) => candidate.id === operation.itemId)!;
          taskMutations.push({ taskId: item.taskId, action: "complete", payload: {} });
        }
      }
      const insertTaskMutation = db.prepare(
        `INSERT INTO day_plan_task_mutations
          (id, day_plan_id, assistant_turn_id, task_id, action, sequence, payload_json, state, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
      );
      for (const [sequence, mutation] of taskMutations.entries()) {
        insertTaskMutation.run(
          randomUUID(),
          plan.id,
          row.id,
          mutation.taskId,
          mutation.action,
          sequence,
          JSON.stringify(mutation.payload),
          finishedAt,
        );
      }
      for (const item of plan.items) invalidateQueuedRunsForItem(plan, item, finishedAt);
      const eventId = `assistant:${row.id}`;
      plan.version += 1;
      plan.lastMutationId = eventId;
      plan.updatedAt = finishedAt;
      persistPlan(plan);
      appendEvent({
        id: eventId,
        planId: plan.id,
        eventType: "assistant_patch",
        expectedVersion: row.base_version,
        resultVersion: plan.version,
        before,
        after: { plan, assistantTurnId: row.id },
        createdAt: finishedAt,
      });
      db.prepare(
        `UPDATE day_plan_assistant_turns
         SET state = 'applied', proposal_json = ?, result_version = ?,
             finished_at = ?, applied_at = ?
         WHERE id = ?`,
      ).run(JSON.stringify(proposal), plan.version, finishedAt, finishedAt, row.id);
      return { turn: getAssistantTurn(row.id)!, plan };
    });
  }

  function failAssistantTurn(turnId: string, errorCode: string): DayPlanAssistantTurn {
    return immediate(() => {
      const row = selectAssistantTurn.get(turnId) as AssistantTurnRow | undefined;
      if (!row) throw new DayPlanInvalidTransition("Assistant turn not found.");
      if (["applied", "proposed", "conflict", "cancelled"].includes(row.state)) {
        return assistantTurnFromRow(row);
      }
      db.prepare(
        `UPDATE day_plan_assistant_turns
         SET state = 'failed', error_code = ?, finished_at = ? WHERE id = ?`,
      ).run(errorCode.slice(0, 120), now().toISOString(), turnId);
      return getAssistantTurn(turnId)!;
    });
  }

  function interruptStaleAssistantTurns(staleBefore: string): number {
    const finishedAt = now().toISOString();
    return db.prepare(
      `UPDATE day_plan_assistant_turns
       SET state = 'failed', error_code = 'worker_interrupted', finished_at = ?
       WHERE state = 'running' AND started_at < ?`,
    ).run(finishedAt, staleBefore).changes;
  }

  function claimNextExecutionRun(workerPid?: number): DayPlanExecutionRun | undefined {
    return immediate(() => {
      while (true) {
        const row = selectNextExecutionRun.get() as ExecutionRunRow | undefined;
        if (!row) return undefined;
        const checkedAt = now().toISOString();
        const plan = getPlan(row.day_plan_id);
        const item = plan?.items.find((candidate) => candidate.id === row.item_id);
        const config = plan ? getExecutionConfig(plan.id, row.item_id) : undefined;
        const readiness = plan && item
          ? itemReadiness(plan, item, config)
          : undefined;
        const currentHash = item ? dayPlanItemBriefHash(item) : undefined;
        const currentAuthorizationHash = config && readiness
          ? dayPlanExecutionAuthorizationHash({
              briefHash: config.briefHash,
              mode: config.mode,
              modelAlias: config.modelAlias,
              workspaceId: config.workspaceId,
              workspacePath: readiness.workspacePath,
              budgetUsd: config.budgetUsd,
            })
          : undefined;
        const retained = item?.decision === "accepted";
        const exactAuthorization = Boolean(
          config &&
          currentAuthorizationHash === config.authorizationHash &&
          row.authorization_hash === config.authorizationHash &&
          row.mode === config.mode &&
          row.model_alias === config.modelAlias &&
          (row.workspace_id ?? undefined) === config.workspaceId &&
          (row.workspace_path ?? undefined) === readiness?.workspacePath &&
          (row.budget_usd ?? undefined) === config.budgetUsd,
        );
        if (
          !plan ||
          !item ||
          !config ||
          !retained ||
          currentHash !== row.brief_hash ||
          !exactAuthorization ||
          !readiness?.ready
        ) {
          const errorCode = !plan || !item
            ? "item_missing"
            : !retained
              ? "item_not_retained"
              : currentHash !== row.brief_hash || config?.briefHash !== row.brief_hash
                ? "brief_changed"
                : !exactAuthorization
                  ? "authorization_changed"
                  : readiness?.codes[0] ?? "not_ready";
          db.prepare(
            `UPDATE day_plan_execution_runs
             SET status = 'cancelled', error_code = ?, finished_at = ?, updated_at = ?
             WHERE id = ? AND status = 'queued'`,
          ).run(errorCode, checkedAt, checkedAt, row.id);
          continue;
        }
        const changed = db.prepare(
          `UPDATE day_plan_execution_runs
           SET status = 'starting', pid = ?, heartbeat_at = ?, started_at = ?, updated_at = ?,
               readiness_json = ?
           WHERE id = ? AND status = 'queued'`,
        ).run(
          workerPid ?? null,
          checkedAt,
          checkedAt,
          checkedAt,
          JSON.stringify(readiness),
          row.id,
        );
        if (changed.changes !== 1) continue;
        return executionRunFromRow(selectExecutionRun.get(row.id) as ExecutionRunRow);
      }
    });
  }

  function markExecutionRunRunning(runId: string, childPid: number): DayPlanExecutionRun {
    return immediate(() => {
      const updatedAt = now().toISOString();
      const changed = db.prepare(
        `UPDATE day_plan_execution_runs
         SET status = 'running', pid = ?, heartbeat_at = ?, updated_at = ?
         WHERE id = ? AND status = 'starting'`,
      ).run(childPid, updatedAt, updatedAt, runId);
      if (changed.changes !== 1) {
        throw new DayPlanInvalidTransition("Execution run is not starting.");
      }
      return executionRunFromRow(selectExecutionRun.get(runId) as ExecutionRunRow);
    });
  }

  function heartbeatExecutionRun(runId: string, childPid: number): boolean {
    const heartbeatAt = now().toISOString();
    return db.prepare(
      `UPDATE day_plan_execution_runs
       SET heartbeat_at = ?, updated_at = ?
       WHERE id = ? AND pid = ? AND status IN ('starting','running')`,
    ).run(heartbeatAt, heartbeatAt, runId, childPid).changes === 1;
  }

  function setExecutionRunLogPath(runId: string, logPath: string): boolean {
    return db.prepare(
      `UPDATE day_plan_execution_runs SET log_path = ?
       WHERE id = ? AND status IN ('starting','running')`,
    ).run(logPath.slice(0, 4096), runId).changes === 1;
  }

  function finishExecutionRun(input: {
    runId: string;
    exitCode?: number;
    interrupted?: boolean;
    errorCode?: string;
    resultSummary?: DayPlanExecutionResultSummary;
  }): DayPlanExecutionRun {
    return immediate(() => {
      const row = selectExecutionRun.get(input.runId) as ExecutionRunRow | undefined;
      if (!row) throw new DayPlanInvalidTransition("Execution run not found.");
      if (!["starting", "running", "cancelling"].includes(row.status)) {
        return executionRunFromRow(row);
      }
      const resultSummary = input.resultSummary && input.resultSummary.text.trim()
        ? {
            ...input.resultSummary,
            text: input.resultSummary.text.trim().slice(0, 8000),
          }
        : undefined;
      const status: DayPlanExecutionRun["status"] = row.status === "cancelling"
        ? "cancelled"
        : input.interrupted
        ? "interrupted"
        : input.exitCode === 0
          ? row.mode === "autonomous"
            ? "awaiting_review"
            : row.owner === "together"
              ? "ready_to_join"
              : "plan_ready"
          : "failed";
      const finishedAt = now().toISOString();
      db.prepare(
        `UPDATE day_plan_execution_runs
         SET status = ?, finished_at = ?, updated_at = ?, heartbeat_at = ?,
             exit_code = ?, error_code = ?, result_summary_json = ?
         WHERE id = ? AND status IN ('starting','running','cancelling')`,
      ).run(
        status,
        finishedAt,
        finishedAt,
        finishedAt,
        input.exitCode ?? null,
        row.status === "cancelling"
          ? "user_cancelled"
          : input.errorCode?.slice(0, 120) ?? null,
        resultSummary ? JSON.stringify(resultSummary) : null,
        input.runId,
      );
      return executionRunFromRow(selectExecutionRun.get(input.runId) as ExecutionRunRow);
    });
  }

  function cancelExecutionRun(runId: string): DayPlanExecutionRun {
    return immediate(() => {
      const row = selectExecutionRun.get(runId) as ExecutionRunRow | undefined;
      if (!row) throw new DayPlanInvalidTransition("Execution run not found.");
      const changedAt = now().toISOString();
      if (row.status === "queued") {
        db.prepare(
          `UPDATE day_plan_execution_runs
           SET status = 'cancelled', error_code = 'user_cancelled',
               finished_at = ?, updated_at = ? WHERE id = ? AND status = 'queued'`,
        ).run(changedAt, changedAt, runId);
      } else if (row.status === "starting" || row.status === "running") {
        db.prepare(
          `UPDATE day_plan_execution_runs
           SET status = 'cancelling', error_code = 'user_cancelled', updated_at = ?
           WHERE id = ? AND status IN ('starting','running')`,
        ).run(changedAt, runId);
      }
      return executionRunFromRow(selectExecutionRun.get(runId) as ExecutionRunRow);
    });
  }

  function recoverStaleExecutionRuns(staleBefore: string): DayPlanExecutionRun[] {
    return immediate(() => {
      const rows = db.prepare(
        `SELECT * FROM day_plan_execution_runs
         WHERE status IN ('starting','running','cancelling')
           AND COALESCE(heartbeat_at, started_at, created_at) < ?`,
      ).all(staleBefore) as ExecutionRunRow[];
      if (rows.length === 0) return [];
      const finishedAt = now().toISOString();
      const update = db.prepare(
        `UPDATE day_plan_execution_runs
         SET status = ?, error_code = ?, finished_at = ?, updated_at = ?
         WHERE id = ? AND status IN ('starting','running','cancelling')`,
      );
      for (const row of rows) {
        update.run(
          row.status === "cancelling" ? "cancelled" : "interrupted",
          row.status === "cancelling" ? "user_cancelled" : "worker_interrupted",
          finishedAt,
          finishedAt,
          row.id,
        );
      }
      return rows.map((row) => executionRunFromRow(row));
    });
  }

  function interruptStaleExecutionRuns(staleBefore: string): number {
    return recoverStaleExecutionRuns(staleBefore).length;
  }

  function listExecutionWorkspaces(): DayPlanExecutionWorkspaceMetadata[] {
    return [...executionEnvironment().workspaces.values()]
      .map((workspace) => ({
        id: workspace.id,
        maximumBudgetUsd: workspace.maximumBudgetUsd,
      }))
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  // -------------------------------------------------------------------------
  // Morning Brief artifacts. Rows are immutable once succeeded; regeneration
  // creates new rows and the newest eligible artifact wins at selection time.
  // -------------------------------------------------------------------------

  function getMorningBrief(id: string): MorningBriefArtifact | undefined {
    const row = db
      .prepare("SELECT * FROM day_plan_briefs WHERE id = ?")
      .get(id) as MorningBriefRow | undefined;
    return row ? morningBriefFromRow(row) : undefined;
  }

  function listMorningBriefs(targetLocalDate: string): MorningBriefArtifact[] {
    return (db
      .prepare(
        "SELECT * FROM day_plan_briefs WHERE target_local_date = ? ORDER BY created_at, id",
      )
      .all(targetLocalDate) as MorningBriefRow[]).map(morningBriefFromRow);
  }

  function latestEligibleMorningBrief(
    targetLocalDate: string,
    versions: { promptVersion: number; schemaVersion: number } = {
      promptVersion: MORNING_BRIEF_PROMPT_VERSION,
      schemaVersion: MORNING_BRIEF_SCHEMA_VERSION,
    },
  ): MorningBriefArtifact | undefined {
    const row = db
      .prepare(
        `SELECT * FROM day_plan_briefs
         WHERE target_local_date = ? AND status = 'succeeded'
           AND prompt_version = ? AND schema_version = ? AND brief_json IS NOT NULL
         ORDER BY COALESCE(finished_at, created_at) DESC, created_at DESC, id DESC
         LIMIT 1`,
      )
      .get(targetLocalDate, versions.promptVersion, versions.schemaVersion) as
      | MorningBriefRow
      | undefined;
    return row ? morningBriefFromRow(row) : undefined;
  }

  function enqueueMorningBrief(
    targetLocalDate: string,
    provenance: { modelAlias: string; effort: string; budgetUsd: number },
  ): { brief: MorningBriefArtifact; created: boolean } {
    return immediate(() => {
      const active = db
        .prepare(
          `SELECT * FROM day_plan_briefs
           WHERE target_local_date = ? AND status IN ('queued','running')
           ORDER BY created_at, id LIMIT 1`,
        )
        .get(targetLocalDate) as MorningBriefRow | undefined;
      if (active) return { brief: morningBriefFromRow(active), created: false };
      const createdAt = now().toISOString();
      const id = randomUUID();
      db.prepare(
        `INSERT INTO day_plan_briefs
          (id, target_local_date, status, prompt_version, schema_version,
           model_alias, effort, budget_usd, created_at, updated_at)
         VALUES (?, ?, 'queued', ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        targetLocalDate,
        MORNING_BRIEF_PROMPT_VERSION,
        MORNING_BRIEF_SCHEMA_VERSION,
        provenance.modelAlias,
        provenance.effort,
        provenance.budgetUsd,
        createdAt,
        createdAt,
      );
      return { brief: getMorningBrief(id)!, created: true };
    });
  }

  function claimNextMorningBrief(): MorningBriefArtifact | undefined {
    return immediate(() => {
      const row = db
        .prepare(
          `SELECT * FROM day_plan_briefs
           WHERE status = 'queued'
             AND NOT EXISTS (
               SELECT 1 FROM day_plan_briefs active WHERE active.status = 'running'
             )
           ORDER BY created_at, id LIMIT 1`,
        )
        .get() as MorningBriefRow | undefined;
      if (!row) return undefined;
      const startedAt = now().toISOString();
      db.prepare(
        `UPDATE day_plan_briefs
         SET status = 'running', started_at = ?, updated_at = ?
         WHERE id = ? AND status = 'queued'`,
      ).run(startedAt, startedAt, row.id);
      return getMorningBrief(row.id);
    });
  }

  function recordMorningBriefInputs(
    id: string,
    inputs: {
      inputHash: string;
      sourceManifest: MorningBriefSourceManifest;
      promptVersion: number;
      schemaVersion: number;
    },
  ): { duplicateOfId?: string } {
    return immediate(() => {
      const row = db
        .prepare("SELECT * FROM day_plan_briefs WHERE id = ?")
        .get(id) as MorningBriefRow | undefined;
      if (!row || row.status !== "running") return {};
      const updatedAt = now().toISOString();
      const duplicate = db
        .prepare(
          `SELECT id FROM day_plan_briefs
           WHERE target_local_date = ? AND input_hash = ?
             AND prompt_version = ? AND schema_version = ? AND status = 'succeeded'
           LIMIT 1`,
        )
        .get(
          row.target_local_date,
          inputs.inputHash,
          inputs.promptVersion,
          inputs.schemaVersion,
        ) as { id: string } | undefined;
      if (duplicate) {
        // Identical inputs already produced an artifact; skip the session and
        // let selection keep using the existing brief.
        db.prepare(
          `UPDATE day_plan_briefs
           SET status = 'failed', error_code = 'duplicate_input', finished_at = ?, updated_at = ?
           WHERE id = ? AND status = 'running'`,
        ).run(updatedAt, updatedAt, id);
        return { duplicateOfId: duplicate.id };
      }
      // Dead failed attempts with the same composite key would collide with the
      // unique index; they carry no artifact, so prune them.
      db.prepare(
        `DELETE FROM day_plan_briefs
         WHERE target_local_date = ? AND input_hash = ?
           AND prompt_version = ? AND schema_version = ? AND status = 'failed'`,
      ).run(
        row.target_local_date,
        inputs.inputHash,
        inputs.promptVersion,
        inputs.schemaVersion,
      );
      db.prepare(
        `UPDATE day_plan_briefs
         SET input_hash = ?, prompt_version = ?, schema_version = ?,
             source_manifest_json = ?, updated_at = ?
         WHERE id = ? AND status = 'running'`,
      ).run(
        inputs.inputHash,
        inputs.promptVersion,
        inputs.schemaVersion,
        JSON.stringify(inputs.sourceManifest),
        updatedAt,
        id,
      );
      return {};
    });
  }

  function completeMorningBrief(
    id: string,
    briefJson: string,
  ): MorningBriefArtifact | undefined {
    return immediate(() => {
      const finishedAt = now().toISOString();
      // Only a running row can succeed. A late finisher whose row was already
      // interrupted stays failed, so it can never clobber a newer artifact.
      const changed = db
        .prepare(
          `UPDATE day_plan_briefs
           SET status = 'succeeded', brief_json = ?, error_code = NULL,
               finished_at = ?, updated_at = ?
           WHERE id = ? AND status = 'running'`,
        )
        .run(briefJson, finishedAt, finishedAt, id).changes;
      return changed > 0 ? getMorningBrief(id) : undefined;
    });
  }

  function failMorningBrief(id: string, errorCode: string): void {
    immediate(() => {
      const finishedAt = now().toISOString();
      db.prepare(
        `UPDATE day_plan_briefs
         SET status = 'failed', error_code = ?, finished_at = ?, updated_at = ?
         WHERE id = ? AND status IN ('queued','running')`,
      ).run(errorCode.slice(0, 200), finishedAt, finishedAt, id);
    });
  }

  // Imports a relay artifact (already deeply validated by the caller) in one
  // transaction, reconciling every local same-key state:
  //   - a local succeeded row for the same composite key wins by earliest
  //     finished_at (identical content, so this only adjusts provenance);
  //   - a local queued/running row for the same date is adopted into a succeeded
  //     row carrying the imported payload (a late local finisher's complete then
  //     no-ops, which the store already tolerates);
  //   - otherwise the artifact is inserted as a new succeeded row.
  // Idempotent and safe against a concurrent local generation of the same
  // envelope. Returns whether a row was written.
  function importMorningBrief(
    artifact: MorningBriefArtifact,
  ): { imported: boolean; adopted: boolean } {
    if (artifact.status !== "succeeded" || !artifact.briefJson || !artifact.inputHash) {
      return { imported: false, adopted: false };
    }
    return immediate(() => {
      const updatedAt = now().toISOString();
      const importedFinishedAt = artifact.finishedAt ?? artifact.createdAt;
      const sameKey = db
        .prepare(
          `SELECT * FROM day_plan_briefs
           WHERE target_local_date = ? AND input_hash = ?
             AND prompt_version = ? AND schema_version = ? AND status = 'succeeded'
           LIMIT 1`,
        )
        .get(
          artifact.targetLocalDate,
          artifact.inputHash,
          artifact.promptVersion,
          artifact.schemaVersion,
        ) as MorningBriefRow | undefined;
      if (sameKey) {
        // Deterministic winner on a same-key conflict is the earliest
        // finished_at, and the winner's COMPLETE canonical payload is adopted
        // (an identical input hash does not guarantee identical model output).
        // The row id is kept so references stay valid — but a brief a plan has
        // already consumed is pinned: its content must never change under an
        // arrival that was built from it.
        const existingFinished = sameKey.finished_at ?? sameKey.created_at;
        if (importedFinishedAt < existingFinished) {
          const pinned = db
            .prepare("SELECT 1 FROM day_plans WHERE brief_id = ? LIMIT 1")
            .get(sameKey.id);
          if (!pinned) {
            db.prepare(
              `UPDATE day_plan_briefs
               SET source_manifest_json = ?, model_alias = ?, effort = ?, budget_usd = ?,
                   brief_json = ?, created_at = ?, started_at = ?, finished_at = ?, updated_at = ?
               WHERE id = ? AND status = 'succeeded'`,
            ).run(
              artifact.sourceManifest ? JSON.stringify(artifact.sourceManifest) : null,
              artifact.modelAlias,
              artifact.effort,
              artifact.budgetUsd,
              artifact.briefJson,
              artifact.createdAt,
              artifact.startedAt ?? null,
              importedFinishedAt,
              updatedAt,
              sameKey.id,
            );
          }
        }
        return { imported: false, adopted: false };
      }
      // A dead failed row with this composite key would collide with the unique
      // index on insert/adopt; it carries no artifact, so prune it first.
      db.prepare(
        `DELETE FROM day_plan_briefs
         WHERE target_local_date = ? AND input_hash = ?
           AND prompt_version = ? AND schema_version = ? AND status = 'failed'`,
      ).run(
        artifact.targetLocalDate,
        artifact.inputHash,
        artifact.promptVersion,
        artifact.schemaVersion,
      );
      const adoptable = db
        .prepare(
          `SELECT * FROM day_plan_briefs
           WHERE target_local_date = ? AND status IN ('queued','running')
           ORDER BY created_at, id LIMIT 1`,
        )
        .get(artifact.targetLocalDate) as MorningBriefRow | undefined;
      if (adoptable) {
        const changed = db
          .prepare(
            `UPDATE day_plan_briefs
             SET status = 'succeeded', input_hash = ?, prompt_version = ?, schema_version = ?,
                 source_manifest_json = ?, model_alias = ?, effort = ?, budget_usd = ?,
                 brief_json = ?, error_code = NULL,
                 started_at = COALESCE(started_at, ?), finished_at = ?, updated_at = ?
             WHERE id = ? AND status IN ('queued','running')`,
          )
          .run(
            artifact.inputHash,
            artifact.promptVersion,
            artifact.schemaVersion,
            artifact.sourceManifest ? JSON.stringify(artifact.sourceManifest) : null,
            artifact.modelAlias,
            artifact.effort,
            artifact.budgetUsd,
            artifact.briefJson,
            artifact.startedAt ?? null,
            importedFinishedAt,
            updatedAt,
            adoptable.id,
          ).changes;
        if (changed > 0) return { imported: true, adopted: true };
        // Raced with a local transition; fall through to a plain insert.
      }
      const inserted = db
        .prepare(
          `INSERT OR IGNORE INTO day_plan_briefs
            (id, target_local_date, status, input_hash, prompt_version, schema_version,
             source_manifest_json, model_alias, effort, budget_usd, brief_json, error_code,
             created_at, updated_at, started_at, finished_at)
           VALUES (?, ?, 'succeeded', ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)`,
        )
        .run(
          artifact.id,
          artifact.targetLocalDate,
          artifact.inputHash,
          artifact.promptVersion,
          artifact.schemaVersion,
          artifact.sourceManifest ? JSON.stringify(artifact.sourceManifest) : null,
          artifact.modelAlias,
          artifact.effort,
          artifact.budgetUsd,
          artifact.briefJson,
          artifact.createdAt,
          updatedAt,
          artifact.startedAt ?? null,
          importedFinishedAt,
        ).changes;
      return { imported: inserted > 0, adopted: false };
    });
  }

  function interruptStaleMorningBriefs(staleBefore: string): number {
    return db
      .prepare(
        `UPDATE day_plan_briefs
         SET status = 'failed', error_code = 'worker_interrupted', finished_at = ?, updated_at = ?
         WHERE status = 'running' AND started_at < ?`,
      )
      .run(now().toISOString(), now().toISOString(), staleBefore).changes;
  }

  function setMorningBriefSalesActionState(
    briefId: string,
    actionIndex: number,
    state: MorningBriefSalesActionState,
    editedText?: string,
  ): MorningBriefSalesActionRecord {
    return immediate(() => {
      const artifact = getMorningBrief(briefId);
      const brief = morningBriefFromArtifact(artifact);
      if (!artifact || !brief) {
        throw new DayPlanInvalidTransition("Morning brief not found.");
      }
      if (
        !Number.isInteger(actionIndex) ||
        actionIndex < 0 ||
        actionIndex >= brief.salesActions.length
      ) {
        throw new DayPlanInvalidTransition("Unknown sales action.");
      }
      const updatedAt = now().toISOString();
      db.prepare(
        `INSERT INTO day_plan_brief_action_states
          (brief_id, action_index, state, edited_text, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(brief_id, action_index) DO UPDATE SET
           state = excluded.state, edited_text = excluded.edited_text,
           updated_at = excluded.updated_at`,
      ).run(briefId, actionIndex, state, editedText ?? null, updatedAt);
      return {
        briefId,
        actionIndex,
        state,
        editedText: editedText ?? undefined,
        updatedAt,
      };
    });
  }

  function listMorningBriefSalesActionStates(
    briefId: string,
  ): MorningBriefSalesActionRecord[] {
    return (db
      .prepare(
        `SELECT brief_id, action_index, state, edited_text, updated_at
         FROM day_plan_brief_action_states WHERE brief_id = ? ORDER BY action_index`,
      )
      .all(briefId) as Array<{
        brief_id: string;
        action_index: number;
        state: MorningBriefSalesActionState;
        edited_text: string | null;
        updated_at: string;
      }>).map((row) => ({
        briefId: row.brief_id,
        actionIndex: row.action_index,
        state: row.state,
        editedText: row.edited_text ?? undefined,
        updatedAt: row.updated_at,
      }));
  }

  function listRecentSnapshots(limit = 3): DaySnapshot[] {
    return (db
      .prepare(
        "SELECT * FROM day_snapshots ORDER BY local_date DESC, created_at DESC LIMIT ?",
      )
      .all(Math.max(1, Math.min(20, limit))) as SnapshotRow[]).map(snapshotFromRow);
  }

  function ensureDayPlan(input: EnsureDayPlanInput): DayPlanMutationResult {
    return immediate(() => {
      const existingEvent = selectEvent.get(input.mutationId) as EventRow | undefined;
      if (existingEvent) {
        // A prior ensure with this id may have either returned/created a plan or
        // late-attached a brief; both replay as an untouched return.
        if (
          existingEvent.event_type !== "ensure" &&
          existingEvent.event_type !== "brief_attach"
        ) {
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
        // Guarded late-attach. A brief that landed after this plan was created
        // can still overlay a pristine, untouched arrival, but never after any
        // interaction (the durable arrival_interacted_at marker) or once a brief
        // is already consumed. All guards are checked inside this same immediate
        // transaction; the whole path is fail-open — any defect returns the plan
        // untouched via the ordinary ensure event below.
        const attached = maybeLateAttachBrief(existing, input);
        if (attached) {
          return { plan: attached, snapshot: getSnapshot(attached.id), replayed: false };
        }
        // Attach-only (the 15s late-brief poll): nothing attached, so this is a
        // deliberate silent no-op — no ledger event and the mutation id stays
        // unconsumed, so a repeating poll never grows the ledger. Only a real
        // attach above records anything (as its brief_attach event).
        if (input.attachOnly) {
          return { plan: existing, snapshot: getSnapshot(existing.id), replayed: false };
        }
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

      // Attach-only must never create a plan (the poll only runs against an
      // existing arrival; a vanished plan means the ritual moved on).
      if (input.attachOnly) throw new DayPlanNotFound();

      assertArrivalCandidates(input.candidates);

      const createdAt = now().toISOString();
      const id = randomUUID();
      // Consume today's Morning Brief when a valid one exists: its ranking,
      // rationale, and owner suggestions overlay the fresh candidate pool, and
      // deterministic order backfills anything the brief missed or that
      // vanished. Any brief problem falls open to the deterministic proposal.
      let briefArtifact: MorningBriefArtifact | undefined;
      let briefContent: ReturnType<typeof morningBriefFromArtifact>;
      let selection: ReturnType<typeof overlayBriefOnCandidates>;
      // One fallback boundary around lookup, parse, AND overlay: any defect in
      // a stored brief (including one the deep parse cannot anticipate) must
      // degrade to the deterministic proposal, never fail the ensure.
      try {
        briefArtifact = latestEligibleMorningBrief(input.localDate);
        briefContent = morningBriefFromArtifact(briefArtifact);
        selection = overlayBriefOnCandidates(input.candidates, briefContent);
      } catch {
        briefArtifact = undefined;
        briefContent = undefined;
        selection = overlayBriefOnCandidates(input.candidates, undefined);
      }
      const items: DayPlanItem[] = selection.map(({ candidate, brief }, position) => ({
        ...structuredClone(candidate),
        id: candidate.candidateId,
        position,
        decision: "preselected",
        ...(brief
          ? {
              brief,
              // The owner suggestion is preselected but fully overridable in arrival.
              owner: brief.suggestedOwner ?? candidate.owner,
            }
          : {}),
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
        briefId: briefContent && briefArtifact ? briefArtifact.id : undefined,
        createdAt,
        updatedAt: createdAt,
      };

      db.prepare(
        `INSERT INTO day_plans
          (id, local_date, timezone, open_slot, plan_state, arrival_state, settlement_state,
           version, last_mutation_id, items_json, brief_id, arrival_interacted_at,
           created_at, updated_at)
         VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
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
        plan.briefId ?? null,
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

  // Shared candidate-evidence validation for the arrival. Both plan creation and
  // the guarded late-attach must only ever build items from candidates carrying
  // current, unconflicted, single-source task evidence.
  function assertArrivalCandidates(candidates: RecommendationCandidate[]): void {
    if (candidates.length > 10) {
      throw new DayPlanInvalidTransition("Arrival supports at most ten candidates.");
    }
    if (
      new Set(candidates.map((candidate) => candidate.taskId)).size !== candidates.length ||
      new Set(candidates.map((candidate) => candidate.outcomeKey)).size !== candidates.length
    ) {
      throw new DayPlanInvalidTransition("Arrival candidates must be unique.");
    }
    if (
      candidates.some(
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
  }

  // Attaches today's eligible brief to an already-created, pristine arrival, or
  // returns undefined when any guard fails (the caller then returns the plan
  // untouched). Runs inside the caller's immediate() transaction. Fail-open: any
  // error skips the attach rather than failing the ensure.
  function maybeLateAttachBrief(
    existing: DayPlan,
    input: EnsureDayPlanInput,
  ): DayPlan | undefined {
    try {
      if (existing.briefId) return undefined;
      if (existing.state !== "proposed") return undefined;
      if (existing.arrivalState !== "due" && existing.arrivalState !== "opened") return undefined;
      // The durable no-hot-swap guard: any interaction closes the window.
      if (existing.arrivalInteractedAt) return undefined;
      if (existing.items.length > 0 && !existing.items.every((item) => item.decision === "preselected")) {
        return undefined;
      }
      // A caller that did not supply fresh candidates (an empty ensure for an
      // existing plan) must never overlay onto stale/empty evidence.
      if (input.candidates.length === 0) return undefined;
      assertArrivalCandidates(input.candidates);

      const briefArtifact = latestEligibleMorningBrief(existing.localDate);
      const briefContent = morningBriefFromArtifact(briefArtifact);
      if (!briefArtifact || !briefContent) return undefined;

      const selection = overlayBriefOnCandidates(input.candidates, briefContent);
      const items: DayPlanItem[] = selection.map(({ candidate, brief }, position) => ({
        ...structuredClone(candidate),
        id: candidate.candidateId,
        position,
        decision: "preselected",
        ...(brief
          ? { brief, owner: brief.suggestedOwner ?? candidate.owner }
          : {}),
      }));

      const changedAt = now().toISOString();
      const attached: DayPlan = {
        ...existing,
        items,
        briefId: briefArtifact.id,
        version: existing.version + 1,
        lastMutationId: input.mutationId,
        updatedAt: changedAt,
      };
      persistPlan(attached);
      appendEvent({
        id: input.mutationId,
        planId: attached.id,
        eventType: "brief_attach",
        resultVersion: attached.version,
        before: existing,
        after: attached,
        createdAt: changedAt,
      });
      return attached;
    } catch {
      return undefined;
    }
  }

  // Durably records the first arrival interaction without bumping the plan
  // version (so it never conflicts with the client's in-flight expectedVersion).
  // Only stamps a still-pristine, proposed arrival; anything else is a safe
  // no-op. Called directly by content mutations that live outside mutateDayPlan
  // (assistant turns, execution configure/kickoff).
  function stampArrivalInteraction(planId: string, at: string): void {
    db.prepare(
      `UPDATE day_plans
       SET arrival_interacted_at = COALESCE(arrival_interacted_at, ?)
       WHERE id = ? AND plan_state = 'proposed' AND arrival_state IN ('due','opened')`,
    ).run(at, planId);
  }

  // The explicit, idempotent interaction marker the client fires on first
  // meaningful touch (card expansion, typing in the refine box). Idempotent on
  // the mutation id via the event ledger; never bumps the version.
  function markArrivalInteraction(
    planId: string,
    mutationId: string,
  ): { plan: DayPlan; replayed: boolean } {
    return immediate(() => {
      const existingEvent = selectEvent.get(mutationId) as EventRow | undefined;
      if (existingEvent) {
        if (existingEvent.event_type !== "arrival_interact") {
          throw new DayPlanInvalidTransition("Mutation ID was already used for another action.");
        }
        const replayed = getPlan(existingEvent.day_plan_id);
        if (!replayed) throw new DayPlanNotFound();
        return { plan: replayed, replayed: true };
      }
      const plan = getPlan(planId);
      if (!plan) throw new DayPlanNotFound();
      const at = now().toISOString();
      stampArrivalInteraction(planId, at);
      const updated = getPlan(planId) ?? plan;
      appendEvent({
        id: mutationId,
        planId,
        eventType: "arrival_interact",
        resultVersion: updated.version,
        after: { arrivalInteractedAt: updated.arrivalInteractedAt },
        createdAt: at,
      });
      return { plan: updated, replayed: false };
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
        const replayedRuns = input.action === "start_day"
          ? listExecutionRuns(replayed.id)
          : [];
        const replayedUnready = input.action === "start_day"
          ? replayed.items
              .filter((item) => item.decision === "accepted" &&
                (item.owner === "claude" || item.owner === "together"))
              .map((item) => ({
                item,
                readiness: itemReadiness(replayed, item),
              }))
              .filter(({ readiness }) => !readiness.ready)
              .map(({ item, readiness }) => ({
                itemId: item.id,
                taskId: item.taskId,
                title: item.title,
                readiness,
              }))
          : [];
        return {
          plan: replayed,
          snapshot: getSnapshot(input.planId),
          pendingReconciliations: listPendingReconciliations(),
          executionRuns: replayedRuns.length > 0 ? replayedRuns : undefined,
          unreadyItems: replayedUnready.length > 0 ? replayedUnready : undefined,
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
      const executionRuns: DayPlanExecutionRun[] = [];
      const unreadyItems: DayPlanUnreadyItem[] = [];

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
          for (const item of accepted) {
            if (item.owner !== "claude" && item.owner !== "together") continue;
            const existingConfig = getExecutionConfig(plan.id, item.id);
            const mode: DayPlanExecutionMode = item.owner === "together"
              ? "plan_review"
              : "autonomous";
            const modelAlias = selectExecutionModel(item);
            const provisional: DayPlanExecutionConfig = {
              dayPlanId: plan.id,
              itemId: item.id,
              mode,
              modelAlias,
              workspaceId: mode === "autonomous" ? existingConfig?.workspaceId : undefined,
              budgetUsd: mode === "autonomous" ? existingConfig?.budgetUsd : undefined,
              briefHash: dayPlanItemBriefHash(item),
              authorizationHash: "",
              lastMutationId: `${input.mutationId}:route:${item.id}`,
              configuredAt: existingConfig?.configuredAt ?? changedAt,
              updatedAt: changedAt,
            };
            const provisionalReadiness = itemReadiness(plan, item, provisional);
            const config: DayPlanExecutionConfig = {
              ...provisional,
              authorizationHash: dayPlanExecutionAuthorizationHash({
                briefHash: provisional.briefHash,
                mode: provisional.mode,
                modelAlias: provisional.modelAlias,
                workspaceId: provisional.workspaceId,
                workspacePath: provisionalReadiness.workspacePath,
                budgetUsd: provisional.budgetUsd,
              }),
            };
            db.prepare(
              `INSERT INTO day_plan_execution_configs
                (day_plan_id, item_id, mode, model_alias, workspace_id, budget_usd,
                 brief_hash, authorization_hash, last_mutation_id, configured_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(day_plan_id, item_id) DO UPDATE SET
                 mode = excluded.mode, model_alias = excluded.model_alias,
                 workspace_id = excluded.workspace_id, budget_usd = excluded.budget_usd,
                 brief_hash = excluded.brief_hash, authorization_hash = excluded.authorization_hash,
                 last_mutation_id = excluded.last_mutation_id, updated_at = excluded.updated_at`,
            ).run(
              config.dayPlanId, config.itemId, config.mode, config.modelAlias,
              config.workspaceId ?? null, config.budgetUsd ?? null, config.briefHash,
              config.authorizationHash, config.lastMutationId, config.configuredAt, config.updatedAt,
            );
            const readiness = itemReadiness(plan, item, config);
            if (!readiness.ready) {
              unreadyItems.push({
                itemId: item.id,
                taskId: item.taskId,
                title: item.title,
                readiness,
              });
              continue;
            }
            executionRuns.push(insertExecutionRun({
              plan,
              item,
              config,
              readiness,
              idempotencyKey: `start-day:${plan.id}:${item.id}:${config.briefHash}`,
              createdAt: changedAt,
            }));
          }
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
                // Provenance covers human decisions only: ensure (plan
                // creation), brief_attach (system late-attach), and
                // arrival_interact (a touch marker, not a decision) are all
                // machine-recorded and excluded.
                .filter(
                  (event) =>
                    event.event_type !== "ensure" &&
                    event.event_type !== "brief_attach" &&
                    event.event_type !== "arrival_interact",
                )
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
        if (["item_edit", "item_owner", "item_later", "item_dismiss"].includes(input.action)) {
          invalidateQueuedRunsForItem(plan, changedItem, changedAt);
        }
      }

      // Every content mutation is a real interaction: it durably freezes the
      // arrival against a late brief attach. Arrival-state-only transitions
      // (open, snooze, skip) deliberately do not stamp, so a brief can still
      // attach to an opened-but-untouched arrival.
      if (CONTENT_MUTATION_ACTIONS.has(input.action) && !plan.arrivalInteractedAt) {
        plan.arrivalInteractedAt = changedAt;
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
        executionRuns: executionRuns.length > 0 ? executionRuns : undefined,
        unreadyItems: unreadyItems.length > 0 ? unreadyItems : undefined,
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

  function acknowledgeTaskMutation(mutationId: string): DayPlanTaskMutationResult {
    return immediate(() => {
      const row = selectTaskMutation.get(mutationId) as TaskMutationRow | undefined;
      if (!row) throw new DayPlanInvalidTransition("Day-plan task mutation not found.");
      if (row.state === "applied") {
        return { mutation: taskMutationFromRow(row), replayed: true };
      }
      const appliedAt = now().toISOString();
      db.prepare(
        "UPDATE day_plan_task_mutations SET state = 'applied', applied_at = ? WHERE id = ? AND state = 'pending'",
      ).run(appliedAt, mutationId);
      return {
        mutation: taskMutationFromRow(selectTaskMutation.get(mutationId) as TaskMutationRow),
        replayed: false,
      };
    });
  }

  function getReadModel(): DayPlanReadModel {
    const open = selectOpenPlan.get() as DayPlanRow | undefined;
    const latestSnapshot = selectLatestSnapshot.get() as SnapshotRow | undefined;
    return {
      currentPlan: open ? planFromRow(open) : undefined,
      latestSnapshot: latestSnapshot ? snapshotFromRow(latestSnapshot) : undefined,
      pendingReconciliations: listPendingReconciliations(),
      pendingTaskMutations: listPendingTaskMutations(),
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
    markArrivalInteraction,
    mutateDayPlan,
    createAssistantTurn,
    claimNextAssistantTurn,
    completeAssistantTurn,
    failAssistantTurn,
    interruptStaleAssistantTurns,
    getAssistantTurn,
    configureExecution,
    kickoffItem,
    getExecutionConfig,
    listExecutionConfigs,
    listExecutionRuns,
    claimNextExecutionRun,
    markExecutionRunRunning,
    heartbeatExecutionRun,
    setExecutionRunLogPath,
    finishExecutionRun,
    cancelExecutionRun,
    recoverStaleExecutionRuns,
    interruptStaleExecutionRuns,
    listExecutionWorkspaces,
    getExecutionRun: (id: string) => {
      const row = selectExecutionRun.get(id) as ExecutionRunRow | undefined;
      return row ? executionRunFromRow(row) : undefined;
    },
    getExecutionReadiness: (planId: string, itemId: string) => {
      const plan = getPlan(planId);
      if (!plan) throw new DayPlanNotFound();
      return itemReadiness(plan, requireItem(plan, itemId));
    },
    acknowledgeReconciliation,
    acknowledgeTaskMutation,
    getReadModel,
    getPlan,
    getSnapshot,
    listEvents,
    listPendingReconciliations,
    listPendingTaskMutations,
    listRecentSnapshots,
    getMorningBrief,
    listMorningBriefs,
    latestEligibleMorningBrief,
    enqueueMorningBrief,
    claimNextMorningBrief,
    recordMorningBriefInputs,
    completeMorningBrief,
    failMorningBrief,
    importMorningBrief,
    interruptStaleMorningBriefs,
    setMorningBriefSalesActionState,
    listMorningBriefSalesActionStates,
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
