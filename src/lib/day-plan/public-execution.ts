import type {
  DayPlanExecutionReadiness,
  DayPlanExecutionRun,
  DayPlanExecutionRunStatus,
  DayPlanUnreadyItem,
} from "./types";

export type DayPlanExecutionAccessMode = "loopback" | "session";

// A run's claudeSessionId is a resumable handle into a local Claude CLI session. It is
// only safe to expose when the request is loopback (same machine, not a remote session)
// and the run is in a state a person can actually open: a ready plan or a session ready
// to join. Every other case strips it, exactly like workspacePath and pid.
export function includesClaudeSessionId(
  accessMode: DayPlanExecutionAccessMode | undefined,
  status: DayPlanExecutionRunStatus,
): boolean {
  return (
    accessMode === "loopback" &&
    (status === "plan_ready" || status === "ready_to_join")
  );
}

export function publicExecutionReadiness(
  readiness: DayPlanExecutionReadiness,
): DayPlanExecutionReadiness {
  const publicReadiness = { ...readiness };
  delete publicReadiness.workspacePath;
  return publicReadiness;
}

export function publicExecutionRun(
  run: DayPlanExecutionRun,
  accessMode?: DayPlanExecutionAccessMode,
): DayPlanExecutionRun {
  const publicRun = { ...run };
  delete publicRun.workspacePath;
  delete publicRun.pid;
  if (!includesClaudeSessionId(accessMode, run.status)) {
    delete (publicRun as Partial<DayPlanExecutionRun>).claudeSessionId;
  }
  return {
    ...publicRun,
    readiness: publicExecutionReadiness(run.readiness),
  };
}

export function publicUnreadyItem(item: DayPlanUnreadyItem): DayPlanUnreadyItem {
  return {
    ...item,
    readiness: publicExecutionReadiness(item.readiness),
  };
}
