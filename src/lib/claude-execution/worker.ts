import {
  execFileSync,
  spawn,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import { chmodSync, closeSync, mkdirSync, openSync, writeSync } from "node:fs";
import path from "node:path";
import type { DayPlanStore } from "../day-plan/store";
import {
  assembleMorningBriefContext,
  localDateInTimezone,
  morningBriefInputHash,
  normalizeMorningBriefNarrativeDate,
  validateMorningBrief,
  MORNING_BRIEF_PROMPT_VERSION,
  MORNING_BRIEF_SCHEMA_VERSION,
  type MorningBriefArtifact,
} from "../day-plan/brief";
import {
  collectMorningBriefSources,
  defaultGoalsPath,
  defaultSprintMemoPath,
  type CollectedBriefSources,
} from "../day-plan/brief-sources";
import {
  exportBriefArtifact,
  liveRemoteBriefAttempt,
  originHost,
  scanAndImportBriefRelay,
  sweepBriefRelayOutbox,
  verifySourceCheckpoint,
  writeBriefAttemptStatus,
  writeSettlementRelay,
  writeSourceCheckpoint,
} from "../day-plan/brief-relay";
import {
  buildExecutionCommand,
  parseExecutionResultSummary,
  type ClaudeCommand,
} from "./commands";
import {
  buildMorningBriefCommand,
  morningBriefModelConfig,
  parseMorningBriefOutput,
} from "./brief-commands";
import { markForgeOrchestratorSession } from "./orchestrator-session";
import {
  notifyExecutionRun,
  rememberNotificationTransition,
  type ExecutionNotificationInput,
} from "./notify";

type SpawnImpl = typeof spawn;
type ExecutionNotifier = (input: ExecutionNotificationInput) => void | Promise<void>;
const WORKER_PROCESS_STARTED_AT = new Date(Date.now() - process.uptime() * 1_000);
const workerNotifiedTransitions = new Set<string>();

export type ClaudeWorkerOptions = {
  store: DayPlanStore;
  claudePath: string;
  emptyMcpConfigPath: string;
  logDir: string;
  fallbackCwd: string;
  spawnImpl?: SpawnImpl;
  now?: () => Date;
  workerPid?: number;
  heartbeatIntervalMs?: number;
  timeoutMs?: number;
  terminationGraceMs?: number;
  abortSignal?: AbortSignal;
  markSession?: (sessionId: string) => void;
  openSession?: (sessionId: string) => void;
  notifyExecution?: ExecutionNotifier;
  processStartedAt?: Date;
  notifiedTransitions?: Set<string>;
};

type ChildResult = {
  exitCode: number | undefined;
  signal?: NodeJS.Signals;
  stdout: string;
  stderr: string;
  overflowed: boolean;
  terminatedBy?: "timeout" | "cancelled" | "shutdown";
};

export function emitExecutionTransitionNotification(input: {
  run: ReturnType<DayPlanStore["getExecutionRun"]>;
  previousStatus: ExecutionNotificationInput["state"];
  processStartedAt?: Date;
  notify?: ExecutionNotifier;
  notifiedTransitions?: Set<string>;
}): void {
  const run = input.run;
  if (!run || run.status === input.previousStatus) return;
  if (!["plan_ready", "ready_to_join", "awaiting_review", "failed"].includes(run.status)) return;
  const processStartedAt = input.processStartedAt ?? WORKER_PROCESS_STARTED_AT;
  if (new Date(run.updatedAt).getTime() < processStartedAt.getTime()) return;
  const notifiedTransitions = input.notifiedTransitions ?? workerNotifiedTransitions;
  const transitionKey = `${run.id}:${run.status}`;
  if (!rememberNotificationTransition(notifiedTransitions, transitionKey)) return;
  try {
    void Promise.resolve((input.notify ?? notifyExecutionRun)({
      runId: run.id,
      state: run.status,
      itemTitle: run.promptSnapshot.title,
      claudeSessionId: run.claudeSessionId,
      transitionedAt: run.updatedAt,
    })).catch(() => undefined);
  } catch {
    // Notifications never participate in the durable run lifecycle.
  }
}

export function openClaudeSessionInBackground(
  sessionId: string,
  spawnImpl: SpawnImpl = spawn,
): void {
  if (process.platform !== "darwin" || process.env.FORGE_BUDDY_DEEPLINKS === "0") return;
  try {
    const child = spawnImpl(
      "/usr/bin/open",
      ["-g", `claude://resume?session=${encodeURIComponent(sessionId)}`],
      { detached: true, stdio: "ignore" },
    );
    child.once("error", (error) => {
      console.error("Could not open Forge session in Claude Code.", error);
    });
    child.unref();
  } catch (error) {
    console.error("Could not open Forge session in Claude Code.", error);
  }
}

export function minimalChildEnvironment(): NodeJS.ProcessEnv {
  const allowed = [
    "HOME", "PATH", "TMPDIR", "LANG", "LC_ALL", "USER", "LOGNAME", "SHELL",
    "NODE_ENV", "XDG_CONFIG_HOME", "CLAUDE_CONFIG_DIR", "ANTHROPIC_API_KEY",
    "CLAUDE_CODE_OAUTH_TOKEN",
  ];
  return Object.fromEntries(
    allowed.flatMap((key) => process.env[key] === undefined ? [] : [[key, process.env[key]!]]),
  ) as NodeJS.ProcessEnv;
}

export function signalProcessGroup(
  child: ChildProcessWithoutNullStreams,
  signal: NodeJS.Signals,
): void {
  if (child.pid) {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {
      // Fall back to the direct child if the process group is already gone.
    }
  }
  try {
    child.kill(signal);
  } catch {
    // The child may have exited between the status check and signal.
  }
}

function spawnCommand(
  command: ClaudeCommand,
  options: {
    spawnImpl: SpawnImpl;
    timeoutMs: number;
    maxStdoutBytes: number;
    maxStderrBytes: number;
    onSpawn?: (child: ChildProcessWithoutNullStreams) => void;
    onChunk?: (stream: "stdout" | "stderr", chunk: Buffer) => void;
    onPulse?: () => boolean;
    pulseIntervalMs?: number;
    terminationGraceMs: number;
    abortSignal?: AbortSignal;
  },
): Promise<ChildResult> {
  return new Promise((resolve) => {
    let child: ChildProcessWithoutNullStreams;
    try {
      child = options.spawnImpl(command.executable, command.args, {
        cwd: command.cwd,
        shell: false,
        detached: true,
        stdio: ["pipe", "pipe", "pipe"],
        env: minimalChildEnvironment(),
      }) as ChildProcessWithoutNullStreams;
    } catch (error) {
      resolve({
        exitCode: undefined,
        stdout: "",
        stderr: error instanceof Error ? error.message : "spawn_failed",
        overflowed: false,
      });
      return;
    }

    let stdout = "";
    let stderr = "";
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let overflowed = false;
    let settled = false;
    let terminatedBy: ChildResult["terminatedBy"];
    let killTimer: NodeJS.Timeout | undefined;
    const terminate = (reason: NonNullable<ChildResult["terminatedBy"]>) => {
      if (terminatedBy) return;
      terminatedBy = reason;
      signalProcessGroup(child, "SIGTERM");
      killTimer = setTimeout(
        () => signalProcessGroup(child, "SIGKILL"),
        options.terminationGraceMs,
      );
      killTimer.unref();
    };
    const timer = setTimeout(() => terminate("timeout"), options.timeoutMs);
    timer.unref();
    const pulse = options.onPulse
      ? setInterval(() => {
          if (!options.onPulse?.()) terminate("cancelled");
        }, options.pulseIntervalMs ?? 15_000)
      : undefined;
    pulse?.unref();
    const onAbort = () => terminate("shutdown");
    options.abortSignal?.addEventListener("abort", onAbort, { once: true });
    try {
      options.onSpawn?.(child);
    } catch (error) {
      stderr = error instanceof Error ? error.message : "spawn_registration_failed";
      terminate("cancelled");
    }

    child.stdout.on("data", (value: Buffer | string) => {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
      options.onChunk?.("stdout", chunk);
      if (stdoutBytes + chunk.length <= options.maxStdoutBytes) {
        stdout += chunk.toString("utf8");
        stdoutBytes += chunk.length;
      } else {
        overflowed = true;
      }
    });
    child.stderr.on("data", (value: Buffer | string) => {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
      options.onChunk?.("stderr", chunk);
      if (stderrBytes + chunk.length <= options.maxStderrBytes) {
        stderr += chunk.toString("utf8");
        stderrBytes += chunk.length;
      } else {
        overflowed = true;
      }
    });
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      if (pulse) clearInterval(pulse);
      options.abortSignal?.removeEventListener("abort", onAbort);
      resolve({ exitCode: undefined, stdout, stderr: error.message, overflowed, terminatedBy });
    });
    child.once("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      if (pulse) clearInterval(pulse);
      options.abortSignal?.removeEventListener("abort", onAbort);
      resolve({
        exitCode: code ?? undefined,
        signal: signal ?? undefined,
        stdout,
        stderr,
        overflowed,
        terminatedBy,
      });
    });
    child.stdin.end(command.stdin);
  });
}

