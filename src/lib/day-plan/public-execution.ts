import type {
  DayPlanExecutionReadiness,
  DayPlanExecutionRun,
  DayPlanUnreadyItem,
} from "./types";

export function publicExecutionReadiness(
  readiness: DayPlanExecutionReadiness,
): DayPlanExecutionReadiness {
  const publicReadiness = { ...readiness };
  delete publicReadiness.workspacePath;
  return publicReadiness;
}

export function publicExecutionRun(run: DayPlanExecutionRun): DayPlanExecutionRun {
  const publicRun = { ...run };
  delete publicRun.workspacePath;
  delete publicRun.pid;
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
