import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { DayPlanStore } from "./store";
import type { BriefSourceInput } from "./brief";
import { buildSettlementSummary, readSettlementRelay } from "./brief-relay";

// Required-source defaults. Both are configurable; these point at Alex's real
// operating files so the default installation briefs from the same documents
// he maintains by hand.
export function defaultGoalsPath(): string {
  return (
    process.env.FORGE_BRIEF_GOALS_PATH ??
    path.join(homedir(), "Atlas", "brain", "GOALS.md")
  );
}

export function defaultSprintMemoPath(): string {
  return (
    process.env.FORGE_BRIEF_SPRINT_MEMO_PATH ??
    path.join(homedir(), "Atlas", "brain", "path-to-30k-2026-07.md")
  );
}

// Forge installs on port 3200 (see scripts/install-forge-local.sh), so the
// task-snapshot fetch must default there or every installed brief would fail
// with required_source_missing:task_snapshot.
export function defaultBriefWebBase(): string {
  return process.env.FORGE_BRIEF_WEB_BASE ?? "http://127.0.0.1:3200";
}

// Per-source staleness thresholds in hours, each overridable through the
// environment (for example FORGE_BRIEF_STALE_HOURS_GOALS=2160). Past the
// threshold the source is reported "stale" in the manifest, the model is told,
// and the freshness state participates in the input hash.
function staleThresholdHours(id: string, fallback: number): number {
  const override = Number(process.env[`FORGE_BRIEF_STALE_HOURS_${id.toUpperCase()}`]);
  return Number.isFinite(override) && override > 0 ? override : fallback;
}

export type CollectedBriefSources = {
  sources: BriefSourceInput[];
  // Open task ids seen in the snapshot; generation-time validation drops brief
  // candidates that reference anything else.
  knownTaskIds: Set<string>;
};

export type MorningBriefSourceOptions = {
  store: DayPlanStore;
  goalsPath?: string;
  sprintMemoPath?: string;
  memoryDecisionsPath?: string;
  // Loopback base URL of the Forge web app; the task snapshot goes through the
  // same forge-rest surface the UI uses, so local and Supabase runtimes both work.
  webBaseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  // Overrides the relay data directory (defaults to the forge.db directory).
  // Tests point this at a temp dir to exercise the settlement relay fallback.
  dataDir?: string;
};

type TaskRow = {
  id?: string;
  column_id?: string | null;
  title?: string;
  description?: string;
  priority?: string;
  due_at?: string | null;
  status?: string;
  updated_at?: string;
  position?: number;
  tags?: unknown;
};

function taskTags(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
}

type ColumnRow = { id?: string; name?: string };

const TODAY_ALIASES = new Set(["Must happen today", "Needs to happen today", "Today"]);
const IN_FLIGHT_ALIASES = new Set(["In Flight / Waiting", "In Progress"]);
const NOT_STARTED_ALIASES = new Set(["Not Started", "To Do", "Backlog"]);

function columnBucket(name: string | undefined): string | undefined {
  if (!name) return undefined;
  if (TODAY_ALIASES.has(name)) return "today";
  if (IN_FLIGHT_ALIASES.has(name)) return "in_flight";
  if (NOT_STARTED_ALIASES.has(name)) return "not_started";
  return undefined;
}

function fileSource(
  id: string,
  label: string,
  filePath: string,
  options: {
    required: boolean;
    maxChars: number;
    priority: number;
    freshnessThresholdHours?: number;
  },
): BriefSourceInput {
  try {
    const content = readFileSync(filePath, "utf8");
    const asOf = statSync(filePath).mtime.toISOString();
    return { id, label, ...options, content, asOf, note: filePath };
  } catch {
    return { id, label, ...options, note: `unreadable:${filePath}` };
  }
}

function compactLine(value: string | undefined, maximum: number): string {
  return (value ?? "").replace(/\s+/g, " ").trim().slice(0, maximum);
}

async function fetchRows(
  fetchImpl: typeof fetch,
  baseUrl: string,
  table: string,
  timeoutMs: number,
): Promise<unknown[]> {
  const response = await fetchImpl(
    `${baseUrl}/api/forge-rest/${table}?select=*&order=position.asc`,
    { signal: AbortSignal.timeout(timeoutMs), cache: "no-store" },
  );
  if (!response.ok) throw new Error(`forge-rest ${table} ${response.status}`);
  const rows = (await response.json()) as unknown;
  if (!Array.isArray(rows)) throw new Error(`forge-rest ${table} shape`);
  return rows;
}