function cutoff(now: Date, ageMs: number): string {
  return new Date(now.getTime() - ageMs).toISOString();
}

export function isExpectedClaudeProcess(
  command: string,
  claudePath: string,
  sessionId: string,
): boolean {
  return command.includes(claudePath) &&
    command.includes("--session-id") &&
    command.includes(sessionId);
}

function processCommand(pid: number): string | undefined {
  try {
    return execFileSync("/bin/ps", ["-p", String(pid), "-o", "command="], {
      encoding: "utf8",
      timeout: 2000,
      maxBuffer: 64 * 1024,
    }).trim() || undefined;
  } catch {
    return undefined;
  }
}

async function terminateVerifiedOrphan(
  pid: number,
  graceMs: number,
): Promise<void> {
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, graceMs));
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    // The expected process exited after TERM.
  }
}

export async function recoverStaleOrphanGroups(
  options: ClaudeWorkerOptions,
  staleBefore: string,
): Promise<number> {
  const stale = options.store.recoverStaleExecutionRuns(staleBefore);
  for (const run of stale) {
    if (!run.pid) continue;
    const command = processCommand(run.pid);
    if (!command || !isExpectedClaudeProcess(command, options.claudePath, run.claudeSessionId)) {
      continue;
    }
    await terminateVerifiedOrphan(run.pid, options.terminationGraceMs ?? 2000);
  }
  return stale.length;
}

