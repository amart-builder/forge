'use client';

import { useId, useState } from 'react';
import type { DayPlanExecutionState } from '@/lib/data/day-plan';
import type {
  DayPlanExecutionMode,
  DayPlanItem,
  DayPlanModelAlias,
} from '@/lib/day-plan/types';
import {
  executionReadinessMessage,
  executionRunStatusLabel,
  isRetryableRunStatus,
  selectCurrentExecutionRow,
} from '@/lib/day-plan/presentation';
import { OpenInClaudeCode } from './ClaudeRunIndicators';

const ACTIVE_RUN_STATUSES = ['queued', 'starting', 'running', 'cancelling'];

export type ExecutionConfigPanelProps = {
  item: DayPlanItem;
  ariaTitle: string;
  // Combined text used only to pick a default model by rough task complexity.
  complexityText: string;
  executionItem?: DayPlanExecutionState['items'][number];
  runs: DayPlanExecutionState['runs'];
  workspaces: DayPlanExecutionState['workspaces'];
  busy: boolean;
  executionBusy: boolean;
  executionLoading: boolean;
  quietPrimaryAction?: boolean;
  onKickoffExecution: (
    itemId: string,
    mode: DayPlanExecutionMode,
    modelAlias: DayPlanModelAlias,
    workspaceId?: string,
    budgetUsd?: number,
  ) => void | Promise<unknown>;
  onCancelExecution: (runId: string) => void | Promise<unknown>;
};

