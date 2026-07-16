'use client';

import type { DayPlanExecutionState } from '@/lib/data/day-plan';
import type {
  DayPlan,
  DayPlanExecutionMode,
  DayPlanModelAlias,
} from '@/lib/day-plan/types';
import {
  helpfulProjectLabel,
  selectStartedExecutionRows,
} from '@/lib/day-plan/presentation';
import ExecutionConfigPanel from './ExecutionConfigPanel';
import { RunStatusChip } from './ClaudeRunIndicators';

interface DayStartedProps {
  plan: DayPlan;
  executionState?: DayPlanExecutionState;
  executionLoading?: boolean;
  executionBusyItemIds?: ReadonlySet<string>;
  executionError?: string;
  busy?: boolean;
  // The hoisted DayRitualLayer owns the dialog chrome; these ids label it.
  titleId: string;
  descriptionId: string;
  onKickoffExecution: (
    itemId: string,
    mode: DayPlanExecutionMode,
    modelAlias: DayPlanModelAlias,
    workspaceId?: string,
    budgetUsd?: number,
  ) => void | Promise<unknown>;
  onCancelExecution: (runId: string) => void | Promise<unknown>;
  onEnterDay: () => void;
}

export default function DayStarted({
  plan,
  executionState,
  executionLoading = false,
  executionBusyItemIds = new Set<string>(),
  executionError,
  busy = false,
  titleId,
  descriptionId,
  onKickoffExecution,
  onCancelExecution,
  onEnterDay,
}: DayStartedProps) {
  const firstFocus =
    plan.items.find((item) => item.id === plan.recommendedFirstItemId) ??
    plan.items.find((item) => item.decision === 'accepted');
  const rows = selectStartedExecutionRows(
    plan.items,
    executionState?.items ?? [],
    executionState?.runs ?? [],
  );

  return (
      <div
        className="my-auto overflow-hidden rounded-3xl border bg-background shadow-2xl"
        data-day-plan-id={plan.id}
      >
        <div className="max-h-[calc(100dvh-7rem)] overflow-y-auto">
          <header className="sticky top-0 z-10 border-b bg-background/95 px-4 py-5 backdrop-blur sm:px-7">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Your day is set
            </p>
            <h1
              id={titleId}
              tabIndex={-1}
              className="mt-2 text-2xl font-semibold tracking-tight text-foreground outline-none sm:text-3xl"
            >
              {firstFocus ? `Start here: ${firstFocus.title}` : 'Your day is set.'}
            </h1>
            <p id={descriptionId} className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
              Claude is on the work you handed off. Watch progress, set up anything that
              still needs it, and open a session when a plan is ready.
            </p>
          </header>

          <div className="space-y-3 px-4 py-4 sm:px-7">
            {rows.length > 0 ? (
              <ul className="space-y-3" aria-label="Work handed to Claude">
                {rows.map((row) => {
                  const projectLabel = helpfulProjectLabel(row.item.project);
                  return (
                    <li key={row.item.id} className="rounded-2xl border bg-card p-4">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          {projectLabel && (
                            <span className="inline-block rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                              {projectLabel}
                            </span>
                          )}
                          <h2 className={`${projectLabel ? 'mt-1.5' : ''} text-base font-semibold leading-snug text-foreground`}>
                            {row.item.title}
                          </h2>
                        </div>
                        {row.currentRun ? (
                          <RunStatusChip status={row.currentRun.status} />
                        ) : null}
                      </div>
                      <ExecutionConfigPanel
                        item={row.item}
                        ariaTitle={row.item.title}
                        complexityText={`${row.item.title} ${row.item.outcome} ${row.item.definitionOfDone ?? ''}`}
                        executionItem={executionState?.items.find(
                          (entry) => entry.itemId === row.item.id,
                        )}
                        runs={executionState?.runs ?? []}
                        workspaces={executionState?.workspaces ?? []}
                        busy={busy}
                        executionBusy={executionBusyItemIds.has(row.item.id)}
                        executionLoading={executionLoading}
                        onKickoffExecution={onKickoffExecution}
                        onCancelExecution={onCancelExecution}
                      />
                    </li>
                  );
                })}
              </ul>
            ) : (
              <section className="rounded-2xl border bg-card p-5">
                <p className="text-sm leading-relaxed text-muted-foreground">
                  Your day is set. Enter Living Current to begin.
                </p>
              </section>
            )}

            {executionError && (
              <p role="alert" className="rounded-xl border border-accent-red/30 bg-accent-red/5 p-3 text-sm text-accent-red">
                {executionError}
              </p>
            )}
          </div>

          <footer className="sticky bottom-0 z-10 flex flex-wrap items-center gap-2 border-t bg-background/95 px-4 py-4 backdrop-blur sm:px-7">
            <button
              type="button"
              data-ritual-primary
              className="press-scale min-h-11 rounded-xl bg-foreground px-5 text-sm font-semibold text-background hover:opacity-90 sm:ml-auto"
              onClick={onEnterDay}
            >
              Enter my day
            </button>
          </footer>
        </div>
      </div>
  );
}

export type { DayStartedProps };