// Resolves configured sources, normalizes and bounds each, and reports every
// outcome truthfully in the source list. Optional sources degrade to "missing"
// on any failure; they are never a validity prerequisite.
export async function collectMorningBriefSources(
  options: MorningBriefSourceOptions,
): Promise<CollectedBriefSources> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = (options.webBaseUrl ?? defaultBriefWebBase()).replace(/\/$/, "");
  const timeoutMs = options.timeoutMs ?? 8000;

  const sources: BriefSourceInput[] = [
    fileSource("goals", "GOALS", options.goalsPath ?? defaultGoalsPath(), {
      required: true,
      maxChars: 9000,
      priority: 1,
      // Goals change rarely; a month untouched is worth flagging.
      freshnessThresholdHours: staleThresholdHours("goals", 24 * 30),
    }),
    fileSource(
      "sprint_memo",
      "SPRINT_MEMO",
      options.sprintMemoPath ?? defaultSprintMemoPath(),
      {
        required: true,
        maxChars: 12_000,
        priority: 2,
        // The sprint memo should move weekly.
        freshnessThresholdHours: staleThresholdHours("sprint_memo", 24 * 7),
      },
    ),
  ];

  const knownTaskIds = new Set<string>();
  let emailBrief: BriefSourceInput = {
    id: "email_brief",
    label: "EMAIL_BRIEF",
    required: false,
    maxChars: 3000,
    priority: 5,
    // Email triage runs twice a day; older than a day is stale.
    freshnessThresholdHours: staleThresholdHours("email_brief", 24),
  };
  try {
    const [taskRows, columnRows] = await Promise.all([
      fetchRows(fetchImpl, baseUrl, "tasks", timeoutMs),
      fetchRows(fetchImpl, baseUrl, "task_columns", timeoutMs),
    ]);
    const columns = new Map(
      (columnRows as ColumnRow[]).map((column) => [column.id, column.name]),
    );
    const lines: string[] = [];
    let newestUpdate = "";
    for (const row of taskRows as TaskRow[]) {
      if (!row.id || row.status !== "open") continue;
      const bucket = columnBucket(columns.get(row.column_id ?? undefined));
      if (!bucket) continue;
      const title = compactLine(row.title, 160);
      const tags = taskTags(row.tags).map((tag) => tag.trim().toLowerCase());
      // Candidate eligibility mirrors the arrival pool exactly (Today and
      // In-Flight commitments, excluding Jarvis-held work and the running email
      // digest card). Everything else is context the model can see but must not
      // rank, so a valid brief candidate always rehydrates at ensure time.
      const candidateEligible =
        (bucket === "today" || bucket === "in_flight") &&
        !tags.includes("jarvis-held") &&
        !title.startsWith("Emails:");
      if (candidateEligible) knownTaskIds.add(row.id);
      if (row.updated_at && row.updated_at > newestUpdate) newestUpdate = row.updated_at;
      lines.push(
        `- [${bucket}] id=${row.id} "${title}"` +
          ` priority=${row.priority ?? "medium"}` +
          (candidateEligible ? " candidate_ok" : "") +
          (row.due_at ? ` due=${row.due_at}` : "") +
          (row.updated_at ? ` updated=${row.updated_at}` : "") +
          (row.description ? ` :: ${compactLine(row.description, 240)}` : ""),
      );
      if (title.startsWith("Emails:")) {
        emailBrief = {
          ...emailBrief,
          content: `${title}\n${compactLine(row.description, 2400)}`,
          asOf: row.updated_at,
        };
      }
    }
    sources.push({
      id: "task_snapshot",
      label: "OPEN_TASKS",
      required: true,
      maxChars: 14_000,
      priority: 3,
      content: lines.length > 0 ? lines.join("\n") : "The task board has no open Today, In-Flight, or Not Started work.",
      asOf: newestUpdate || undefined,
      // A board untouched for three days is a signal worth surfacing.
      freshnessThresholdHours: staleThresholdHours("task_snapshot", 72),
    });
  } catch (error) {
    sources.push({
      id: "task_snapshot",
      label: "OPEN_TASKS",
      required: true,
      maxChars: 14_000,
      priority: 3,
      note: error instanceof Error ? error.message.slice(0, 200) : "task_snapshot_failed",
    });
  }

  // Settlement summary: the local store is authoritative when it holds
  // snapshots. An empty local state (the Mini, whose DB no longer syncs) is
  // never treated as "no settlements"; it falls back to the relay file the MBP
  // publishes, whose as_of drives the same staleness threshold. Newest valid
  // source wins; if neither is available the source records missing.
  const settlementThreshold = staleThresholdHours("settlement_summary", 96);
  let settlementContent: string | undefined;
  let settlementAsOf: string | undefined;
  try {
    const snapshots = options.store.listRecentSnapshots(3);
    if (snapshots.length > 0) {
      const summary = buildSettlementSummary(snapshots);
      settlementContent = summary.content;
      settlementAsOf = summary.asOf;
    }
  } catch {
    // Fall through to the relay fallback below.
  }
  const relaySettlement = readSettlementRelay({ dataDir: options.dataDir });
  if (relaySettlement) {
    // Newest valid wins, compared as parsed epochs (never as strings): prefer
    // whichever source has the later as_of; an unparseable local as_of loses.
    const relayMs = Date.parse(relaySettlement.asOf);
    const localMs = settlementContent && settlementAsOf ? Date.parse(settlementAsOf) : NaN;
    if (!settlementContent || !Number.isFinite(localMs) || relayMs > localMs) {
      settlementContent = relaySettlement.content;
      settlementAsOf = relaySettlement.asOf;
    }
  }
  sources.push(
    settlementContent
      ? {
          id: "settlement_summary",
          label: "RECENT_SETTLEMENTS",
          required: true,
          maxChars: 6000,
          priority: 4,
          content: settlementContent,
          asOf: settlementAsOf,
          freshnessThresholdHours: settlementThreshold,
        }
      : {
          id: "settlement_summary",
          label: "RECENT_SETTLEMENTS",
          required: true,
          maxChars: 6000,
          priority: 4,
          note: "settlement_summary_unavailable",
        },
  );

  sources.push(emailBrief);

  const memoryPath = options.memoryDecisionsPath ?? process.env.FORGE_BRIEF_MEMORY_PATH;
  sources.push(
    memoryPath
      ? fileSource("memory_decisions", "RECENT_DECISIONS", memoryPath, {
          required: false,
          maxChars: 4000,
          priority: 6,
          freshnessThresholdHours: staleThresholdHours("memory_decisions", 24 * 7),
        })
      : {
          id: "memory_decisions",
          label: "RECENT_DECISIONS",
          required: false,
          maxChars: 4000,
          priority: 6,
          note: "not_configured",
        },
  );

  return { sources, knownTaskIds };
}
