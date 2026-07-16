'use client';

import { useId, useSyncExternalStore } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { DayPlanExecutionState } from '@/lib/data/day-plan';
import {
  executionRunStatusLabel,
  ownerLabel,
  selectCurrentExecutionRow,
} from '@/lib/day-plan/presentation';
import type { MorningArrivalItem, MorningArrivalProps } from '../MorningArrival';
import ExecutionConfigPanel from '../ExecutionConfigPanel';
import OwnerChip, { type OwnerChipEscapeHandler } from './OwnerChip';

const ACTIVE_RUN_STATUSES = ['queued', 'starting', 'running', 'cancelling'];
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

function subscribeToReducedMotion(onChange: () => void) {
  const mediaQuery = window.matchMedia(REDUCED_MOTION_QUERY);
  mediaQuery.addEventListener('change', onChange);
  return () => mediaQuery.removeEventListener('change', onChange);
}

function reducedMotionSnapshot() {
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

export type ArrivalCardProps = {
  view: MorningArrivalItem;
  index: number;
  total: number;
  expanded: boolean;
  busy: boolean;
  onExpand: MorningArrivalProps['onExpand'];
  onOwnerChange: MorningArrivalProps['onOwnerChange'];
  onDismiss: MorningArrivalProps['onDismiss'];
  executionItem?: DayPlanExecutionState['items'][number];
  executionRuns: DayPlanExecutionState['runs'];
  executionWorkspaces: DayPlanExecutionState['workspaces'];
  executionBusy: boolean;
  executionLoading: boolean;
  onKickoffExecution: MorningArrivalProps['onKickoffExecution'];
  onCancelExecution: MorningArrivalProps['onCancelExecution'];
  setDisclosureRef: (itemId: string, node: HTMLButtonElement | null) => void;
  onOwnerChipOpen: (handler: OwnerChipEscapeHandler) => void;
  onOwnerChipClose: (itemId: string) => void;
};

export default function ArrivalCard({
  view,
  index,
  total,
  expanded,
  busy,
  onExpand,
  onOwnerChange,
  onDismiss,
  executionItem,
  executionRuns,
  executionWorkspaces,
  executionBusy,
  executionLoading,
  onKickoffExecution,
  onCancelExecution,
  setDisclosureRef,
  onOwnerChipOpen,
  onOwnerChipClose,
}: ArrivalCardProps) {
  const titleId = useId();
  const contextId = useId();
  const metadataId = useId();
  const reducedMotion = useSyncExternalStore(
    subscribeToReducedMotion,
    reducedMotionSnapshot,
    () => false,
  );
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: view.item.id,
    disabled: busy || executionBusy,
  });
  const style = {
    transform: CSS.Translate.toString(transform),
    transition: reducedMotion ? 'none' : transition ?? undefined,
  };
  const { latestRun, currentRun } = selectCurrentExecutionRow(
    executionRuns,
    view.item.id,
    executionItem?.config,
  );
  const activeRun = latestRun && ACTIVE_RUN_STATUSES.includes(latestRun.status)
    ? latestRun
    : undefined;
  const controlBusy = busy || executionBusy;
  const displayedRun = activeRun ?? currentRun;

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`min-w-0 ${isDragging ? 'relative z-10 opacity-80' : ''}`}
    >
      <article
        aria-labelledby={titleId}
        aria-describedby={`${contextId} ${metadataId}`}
        className={`flex h-full flex-col rounded-2xl border bg-card p-5 shadow-sm transition-[box-shadow,border-color] duration-200 ease-[var(--ease-out-forge)] sm:p-6 ${
          controlBusy ? 'sm:cursor-default' : 'sm:cursor-grab sm:active:cursor-grabbing'
        } ${
          isDragging
            ? 'shadow-lg'
            : 'hover:shadow-md focus-within:border-accent-blue/30 focus-within:shadow-md'
        }`}
        style={{ touchAction: 'manipulation' }}
        onClick={(event) => {
          const target = event.target as HTMLElement;
          if (target.closest('button, input, label, a, select, textarea, [data-card-control]')) return;
          onExpand(view.item.id);
        }}
        {...listeners}
      >
        <span id={contextId} className="sr-only">
          Priority {index + 1} of {total}. Owner {ownerLabel(view.item.owner)}.
        </span>
        <button
          ref={setActivatorNodeRef}
          type="button"
          className="sr-only"
          aria-label={`Reorder ${view.title}. Priority ${index + 1} of ${total}. Owner ${ownerLabel(view.item.owner)}.`}
          disabled={controlBusy}
          {...attributes}
          {...listeners}
        >
          Reorder
        </button>

        <button
          ref={(node) => setDisclosureRef(view.item.id, node)}
          type="button"
          className="min-w-0 rounded-xl text-left outline-none focus-visible:ring-2 focus-visible:ring-accent-blue/40"
          aria-label={`${expanded ? 'Collapse' : 'Expand'} details for ${view.title}`}
          aria-expanded={expanded}
          aria-controls={`arrival-details-${view.item.id}`}
          onClick={() => onExpand(view.item.id)}
        >
          <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {view.project && <span className="rounded-full bg-muted px-2 py-1">{view.project}</span>}
          </span>
          <span
            id={titleId}
            role="heading"
            aria-level={2}
            className={`${view.project ? 'mt-2' : ''} block text-base font-semibold leading-snug text-foreground sm:text-lg`}
          >
            {view.title}
          </span>
          {view.summary && (
            <span className="mt-2 block line-clamp-2 text-sm leading-relaxed text-muted-foreground">
              {view.summary}
            </span>
          )}
          <span id={metadataId} className="sr-only">{view.whyToday}</span>
        </button>

        <div className="mt-auto pt-5">
          <OwnerChip
            itemId={view.item.id}
            owner={view.item.owner}
            disabled={controlBusy}
            onOwnerChange={(owner) => onOwnerChange(view.item.id, owner)}
            onOpen={onOwnerChipOpen}
            onClose={onOwnerChipClose}
          />
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground" role="status">
            {view.item.owner === 'me'
              ? 'You own this.'
              : displayedRun
                ? executionRunStatusLabel(displayedRun.status)
                : view.item.owner === 'together'
                  ? 'Plan with Claude selected automatically.'
                  : 'Autonomous selected automatically.'}
          </p>
        </div>

        {(view.item.owner === 'claude' || view.item.owner === 'together') && (
          <ExecutionConfigPanel
            item={view.item}
            ariaTitle={view.title}
            complexityText={`${view.title} ${view.description} ${view.definitionOfDone ?? ''}`}
            executionItem={executionItem}
            runs={executionRuns}
            workspaces={executionWorkspaces}
            busy={busy}
            executionBusy={executionBusy}
            executionLoading={executionLoading}
            quietPrimaryAction
            onKickoffExecution={onKickoffExecution}
            onCancelExecution={onCancelExecution}
          />
        )}

        {expanded && (
          <div
            id={`arrival-details-${view.item.id}`}
            className="mt-3 max-h-72 space-y-3 overflow-y-auto rounded-xl border-t bg-muted/60 p-4 text-sm"
          >
            {view.description && view.description.trim() !== view.title.trim() && (
              <div>
                <h3 className="font-semibold">Description</h3>
                <p className="mt-1 whitespace-pre-wrap leading-relaxed text-muted-foreground">
                  {view.description}
                </p>
              </div>
            )}
            <p><span className="font-semibold">Why today:</span> {view.whyToday}</p>
            {view.definitionOfDone ? (
              <p><span className="font-semibold">Done means:</span> {view.definitionOfDone}</p>
            ) : (
              <p className="text-muted-foreground">No definition of done has been added yet.</p>
            )}
            {view.deadline && (
              <p className="mt-2"><span className="font-semibold">Deadline:</span> {view.deadline}</p>
            )}
            <div className="border-t pt-2">
              <button
                type="button"
                className="press-scale min-h-11 rounded-xl px-3 text-sm text-muted-foreground hover:bg-background hover:text-foreground disabled:opacity-40"
                aria-label={`Remove ${view.title} from today’s essentials`}
                disabled={busy}
                onClick={() => void onDismiss(view.item.id, view.title)}
              >
                Not today
              </button>
            </div>
          </div>
        )}
      </article>
    </li>
  );
}