function createBoundedLog(logDir: string, runId: string, maximumBytes: number) {
  mkdirSync(logDir, { recursive: true, mode: 0o700 });
  chmodSync(logDir, 0o700);
  const logPath = path.join(logDir, `${runId}.jsonl`);
  const fd = openSync(logPath, "wx", 0o600);
  let written = 0;
  let truncated = false;
  return {
    path: logPath,
    write(stream: "stdout" | "stderr", chunk: Buffer) {
      if (truncated) return;
      const line = Buffer.from(`${JSON.stringify({ stream, data: chunk.toString("utf8") })}\n`);
      if (written + line.length > maximumBytes) {
        truncated = true;
        const marker = Buffer.from(`${JSON.stringify({ event: "log_truncated" })}\n`);
        if (written + marker.length <= maximumBytes) {
          writeSync(fd, marker);
          written += marker.length;
        }
        return;
      }
      writeSync(fd, line);
      written += line.length;
    },
    close() {
      closeSync(fd);
      chmodSync(logPath, 0o600);
    },
  };
}

export async function runOneExecution(options: ClaudeWorkerOptions): Promise<boolean> {
  const clock = options.now ?? (() => new Date());
  const workerPid = options.workerPid ?? process.pid;
  await recoverStaleOrphanGroups(options, cutoff(clock(), 10 * 60 * 1000));
  const run = options.store.claimNextExecutionRun(workerPid);
  if (!run) return false;

  let log: ReturnType<typeof createBoundedLog> | undefined;
  try {
    log = createBoundedLog(options.logDir, run.id, 2 * 1024 * 1024);
    options.store.setExecutionRunLogPath(run.id, log.path);
    const command = buildExecutionCommand({
      claudePath: options.claudePath,
      emptyMcpConfigPath: options.emptyMcpConfigPath,
      run,
      fallbackCwd: options.fallbackCwd,
    });
    let childPid: number | undefined;
    const result = await spawnCommand(command, {
      spawnImpl: options.spawnImpl ?? spawn,
      timeoutMs: options.timeoutMs ?? 30 * 60 * 1000,
      maxStdoutBytes: 1024 * 1024,
      maxStderrBytes: 64 * 1024,
      terminationGraceMs: options.terminationGraceMs ?? 2000,
      abortSignal: options.abortSignal,
      onSpawn: (child) => {
        childPid = child.pid;
        if (!childPid) return;
        try {
          (options.markSession ?? markForgeOrchestratorSession)(run.claudeSessionId);
        } catch (error) {
          console.error("Could not mark Forge orchestrator session.", error);
        }
        options.store.markExecutionRunRunning(run.id, childPid);
      },
      onPulse: () => childPid
        ? options.store.heartbeatExecutionRun(run.id, childPid)
        : true,
      pulseIntervalMs: options.heartbeatIntervalMs ?? 15_000,
      onChunk: (stream, chunk) => log?.write(stream, chunk),
    });
    let resultSummary;
    let resultError: string | undefined;
    if (result.exitCode === 0 && !result.terminatedBy && !result.overflowed) {
      try {
        resultSummary = parseExecutionResultSummary(result.stdout, run.mode);
      } catch (error) {
        resultError = error instanceof Error ? error.message : "execution_result_missing";
      }
    }
    const interrupted = result.terminatedBy === "shutdown" || result.terminatedBy === "timeout";
    const finished = options.store.finishExecutionRun({
      runId: run.id,
      exitCode: resultSummary ? result.exitCode : undefined,
      interrupted,
      resultSummary,
      errorCode: result.terminatedBy === "cancelled"
        ? "user_cancelled"
        : interrupted || result.signal
          ? result.terminatedBy === "timeout" ? "execution_timeout" : "worker_interrupted"
          : result.overflowed
            ? "execution_output_too_large"
            : resultSummary
              // A successful run (exit 0 with a parsed result) carries no error code.
              ? undefined
              : resultError ?? (childPid ? "claude_failed" : "spawn_failed"),
    });
    emitExecutionTransitionNotification({
      run: finished,
      previousStatus: run.status,
      processStartedAt: options.processStartedAt,
      notify: options.notifyExecution,
      notifiedTransitions: options.notifiedTransitions,
    });
    if (
      resultSummary &&
      ["plan_ready", "ready_to_join", "awaiting_review"].includes(finished.status)
    ) {
      try {
        (options.openSession ?? openClaudeSessionInBackground)(finished.claudeSessionId);
      } catch (error) {
        console.error("Could not open Forge session in Claude Code.", error);
      }
    }
  } catch (error) {
    const finished = options.store.finishExecutionRun({
      runId: run.id,
      errorCode: error instanceof Error ? error.message : "worker_failed",
    });
    emitExecutionTransitionNotification({
      run: finished,
      previousStatus: run.status,
      processStartedAt: options.processStartedAt,
      notify: options.notifyExecution,
      notifiedTransitions: options.notifiedTransitions,
    });
  } finally {
    log?.close();
  }
  return true;
}