// The Claude execution controls for a single agent-owned item: mode chip, autonomous
// project/budget setup, kickoff/cancel, live status, and (when a plan or joinable session
// is ready) the Open in Claude Code button. Shared by Morning Arrival and the started view.
export default function ExecutionConfigPanel({
  item,
  ariaTitle,
  complexityText,
  executionItem,
  runs,
  workspaces,
  busy,
  executionBusy,
  executionLoading,
  quietPrimaryAction = false,
  onKickoffExecution,
  onCancelExecution,
}: ExecutionConfigPanelProps) {
  const titleId = useId();
  const [executionDraft, setExecutionDraft] = useState<{
    workspaceId?: string;
    budgetUsd?: string;
    readinessCheckedAt?: string;
  }>({});

  if (item.owner !== 'claude' && item.owner !== 'together') return null;

  const { latestRun, currentRun } = selectCurrentExecutionRow(
    runs,
    item.id,
    executionItem?.config,
  );
  const activeRun = latestRun && ACTIVE_RUN_STATUSES.includes(latestRun.status)
    ? latestRun
    : undefined;
  const readiness = executionItem?.readiness;
  const briefChanged = readiness?.codes.includes('brief_changed') ?? false;
  const configuredMode = briefChanged ||
    (item.owner === 'together' && executionItem?.config?.mode === 'autonomous')
    ? undefined
    : executionItem?.config?.mode;
  const selectedMode: DayPlanExecutionMode | undefined = item.owner === 'together'
    ? 'plan_review'
    : 'autonomous';
  const taskComplexity = complexityText.length;
  const selectedModel: DayPlanModelAlias = item.owner === 'together' || taskComplexity >= 900
    ? 'opus'
    : 'sonnet';
  const selectedWorkspaceId = executionDraft.workspaceId ?? (
    configuredMode === 'autonomous' ? executionItem?.config?.workspaceId : undefined
  ) ?? '';
  const selectedBudgetText = executionDraft.budgetUsd ?? (
    configuredMode === 'autonomous' && executionItem?.config?.budgetUsd !== undefined
      ? String(executionItem.config.budgetUsd)
      : undefined
  ) ?? '';
  const selectedWorkspace = workspaces.find(
    (workspace) => workspace.id === selectedWorkspaceId,
  );
  const selectedBudget = Number(selectedBudgetText);
  const autonomousSetupReady = selectedMode !== 'autonomous' || Boolean(
    selectedWorkspace &&
    selectedBudgetText &&
    Number.isFinite(selectedBudget) &&
    selectedBudget > 0 &&
    selectedBudget <= selectedWorkspace.maximumBudgetUsd
  );
  const locallyFixableReadinessCodes = new Set([
    'mode_required',
    'owner_not_agent',
    'brief_changed',
    'workspace_required',
    'workspace_not_allowlisted',
    'budget_required',
    'budget_exceeds_limit',
  ]);
  const readinessAllowsAttempt = Boolean(
    selectedMode &&
    autonomousSetupReady &&
    (
      readiness?.ready ||
      readiness?.codes.every((code) => locallyFixableReadinessCodes.has(code))
    ),
  );
  const controlBusy = busy || executionBusy;
  const displayedRun = activeRun ?? currentRun;
  // A current run only blocks a new kickoff while it is live or holds a result. Runs
  // that ended failed, interrupted, or cancelled are retryable: the store supports a
  // fresh attempt under the same authorization, so Kick Off stays available.
  const blockingRun = currentRun && !isRetryableRunStatus(currentRun.status)
    ? currentRun
    : undefined;
  const reviewRun = currentRun &&
    ['plan_ready', 'ready_to_join', 'awaiting_review'].includes(currentRun.status) &&
    currentRun.resultSummary?.text
    ? currentRun
    : undefined;
  const openableRun = currentRun &&
    (currentRun.status === 'plan_ready' || currentRun.status === 'ready_to_join') &&
    currentRun.claudeSessionId
    ? currentRun
    : undefined;
  const reviewHeadingId = `${titleId}-claude-review`;
  const executionStatusMessage = selectedMode === 'autonomous' && workspaces.length === 0
    ? 'Autonomous needs a connected project.'
    : selectedMode === 'autonomous' && !selectedWorkspaceId
      ? 'Choose a connected project.'
      : selectedMode === 'autonomous' && !selectedBudgetText
        ? 'Set a budget before kickoff.'
        : selectedMode === 'autonomous' && !autonomousSetupReady
          ? `Budget must be between $0.01 and $${selectedWorkspace?.maximumBudgetUsd ?? 0}.`
          : briefChanged
            ? executionReadinessMessage(readiness, item.owner)
            : displayedRun
              ? executionRunStatusLabel(displayedRun.status)
              : executionLoading
                ? 'Checking readiness…'
                : executionReadinessMessage(readiness, item.owner);

  function chooseWorkspace(workspaceId: string) {
    setExecutionDraft((current) => ({
      ...current,
      workspaceId,
      budgetUsd: undefined,
      readinessCheckedAt: readiness?.checkedAt,
    }));
  }

  return (
    <section
      className="mt-3 rounded-xl border bg-muted/40 p-3"
      aria-label={`Claude execution for ${ariaTitle}`}
      data-card-control
    >
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded-full border border-accent-blue/40 bg-accent-blue/10 px-2.5 py-1 font-medium text-foreground">
          {selectedMode === 'plan_review' ? 'Plan with Claude' : 'Autonomous'}
        </span>
      </div>
      {selectedMode === 'autonomous' && workspaces.length > 0 && (
        <div className="mt-2 grid grid-cols-[minmax(0,1fr)_minmax(6.5rem,0.7fr)] gap-2">
          <label className="min-w-0 text-xs text-muted-foreground">
            <span className="sr-only">Connected project</span>
            <select
              value={selectedWorkspaceId}
              disabled={controlBusy || Boolean(activeRun)}
              className="h-9 w-full rounded-lg border bg-background px-2 text-xs text-foreground"
              onChange={(event) => chooseWorkspace(event.target.value)}
            >
              <option value="">Project…</option>
              {workspaces.map((workspace) => (
                <option key={workspace.id} value={workspace.id}>
                  {workspace.id} (max ${workspace.maximumBudgetUsd})
                </option>
              ))}
            </select>
          </label>
          <label className="flex min-w-0 items-center rounded-lg border bg-background px-2 text-xs text-muted-foreground">
            <span className="mr-1">$</span>
            <input
              type="number"
              inputMode="decimal"
              min="0.01"
              max={selectedWorkspace?.maximumBudgetUsd}
              step="0.01"
              value={selectedBudgetText}
              disabled={controlBusy || Boolean(activeRun) || !selectedWorkspace}
              className="h-8 min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none"
              aria-label="Autonomous budget in dollars"
              placeholder={selectedWorkspace
                ? `up to ${selectedWorkspace.maximumBudgetUsd}`
                : 'budget'}
              onChange={(event) => setExecutionDraft((current) => ({
                ...current,
                budgetUsd: event.target.value,
                readinessCheckedAt: readiness?.checkedAt,
              }))}
            />
          </label>
        </div>
      )}
      <div className="mt-2 flex items-end gap-2">
        <p className="min-w-0 flex-1 text-xs leading-relaxed text-muted-foreground" role="status">
          {/* Keyed so a status change replays the subtle enter; the live region itself
              stays mounted so screen readers still announce the new text. */}
          <span key={executionStatusMessage} className="panel-pop-in inline-block">
            {executionStatusMessage}
          </span>
        </p>
        {activeRun && (
          <button
            type="button"
            disabled={controlBusy || activeRun.status === 'cancelling'}
            className="press-scale min-h-9 shrink-0 rounded-lg border px-2.5 text-xs font-medium text-muted-foreground disabled:opacity-40"
            onClick={() => void Promise.resolve(onCancelExecution(activeRun.id)).catch(() => undefined)}
          >
            {activeRun.status === 'cancelling' ? 'Cancelling…' : 'Cancel'}
          </button>
        )}
        <button
          type="button"
          disabled={
            controlBusy ||
            executionLoading ||
            !selectedMode ||
            Boolean(activeRun) ||
            Boolean(blockingRun) ||
            !readinessAllowsAttempt
          }
          className={`press-scale min-h-9 shrink-0 rounded-lg px-3 text-xs font-semibold disabled:opacity-40 ${
            quietPrimaryAction
              ? 'border text-foreground hover:bg-muted'
              : 'bg-foreground text-background'
          }`}
          onClick={() => {
            if (!selectedMode) return;
            void Promise.resolve(
              onKickoffExecution(
                item.id,
                selectedMode,
                selectedModel,
                selectedMode === 'autonomous' ? selectedWorkspaceId : undefined,
                selectedMode === 'autonomous' ? selectedBudget : undefined,
              ),
            ).catch(() => undefined);
          }}
        >
          {executionBusy
            ? 'Preparing…'
            : currentRun && isRetryableRunStatus(currentRun.status)
              ? 'Retry'
              : 'Kick Off'}
        </button>
      </div>
      {openableRun && (
        <div className="panel-pop-in mt-2 flex justify-end">
          <OpenInClaudeCode sessionId={openableRun.claudeSessionId} title={ariaTitle} />
        </div>
      )}
      {reviewRun && (
        <div
          className="panel-pop-in mt-2 max-h-28 overflow-y-auto rounded-lg border bg-background p-2.5 text-xs"
          role="region"
          aria-labelledby={reviewHeadingId}
          tabIndex={0}
        >
          <p id={reviewHeadingId} className="font-semibold text-foreground">
            {reviewRun.status === 'plan_ready' ? 'Plan ready' : 'Review Claude’s work'}
          </p>
          <p className="mt-1 whitespace-pre-wrap leading-relaxed text-muted-foreground">
            {reviewRun.resultSummary?.text}
          </p>
        </div>
      )}
    </section>
  );
}
