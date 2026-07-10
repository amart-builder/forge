import {
  execFileSync,
  spawn,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import { chmodSync, closeSync, mkdirSync, openSync, writeSync } from "node:fs";
import path from "node:path";
import type { DayPlanStore } from "../day-plan/store";
import {
  buildAssistantPlannerCommand,
  buildExecutionCommand,
  parseAssistantPlannerOutput,
  parseExecutionResultSummary,
  type ClaudeCommand,
} from "./commands";

type SpawnImpl = typeof spawn;

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
};

type ChildResult = {
  exitCode: number | undefined;
  signal?: NodeJS.Signals;
  stdout: string;
  stderr: string;
  overflowed: boolean;
  terminatedBy?: "timeout" | "cancelled" | "shutdown";
};

function minimalChildEnvironment(): NodeJS.ProcessEnv {
  const allowed = [
    "HOME", "PATH", "TMPDIR", "LANG", "LC_ALL", "USER", "LOGNAME", "SHELL",
    "NODE_ENV", "XDG_CONFIG_HOME", "CLAUDE_CONFIG_DIR", "ANTHROPIC_API_KEY",
    "CLAUDE_CODE_OAUTH_TOKEN",
  ];
  return Object.fromEntries(
    allowed.flatMap((key) => process.env[key] === undefined ? [] : [[key, process.env[key]!]]),
  ) as NodeJS.ProcessEnv;
}

function signalProcessGroup(
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

export async function runOneAssistantTurn(options: ClaudeWorkerOptions): Promise<boolean> {
  const clock = options.now ?? (() => new Date());
  options.store.interruptStaleAssistantTurns(cutoff(clock(), 10 * 60 * 1000));
  const turn = options.store.claimNextAssistantTurn();
  if (!turn) return false;
  const plan = options.store.getPlan(turn.dayPlanId);
  if (!plan) {
    options.store.failAssistantTurn(turn.id, "plan_missing");
    return true;
  }
  const command = buildAssistantPlannerCommand({
    claudePath: options.claudePath,
    plan,
    turn,
    cwd: options.fallbackCwd,
  });
  const result = await spawnCommand(command, {
    spawnImpl: options.spawnImpl ?? spawn,
    timeoutMs: options.timeoutMs ?? 90_000,
    maxStdoutBytes: 1024 * 1024,
    maxStderrBytes: 64 * 1024,
    terminationGraceMs: options.terminationGraceMs ?? 2000,
    abortSignal: options.abortSignal,
  });
  if (result.signal || result.terminatedBy) {
    options.store.failAssistantTurn(turn.id, "worker_interrupted");
    return true;
  }
  if (result.exitCode !== 0 || result.overflowed) {
    options.store.failAssistantTurn(
      turn.id,
      result.overflowed ? "assistant_output_too_large" : "claude_failed",
    );
    return true;
  }
  try {
    options.store.completeAssistantTurn(turn.id, parseAssistantPlannerOutput(result.stdout));
  } catch (error) {
    options.store.failAssistantTurn(
      turn.id,
      error instanceof Error ? error.message : "assistant_output_invalid",
    );
  }
  return true;
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
    options.store.finishExecutionRun({
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
            : resultError ?? (childPid ? "claude_failed" : "spawn_failed"),
    });
  } catch (error) {
    options.store.finishExecutionRun({
      runId: run.id,
      errorCode: error instanceof Error ? error.message : "worker_failed",
    });
  } finally {
    log?.close();
  }
  return true;
}

export async function drainClaudeQueues(options: ClaudeWorkerOptions): Promise<number> {
  let processed = 0;
  while (!options.abortSignal?.aborted) {
    const assistant = await runOneAssistantTurn(options);
    if (assistant) processed += 1;
    if (options.abortSignal?.aborted) break;
    const execution = await runOneExecution(options);
    if (execution) processed += 1;
    if (!assistant && !execution) break;
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