// Cross-machine relay wiring for the brief lane. Presence turns the relay on;
// absence keeps the lane purely local (the default in tests). requireSourceCheckpoint
// marks a non-authoritative generator (the Mini): it gates on the MBP's source
// checkpoint and never publishes the checkpoint or settlement summary itself.
export type BriefRelayOptions = {
  dataDir: string;
  host?: string;
  requireSourceCheckpoint?: boolean;
  goalsPath?: string;
  sprintMemoPath?: string;
};

export type MorningBriefWorkerOptions = ClaudeWorkerOptions & {
  // Test seam; production uses the real collector (files + loopback task fetch).
  collectBriefSources?: (store: DayPlanStore) => Promise<CollectedBriefSources>;
  briefTimeoutMs?: number;
  relay?: BriefRelayOptions;
};

function isValidTimezone(zone: string | undefined): zone is string {
  if (!zone) return false;
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

// The brief lane's target-date timezone. A validated FORGE_BRIEF_TIMEZONE wins so
// the Mini (whose local day_plans is stale by design) targets Alex's real
// morning; otherwise the open plan's zone, then the latest settlement's, then
// the machine's, then UTC.
function resolveBriefTimezone(store: DayPlanStore): string {
  const readModel = store.getReadModel();
  const envZone = process.env.FORGE_BRIEF_TIMEZONE;
  return (
    (isValidTimezone(envZone) ? envZone : undefined) ??
    readModel.currentPlan?.timezone ??
    readModel.latestSnapshot?.timezone ??
    Intl.DateTimeFormat().resolvedOptions().timeZone ??
    "UTC"
  );
}

function resolveBriefTargetDate(store: DayPlanStore, now: Date): string {
  try {
    return localDateInTimezone(now, resolveBriefTimezone(store));
  } catch {
    return localDateInTimezone(now, "UTC");
  }
}

function relayCheckpointSources(relay: BriefRelayOptions): Record<string, string> {
  return {
    goals: relay.goalsPath ?? defaultGoalsPath(),
    sprint_memo: relay.sprintMemoPath ?? defaultSprintMemoPath(),
  };
}

// The Morning Brief lane. It reuses the same bounded spawn machinery as the
// other lanes but drains through its own loop, so a brief can never starve
// behind a long execution run. Brief output carries contact names and drafts,
// so unlike executions it is never mirrored into an on-disk log.
export async function runOneMorningBrief(
  options: MorningBriefWorkerOptions,
): Promise<boolean> {
  const clock = options.now ?? (() => new Date());
  // The stale sweep must always outlast the configured run timeout, or a
  // long-budget brief could be marked interrupted while still running.
  const staleAfterMs = Math.max(
    20 * 60 * 1000,
    (options.briefTimeoutMs ?? morningBriefModelConfig().timeoutMs) + 5 * 60 * 1000,
  );
  options.store.interruptStaleMorningBriefs(cutoff(clock(), staleAfterMs));
  const claimed = options.store.claimNextMorningBrief();
  if (!claimed) return false;
  const targetTimezone = resolveBriefTimezone(options.store);
  const relay = options.relay;
  const relayHost = relay?.host ?? originHost();
  // Fail a brief and, when relaying, publish a failed status so the peer machine
  // stops waiting on this attempt.
  const failBrief = (code: string) => {
    options.store.failMorningBrief(claimed.id, code);
    if (relay) {
      writeBriefAttemptStatus(
        {
          targetLocalDate: claimed.targetLocalDate,
          attemptId: claimed.id,
          state: "failed",
          errorCode: code,
        },
        { dataDir: relay.dataDir, host: relayHost, now: clock() },
      );
    }
  };
  // A non-authoritative generator (the Mini) must not brief off synced source
  // copies the MBP has not vouched for. Gate before any expensive work.
  if (relay?.requireSourceCheckpoint) {
    const verdict = verifySourceCheckpoint({
      sources: relayCheckpointSources(relay),
      now: clock(),
      dataDir: relay.dataDir,
    });
    if (!verdict.ok) {
      failBrief(`source_checkpoint_${verdict.reason}`);
      return true;
    }
  }
  if (relay) {
    writeBriefAttemptStatus(
      {
        targetLocalDate: claimed.targetLocalDate,
        attemptId: claimed.id,
        state: "running",
        startedAt: claimed.startedAt ?? clock().toISOString(),
      },
      { dataDir: relay.dataDir, host: relayHost, now: clock() },
    );
  }
  try {
    const collect =
      options.collectBriefSources ??
      ((store: DayPlanStore) =>
        collectMorningBriefSources({
          store,
          targetLocalDate: claimed.targetLocalDate,
          targetTimezone,
          now: clock(),
        }));
    const collected = await collect(options.store);
    const context = assembleMorningBriefContext(collected.sources, {
      now: clock(),
    });
    if (context.missingRequired.length > 0) {
      failBrief(`required_source_missing:${context.missingRequired.join(",")}`);
      return true;
    }
    // The hash covers the full generation envelope: the bounded sections
    // exactly as sent, target date and timezone, contract versions, model configuration,
    // and per-source freshness states.
    const inputs = options.store.recordMorningBriefInputs(claimed.id, {
      inputHash: morningBriefInputHash({
        targetLocalDate: claimed.targetLocalDate,
        targetTimezone,
        sections: context.sections,
        sourceFreshness: context.manifest.sources.map((source) => ({
          id: source.id,
          freshness: source.freshness,
        })),
        promptVersion: MORNING_BRIEF_PROMPT_VERSION,
        schemaVersion: MORNING_BRIEF_SCHEMA_VERSION,
        modelAlias: claimed.modelAlias,
        effort: claimed.effort,
        budgetUsd: claimed.budgetUsd,
      }),
      sourceManifest: context.manifest,
      promptVersion: MORNING_BRIEF_PROMPT_VERSION,
      schemaVersion: MORNING_BRIEF_SCHEMA_VERSION,
    });
    // Identical inputs already produced an artifact; nothing new to generate.
    if (inputs.duplicateOfId) return true;
    const command = buildMorningBriefCommand({
      claudePath: options.claudePath,
      emptyMcpConfigPath: options.emptyMcpConfigPath,
      cwd: options.fallbackCwd,
      targetLocalDate: claimed.targetLocalDate,
      targetTimezone,
      sections: context.sections,
      manifest: context.manifest,
      modelAlias: claimed.modelAlias,
      effort: claimed.effort,
      budgetUsd: claimed.budgetUsd,
    });
    const result = await spawnCommand(command, {
      spawnImpl: options.spawnImpl ?? spawn,
      timeoutMs: options.briefTimeoutMs ?? morningBriefModelConfig().timeoutMs,
      maxStdoutBytes: 1024 * 1024,
      maxStderrBytes: 64 * 1024,
      terminationGraceMs: options.terminationGraceMs ?? 2000,
      abortSignal: options.abortSignal,
    });
    if (result.terminatedBy || result.signal) {
      failBrief(result.terminatedBy === "timeout" ? "brief_timeout" : "worker_interrupted");
      return true;
    }
    if (result.exitCode !== 0 || result.overflowed) {
      failBrief(result.overflowed ? "brief_output_too_large" : "claude_failed");
      return true;
    }
    const validated = validateMorningBrief(parseMorningBriefOutput(result.stdout), {
      knownTaskIds: collected.knownTaskIds,
      // Bounded grounding: watch items and sales actions must cite sources the
      // model actually received bytes of (missing or fully-trimmed-out sources
      // cannot ground anything; citing them is fabrication by construction).
      sourceIds: new Set(
        context.manifest.sources
          .filter((source) => source.freshness !== "missing" && source.chars > 0)
          .map((source) => source.id),
      ),
    });
    const datedNarrative = normalizeMorningBriefNarrativeDate(
      validated.brief.lensNarrative,
      claimed.targetLocalDate,
      targetTimezone,
    );
    if (datedNarrative.contradicted) {
      console.warn("Morning brief narrative date contradicted target; corrected before storage.", {
        briefId: claimed.id,
        targetLocalDate: claimed.targetLocalDate,
        targetTimezone,
      });
    }
    const completed = options.store.completeMorningBrief(
      claimed.id,
      JSON.stringify({ ...validated.brief, lensNarrative: datedNarrative.narrative }),
    );
    // Publish the immutable artifact to the relay so the other machine imports
    // it. The authoritative machine (the MBP) also refreshes the settlement
    // summary and source checkpoint from its own state. All fail-open.
    if (relay && completed) {
      exportBriefArtifact(completed, { dataDir: relay.dataDir, host: relayHost });
      if (!relay.requireSourceCheckpoint) {
        writeSettlementRelay({ store: options.store, now: clock(), dataDir: relay.dataDir });
        writeSourceCheckpoint({
          sources: relayCheckpointSources(relay),
          now: clock(),
          dataDir: relay.dataDir,
        });
      }
    }
  } catch (error) {
    failBrief(error instanceof Error ? error.message : "brief_failed");
  }
  return true;
}

// Scheduled entry point (the ~7:30 local LaunchAgent run, which may fire late
// on wake). Targets today with a validated FORGE_BRIEF_TIMEZONE first (so the
// Mini, whose local day_plans is stale by design, still targets Alex's real
// morning), then the open plan's zone, the latest settlement's, the machine's,
// and UTC. When relaying, it first imports any already-synced artifact and waits
// while another machine has a live generation for this date. Skips cleanly when
// an eligible artifact for today already exists.
export function enqueueDueMorningBrief(
  store: DayPlanStore,
  now: Date = new Date(),
  options: { relay?: BriefRelayOptions } = {},
): MorningBriefArtifact | undefined {
  const target = resolveBriefTargetDate(store, now);
  if (options.relay) {
    scanAndImportBriefRelay({
      store,
      targetLocalDate: target,
      dataDir: options.relay.dataDir,
    });
    const remote = liveRemoteBriefAttempt({
      targetLocalDate: target,
      selfHost: options.relay.host,
      dataDir: options.relay.dataDir,
      now,
    });
    // Backfill waits: a live generation on the other machine will sync its
    // artifact in; a second generation here would only race it.
    if (remote) return undefined;
  }
  if (store.latestEligibleMorningBrief(target)) return undefined;
  const enqueued = store.enqueueMorningBrief(target, morningBriefModelConfig());
  // Announce the queued attempt immediately (not first at claim), closing the
  // enqueue→claim window in which the peer could start a duplicate generation.
  if (options.relay && enqueued.created) {
    writeBriefAttemptStatus(
      { targetLocalDate: target, attemptId: enqueued.brief.id, state: "queued" },
      { dataDir: options.relay.dataDir, host: options.relay.host, now },
    );
  }
  return enqueued.brief;
}

export async function watchMorningBriefQueue(
  options: MorningBriefWorkerOptions,
  pollIntervalMs = 2000,
): Promise<void> {
  const clock = options.now ?? (() => new Date());
  const relay = options.relay;
  // Filenames already imported this process lifetime; a cheap readdir skip.
  const importedFiles = new Set<string>();
  // The authoritative machine republishes the checkpoint + settlement relay and
  // sweeps the outbox on this cadence, not every idle cycle: the poll runs every
  // couple of seconds, and rewriting synced files that often would churn
  // Syncthing and the disk for no benefit.
  const MAINTENANCE_INTERVAL_MS = 5 * 60 * 1000;
  let lastMaintenanceAt = 0;
  while (!options.abortSignal?.aborted) {
    if (relay) {
      // Pull in any synced artifact before this machine considers generating.
      scanAndImportBriefRelay({
        store: options.store,
        targetLocalDate: resolveBriefTargetDate(options.store, clock()),
        dataDir: relay.dataDir,
        imported: importedFiles,
      });
    }
    const processed = await runOneMorningBrief(options);
    if (!processed) {
      // Idle: on the authoritative machine, keep the relay fresh — re-export any
      // succeeded row whose file went missing, and republish the settlement
      // summary and source checkpoint. Throttled; all fail-open.
      const nowMs = clock().getTime();
      if (
        relay &&
        !relay.requireSourceCheckpoint &&
        nowMs - lastMaintenanceAt >= MAINTENANCE_INTERVAL_MS
      ) {
        lastMaintenanceAt = nowMs;
        sweepBriefRelayOutbox({
          store: options.store,
          now: clock(),
          dataDir: relay.dataDir,
          host: relay.host,
        });
        writeSettlementRelay({ store: options.store, now: clock(), dataDir: relay.dataDir });
        writeSourceCheckpoint({
          sources: relayCheckpointSources(relay),
          now: clock(),
          dataDir: relay.dataDir,
        });
      }
      await waitForPoll(pollIntervalMs, options.abortSignal);
    }
  }
}

export async function drainClaudeQueues(options: ClaudeWorkerOptions): Promise<number> {
  let processed = 0;
  while (!options.abortSignal?.aborted) {
    const execution = await runOneExecution(options);
    if (execution) processed += 1;
    if (!execution) break;
  }
  return processed;
}

function waitForPoll(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      signal?.removeEventListener("abort", done);
      clearTimeout(timer);
      resolve();
    }
    signal?.addEventListener("abort", done, { once: true });
  });
}

export async function watchClaudeQueues(
  options: ClaudeWorkerOptions,
  pollIntervalMs = 1000,
): Promise<void> {
  while (!options.abortSignal?.aborted) {
    const processed = await drainClaudeQueues(options);
    if (!processed) await waitForPoll(pollIntervalMs, options.abortSignal);
  }
}
