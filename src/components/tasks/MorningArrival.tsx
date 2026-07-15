'use client';

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useEffect, useId, useRef, useState, type FormEvent, type RefObject } from 'react';
import type { DayPlanExecutionState } from '@/lib/data/day-plan';
import type {
  MorningBriefGeneration,
  MorningBriefSalesActionState,
  MorningBriefSuggestedAddition,
  PublicMorningBrief,
} from '@/lib/day-plan/brief';
import type {
  DayPlan,
  DayPlanAssistantTurn,
  DayPlanExecutionMode,
  DayPlanItem,
  DayPlanModelAlias,
  DayPlanOwner as DayOwner,
} from '@/lib/day-plan/types';
import {
  assistantTurnStatusLabel,
  executionRunStatusLabel,
  ownerLabel,
  resolveArrivalEscape,
  selectCurrentExecutionRow,
  selectEssentialItems,
} from '@/lib/day-plan/presentation';
import ExecutionConfigPanel from './ExecutionConfigPanel';

const ACTIVE_RUN_STATUSES = ['queued', 'starting', 'running', 'cancelling'];

const OWNERS: DayOwner[] = ['me', 'claude', 'together'];

export type MorningArrivalItem = {
  item: DayPlanItem;
  title: string;
  summary?: string;
  description?: string;
  whyToday: string;
  definitionOfDone?: string;
  project?: string;
  deadline?: string;
};

interface MorningArrivalProps {
  plan: DayPlan;
  items: MorningArrivalItem[];
  recommendation: string;
  // The Morning Brief this plan consumed at ensure, when one exists. Its lens
  // narrative replaces the deterministic recommendation line, and its Watch and
  // Sales sections render below the cards. Absent brief: deterministic morning.
  brief?: PublicMorningBrief;
  // In-flight generation state for today's date. When no brief is consumed yet
  // and one is queued/running, the arrival shows a quiet "being written" line.
  briefGeneration?: MorningBriefGeneration;
  recap?: string;
  freshnessLabel?: string;
  expandedItemId?: string | null;
  busy?: boolean;
  error?: string;
  assistantTurn?: DayPlanAssistantTurn;
  assistantSubmitting?: boolean;
  assistantError?: string;
  executionState?: DayPlanExecutionState;
  executionLoading?: boolean;
  executionBusyItemIds?: ReadonlySet<string>;
  executionError?: string;
  // The hoisted DayRitualLayer owns the dialog chrome; these ids label it and the
  // escape ref lets the layer route Escape to this view's collapse behavior.
  titleId: string;
  descriptionId: string;
  escapeRef?: RefObject<(() => void) | null>;
  // Fired on the first low-level interaction that no mutation covers (expanding a
  // card, typing in the refine box) so the arrival freezes against a late brief.
  onInteract?: () => void;
  onExpand: (itemId: string) => void;
  onOwnerChange: (itemId: string, owner: DayOwner) => void | Promise<void>;
  onDragReorder: (activeId: string, overId: string) => void | Promise<void>;
  onDismiss: (itemId: string, title: string) => void | Promise<void>;
  onAssistantSubmit: (userText: string) => void | Promise<unknown>;
  onKickoffExecution: (
    itemId: string,
    mode: DayPlanExecutionMode,
    modelAlias: DayPlanModelAlias,
    workspaceId?: string,
    budgetUsd?: number,
  ) => void | Promise<unknown>;
  onCancelExecution: (runId: string) => void | Promise<unknown>;
  // Marks a sales action approved, edited, or skipped. State only; never sends.
  onSalesAction?: (
    actionIndex: number,
    state: MorningBriefSalesActionState,
    editedText?: string,
  ) => void | Promise<void>;
  onSnooze: () => void | Promise<void>;
  onSkip: () => void | Promise<void>;
  onBypass: () => void | Promise<void>;
  onStartDay: () => void | Promise<void>;
  onAddWhatChanged?: () => void;
  onOpenAllWork?: () => void;
}

type SortableArrivalCardProps = {
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
};

function SortableArrivalCard({
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
}: SortableArrivalCardProps) {
  const titleId = useId();
  const contextId = useId();
  const metadataId = useId();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: view.item.id,
  });
  const style = {
    transform: CSS.Translate.toString(transform),
    transition: transition ?? undefined,
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
        className={`flex h-full cursor-pointer flex-col rounded-2xl border bg-card p-4 shadow-sm transition-[transform,box-shadow,border-color] duration-200 ease-out motion-reduce:transform-none motion-reduce:transition-none sm:p-5 ${
          isDragging
            ? 'shadow-lg'
            : 'hover:-translate-y-1 hover:scale-[1.01] hover:shadow-lg focus-within:-translate-y-1 focus-within:scale-[1.01] focus-within:border-accent-blue/30 focus-within:shadow-lg'
        }`}
        onClick={(event) => {
          const target = event.target as HTMLElement;
          if (target.closest('button, input, label, a, select, textarea, [data-card-control]')) return;
          onExpand(view.item.id);
        }}
      >
        <span id={contextId} className="sr-only">
          Priority {index + 1} of {total}. Owner {ownerLabel(view.item.owner)}.
        </span>
        <div className="flex items-start gap-3">
          <button
            type="button"
            className={`press-scale ${isDragging ? 'press-scale-suppress' : ''} flex min-h-11 min-w-11 shrink-0 cursor-grab items-center justify-center rounded-xl border text-muted-foreground hover:bg-muted focus:outline-none focus:ring-2 focus:ring-accent-blue/40 active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-50`}
            aria-label={`Reorder ${view.title}. Priority ${index + 1} of ${total}. Owner ${ownerLabel(view.item.owner)}.`}
            disabled={controlBusy}
            style={{ touchAction: 'none' }}
            {...attributes}
            {...listeners}
          >
            <span aria-hidden="true">↔</span>
          </button>

          <button
            ref={(node) => setDisclosureRef(view.item.id, node)}
            type="button"
            className="min-w-0 flex-1 rounded-xl text-left outline-none focus-visible:ring-2 focus-visible:ring-accent-blue/40"
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
        </div>

        <fieldset className="mt-auto pt-4">
          <legend className="sr-only">Owner</legend>
          <div className="grid grid-cols-3 gap-1.5">
            {OWNERS.map((owner) => (
              <label
                key={owner}
                className={`press-scale flex min-h-11 cursor-pointer items-center justify-center gap-1.5 rounded-xl border px-2 text-xs font-medium focus-within:ring-2 focus-within:ring-accent-blue/40 ${
                  view.item.owner === owner ? 'border-accent-blue bg-accent-blue/5 text-foreground' : 'text-muted-foreground'
                }`}
              >
                <input
                  type="radio"
                  name={`owner-${view.item.id}`}
                  value={owner}
                  checked={view.item.owner === owner}
                  disabled={controlBusy}
                onChange={() => void onOwnerChange(view.item.id, owner)}
                  className="h-4 w-4 accent-[var(--accent-blue)]"
                />
                {ownerLabel(owner)}
              </label>
            ))}
          </div>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground" role="status">
            {view.item.owner === 'me'
              ? 'You own this.'
              : displayedRun
                ? executionRunStatusLabel(displayedRun.status)
                : view.item.owner === 'together'
                  ? 'Plan with Claude selected automatically.'
                  : 'Autonomous selected automatically.'}
          </p>
        </fieldset>

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
            {view.deadline && <p className="mt-2"><span className="font-semibold">Deadline:</span> {view.deadline}</p>}
            <div className="border-t pt-2">
              <button
                type="button"
                className="min-h-11 rounded-xl px-3 text-sm text-muted-foreground hover:bg-background hover:text-foreground disabled:opacity-40"
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

export default function MorningArrival({
  plan,
  items,
  recommendation,
  brief,
  briefGeneration,
  recap,
  freshnessLabel,
  expandedItemId,
  busy = false,
  error,
  assistantTurn,
  assistantSubmitting = false,
  assistantError,
  executionState,
  executionLoading = false,
  executionBusyItemIds = new Set<string>(),
  executionError,
  titleId,
  descriptionId,
  escapeRef,
  onInteract,
  onExpand,
  onOwnerChange,
  onDragReorder,
  onDismiss,
  onAssistantSubmit,
  onKickoffExecution,
  onCancelExecution,
  onSalesAction,
  onSnooze,
  onSkip,
  onBypass,
  onStartDay,
  onAddWhatChanged,
  onOpenAllWork,
}: MorningArrivalProps) {
  const assistantHeadingId = useId();
  const [assistantPrompt, setAssistantPrompt] = useState('');
  const assistantPromptRef = useRef<HTMLTextAreaElement>(null);
  const draggingRef = useRef(false);
  const disclosureRefs = useRef(new Map<string, HTMLButtonElement>());
  const visibleItems = selectEssentialItems(items.map((view) => view.item), 3)
    .map((item) => items.find((view) => view.item.id === item.id))
    .filter((view): view is MorningArrivalItem => Boolean(view));
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const assistantActive = assistantTurn?.state === 'queued' || assistantTurn?.state === 'running';
  const anyExecutionBusy = executionBusyItemIds.size > 0;
  // A brief is still being written for a plan that consumed none yet. A failed or
  // idle generation stays silent (fail-open); a consumed brief hides this line.
  const briefWriting =
    !brief &&
    (briefGeneration?.state === 'queued' || briefGeneration?.state === 'running');

  // Suggested additions are an approval inbox: Review pre-fills the bounded
  // plan assistant, so an accepted addition flows through the existing
  // mutation ledger with Alex's explicit send. Nothing is created directly.
  function prefillSuggestedAddition(addition: MorningBriefSuggestedAddition) {
    setAssistantPrompt(
      `Add "${addition.title}" to today's plan. Outcome: ${addition.outcome} Owner: ${addition.suggestedOwner}.`,
    );
    assistantPromptRef.current?.focus();
  }

  async function handleAssistantSubmit(event: FormEvent) {
    event.preventDefault();
    const userText = assistantPrompt.trim();
    if (!userText || assistantSubmitting) return;
    try {
      await onAssistantSubmit(userText);
      setAssistantPrompt('');
      window.requestAnimationFrame(() => {
        if (assistantPromptRef.current) assistantPromptRef.current.style.height = 'auto';
      });
    } catch {
      // Keep the typed prompt so the user can retry or revise it.
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    draggingRef.current = false;
    if (!event.over || event.active.id === event.over.id) return;
    void onDragReorder(String(event.active.id), String(event.over.id));
  }

  function setDisclosureRef(itemId: string, node: HTMLButtonElement | null) {
    if (node) disclosureRefs.current.set(itemId, node);
    else disclosureRefs.current.delete(itemId);
  }

  function focusDisclosure(itemId: string | undefined) {
    if (!itemId) return;
    window.requestAnimationFrame(() => disclosureRefs.current.get(itemId)?.focus());
  }

  function handleEscape() {
    // Escape only collapses an expanded card. It never bypasses or closes the ritual.
    const decision = resolveArrivalEscape({
      dragging: draggingRef.current,
      expandedItemId,
    });
    if (decision.type === 'collapse') {
      onExpand(decision.itemId);
      focusDisclosure(decision.itemId);
    }
  }

  // The hoisted DayRitualLayer routes Escape through this ref while arrival is the
  // active ritual view.
  useEffect(() => {
    if (!escapeRef) return;
    escapeRef.current = handleEscape;
    return () => {
      escapeRef.current = null;
    };
  });

  async function handleDismiss(itemId: string, title: string) {
    const nextItemId = visibleItems.find((view) => view.item.id !== itemId)?.item.id;
    if (expandedItemId === itemId) onExpand(itemId);
    await onDismiss(itemId, title);
    focusDisclosure(nextItemId);
  }

  return (
      <div
        className="my-auto overflow-hidden rounded-3xl border bg-background shadow-2xl"
        data-day-plan-id={plan.id}
      >
        <div className="max-h-[calc(100dvh-7rem)] overflow-y-auto">
          <header className="sticky top-0 z-10 border-b bg-background/95 px-4 py-5 backdrop-blur sm:px-7">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Morning arrival</p>
            <h1 id={titleId} tabIndex={-1} className="mt-2 text-2xl font-semibold tracking-tight text-foreground outline-none sm:text-3xl">
              Choose where your attention goes.
            </h1>
            <p id={descriptionId} className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
              Compare three outcomes, drag them into priority order, and choose one clear place to begin.
            </p>
            {freshnessLabel && <p className="mt-2 text-xs text-muted-foreground">{freshnessLabel}</p>}
          </header>

          <div className="space-y-4 px-4 py-4 sm:px-7">
            <div className={`grid gap-3 ${recap ? 'md:grid-cols-2' : ''}`}>
              {recap && (
                <section aria-labelledby={`${titleId}-recap`} className="rounded-2xl border bg-card p-4">
                  <h2 id={`${titleId}-recap`} className="text-sm font-semibold">Since the last close</h2>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{recap}</p>
                </section>
              )}

              <section
                aria-labelledby={`${titleId}-recommendation`}
                className="rounded-2xl border bg-card p-4"
              >
                <h2 id={`${titleId}-recommendation`} className="text-sm font-semibold">Recommendation</h2>
                <p className="mt-1 text-sm leading-relaxed text-foreground">
                  {brief?.lensNarrative ?? recommendation}
                </p>
                {/* Quiet in-progress line, height-animated so it opens and resolves
                    without a layout jump. Reduced motion collapses instantly and
                    the pulse falls back to a static indicator. */}
                <div
                  className={`grid transition-[grid-template-rows] duration-300 ease-[var(--ease-out-forge)] motion-reduce:transition-none ${
                    briefWriting ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
                  }`}
                >
                  <div className="overflow-hidden">
                    <p
                      className="mt-2 flex items-center gap-2 text-sm text-muted-foreground"
                      aria-live="polite"
                    >
                      {briefWriting && (
                        <>
                          <span className="inline-flex items-center gap-1" aria-hidden="true">
                            {[0, 1, 2].map((dot) => (
                              <span
                                key={dot}
                                className="size-1.5 rounded-full bg-current opacity-35 motion-safe:animate-pulse"
                                style={{ animationDelay: `${dot * 180}ms` }}
                              />
                            ))}
                          </span>
                          Your brief is being written…
                        </>
                      )}
                    </p>
                  </div>
                </div>
              </section>
            </div>

            {visibleItems.length > 0 ? (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragStart={() => {
                  draggingRef.current = true;
                }}
                onDragCancel={() => {
                  draggingRef.current = false;
                }}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={visibleItems.map((view) => view.item.id)}
                  strategy={rectSortingStrategy}
                >
                  <ol
                    className="grid gap-3 lg:grid-cols-3"
                    aria-label="Essential outcomes in priority order"
                  >
                    {visibleItems.map((view, index) => (
                      <SortableArrivalCard
                        key={view.item.id}
                        view={view}
                        index={index}
                        total={visibleItems.length}
                        expanded={expandedItemId === view.item.id}
                        busy={busy}
                        onExpand={onExpand}
                        onOwnerChange={onOwnerChange}
                        onDismiss={handleDismiss}
                        executionItem={executionState?.items.find(
                          (item) => item.itemId === view.item.id,
                        )}
                        executionRuns={executionState?.runs ?? []}
                        executionWorkspaces={executionState?.workspaces ?? []}
                        executionBusy={executionBusyItemIds.has(view.item.id)}
                        executionLoading={executionLoading}
                        onKickoffExecution={onKickoffExecution}
                        onCancelExecution={onCancelExecution}
                        setDisclosureRef={setDisclosureRef}
                      />
                    ))}
                  </ol>
                </SortableContext>
              </DndContext>
            ) : (
              <section className="rounded-2xl border bg-card p-5" aria-labelledby={`${titleId}-empty`}>
                <h2 id={`${titleId}-empty`} className="text-base font-semibold">No credible priorities are ready.</h2>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  Forge will not invent work to fill the screen. Add what changed, review All Work, or enter Living Current.
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {onAddWhatChanged && <button type="button" className="min-h-11 rounded-xl border px-4 text-sm" onClick={onAddWhatChanged}>Add what changed</button>}
                  {onOpenAllWork && <button type="button" className="min-h-11 rounded-xl border px-4 text-sm" onClick={onOpenAllWork}>Open All Work</button>}
                </div>
              </section>
            )}

            {brief && brief.watchItems.length > 0 && (
              <section aria-labelledby={`${titleId}-watch`} className="rounded-2xl border bg-card p-4">
                <h2 id={`${titleId}-watch`} className="text-sm font-semibold text-foreground">
                  Watching for you
                </h2>
                <ul className="mt-2 space-y-2">
                  {brief.watchItems.map((watch, index) => (
                    <li key={index} className="text-sm leading-relaxed">
                      <span className="font-medium text-foreground">{watch.label}.</span>{' '}
                      <span className="text-muted-foreground">
                        {watch.evidence} Last seen: {watch.lastSeenState}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {brief && brief.salesActions.length > 0 && onSalesAction && (
              <SalesCadenceSection
                titleId={titleId}
                brief={brief}
                onSalesAction={onSalesAction}
              />
            )}

            {brief && brief.suggestedAdditions.length > 0 && (
              <section aria-labelledby={`${titleId}-additions`} className="rounded-2xl border bg-card p-4">
                <h2 id={`${titleId}-additions`} className="text-sm font-semibold text-foreground">
                  Claude suggests adding
                </h2>
                <ul className="mt-2 space-y-2">
                  {brief.suggestedAdditions.map((addition, index) => (
                    <li key={index} className="flex flex-wrap items-start justify-between gap-2 text-sm">
                      <span className="min-w-0 flex-1 leading-relaxed">
                        <span className="font-medium text-foreground">{addition.title}.</span>{' '}
                        <span className="text-muted-foreground">{addition.why}</span>
                      </span>
                      <button
                        type="button"
                        className="press-scale min-h-9 shrink-0 rounded-lg border px-3 text-xs font-medium hover:bg-muted"
                        onClick={() => prefillSuggestedAddition(addition)}
                      >
                        Review with Claude
                      </button>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-muted-foreground">
                  Nothing is added automatically. Review sends it through the plan assistant below for your approval.
                </p>
              </section>
            )}

            <section
              className="rounded-2xl border bg-card p-4"
              aria-labelledby={assistantHeadingId}
            >
              <h2 id={assistantHeadingId} className="text-sm font-semibold text-foreground">
                Refine today with Claude
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Tell Claude what’s missing, add context, or reprioritize today.
              </p>
              <form className="mt-3 flex flex-col gap-2 sm:flex-row" onSubmit={handleAssistantSubmit}>
                <label className="sr-only" htmlFor={`${assistantHeadingId}-prompt`}>
                  Changes for today’s plan
                </label>
                <textarea
                  ref={assistantPromptRef}
                  id={`${assistantHeadingId}-prompt`}
                  value={assistantPrompt}
                  maxLength={4000}
                  rows={2}
                  disabled={assistantSubmitting}
                  className="max-h-40 min-h-11 min-w-0 flex-1 resize-none overflow-y-auto rounded-xl border bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-accent-blue/40 disabled:opacity-60"
                  placeholder="Add context or change the order…"
                  onChange={(event) => {
                    // First keystroke in the refine box is a real interaction.
                    if (!assistantPrompt) onInteract?.();
                    setAssistantPrompt(event.target.value);
                    event.currentTarget.style.height = 'auto';
                    event.currentTarget.style.height = `${Math.min(event.currentTarget.scrollHeight, 160)}px`;
                  }}
                />
                <button
                  type="submit"
                  disabled={!assistantPrompt.trim() || assistantSubmitting}
                  aria-label={assistantSubmitting ? 'Sending to Claude' : 'Send'}
                  className="min-h-11 min-w-20 rounded-xl bg-foreground px-4 text-sm font-semibold text-background transition-[color,background-color,transform] duration-150 ease-[var(--ease-out-forge)] active:scale-[0.97] motion-reduce:transform-none motion-reduce:transition-none disabled:bg-muted-foreground/25 disabled:text-foreground/50 disabled:opacity-100"
                >
                  {assistantSubmitting
                    ? <span aria-hidden="true" className="inline-block size-1.5 rounded-full bg-current opacity-50 motion-safe:animate-pulse" />
                    : 'Send'}
                </button>
              </form>
              {(assistantTurn || assistantError) && (
                <div
                  className="mt-3 max-h-32 overflow-y-auto rounded-xl bg-muted/60 p-3 text-sm"
                  role={assistantError || assistantTurn?.state === 'failed' ? 'alert' : 'status'}
                  aria-live="polite"
                  aria-atomic="true"
                >
                  {assistantTurn && (
                    <p className="flex items-center gap-2 font-medium text-foreground">
                      {assistantActive && (
                        <span className="inline-flex items-center gap-1" aria-hidden="true">
                          {[0, 1, 2].map((dot) => (
                            <span
                              key={dot}
                              className="size-1.5 rounded-full bg-current opacity-35 motion-safe:animate-pulse"
                              style={{ animationDelay: `${dot * 180}ms` }}
                            />
                          ))}
                        </span>
                      )}
                      {assistantActive ? 'Claude is working' : assistantTurnStatusLabel(assistantTurn)}
                    </p>
                  )}
                  {assistantTurn?.proposal?.assistantText && (
                    <p className="mt-1 whitespace-pre-wrap leading-relaxed text-muted-foreground">
                      {assistantTurn.proposal.assistantText}
                    </p>
                  )}
                  {assistantError && <p className="mt-1 text-accent-red">{assistantError}</p>}
                </div>
              )}
            </section>

            {error && <p role="alert" className="rounded-xl border border-accent-red/30 bg-accent-red/5 p-3 text-sm text-accent-red">{error}</p>}
            {executionError && <p role="alert" className="rounded-xl border border-accent-red/30 bg-accent-red/5 p-3 text-sm text-accent-red">{executionError}</p>}
          </div>

          <footer className="sticky bottom-0 z-10 flex flex-wrap items-center gap-2 border-t bg-background/95 px-4 py-4 backdrop-blur sm:px-7">
            <button type="button" disabled={busy} className="press-scale min-h-11 rounded-xl px-3 text-sm text-muted-foreground hover:bg-muted disabled:opacity-50" onClick={() => void onSnooze()}>
              Snooze 15 minutes
            </button>
            <button type="button" disabled={busy} className="press-scale min-h-11 rounded-xl px-3 text-sm text-muted-foreground hover:bg-muted disabled:opacity-50" onClick={() => void onSkip()}>
              Skip Today
            </button>
            <button type="button" disabled={busy} className="press-scale min-h-11 rounded-xl px-3 text-sm text-muted-foreground hover:bg-muted disabled:opacity-50" onClick={() => void onBypass()}>
              Enter Living Current
            </button>
            <button
              type="button"
              data-ritual-primary
              disabled={
                busy ||
                assistantSubmitting ||
                assistantActive ||
                anyExecutionBusy ||
                visibleItems.length === 0
              }
              className="press-scale min-h-11 rounded-xl bg-foreground px-5 text-sm font-semibold text-background hover:opacity-90 disabled:opacity-40 sm:ml-auto"
              onClick={() => void onStartDay()}
            >
              {busy ? 'Setting your day…' : 'Start My Day'}
            </button>
          </footer>
        </div>
      </div>
  );
}

const DRAFT_KIND_LABELS: Record<string, string> = {
  full: 'Draft ready',
  beats_only: 'Beats only',
  pointer: 'Pointer',
  blocked: 'Blocked',
};

// The day's sales cadence: each row shows the draft (or beats) with Approve,
// Edit, and Skip. These only mark state so Alex can send in his own hands;
// Forge never sends anything.
function SalesCadenceSection({
  titleId,
  brief,
  onSalesAction,
}: {
  titleId: string;
  brief: PublicMorningBrief;
  onSalesAction: NonNullable<MorningArrivalProps['onSalesAction']>;
}) {
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState('');

  return (
    <section aria-labelledby={`${titleId}-sales`} className="rounded-2xl border bg-card p-4">
      <h2 id={`${titleId}-sales`} className="text-sm font-semibold text-foreground">
        Today&apos;s sales cadence
      </h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Approve marks a message ready for you to send. Forge never sends anything itself.
      </p>
      <ul className="mt-3 space-y-3">
        {brief.salesActions.map((action, index) => {
          const editing = editingIndex === index;
          return (
            <li key={index} className="rounded-xl border bg-background p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-foreground">{action.contact}</span>
                <span className="text-xs text-muted-foreground">{action.channel}</span>
                <span className="rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground">
                  {DRAFT_KIND_LABELS[action.draftKind] ?? action.draftKind}
                </span>
                {action.state && (
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium capitalize text-foreground">
                    {action.state}
                  </span>
                )}
              </div>
              {editing ? (
                <textarea
                  value={editDraft}
                  rows={3}
                  maxLength={2400}
                  aria-label={`Edit the message for ${action.contact}`}
                  className="mt-2 w-full resize-y rounded-lg border bg-background p-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-accent-blue/40"
                  onChange={(event) => setEditDraft(event.target.value)}
                />
              ) : (
                <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
                  {action.editedText ?? action.draftOrBeats}
                </p>
              )}
              <div className="mt-2 flex flex-wrap gap-2">
                {editing ? (
                  <>
                    <button
                      type="button"
                      disabled={!editDraft.trim()}
                      className="press-scale min-h-9 rounded-lg bg-foreground px-3 text-xs font-semibold text-background disabled:opacity-40"
                      onClick={() => {
                        void onSalesAction(index, 'edited', editDraft.trim());
                        setEditingIndex(null);
                      }}
                    >
                      Save edit
                    </button>
                    <button
                      type="button"
                      className="press-scale min-h-9 rounded-lg border px-3 text-xs font-medium hover:bg-muted"
                      onClick={() => setEditingIndex(null)}
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      className="press-scale min-h-9 rounded-lg bg-foreground px-3 text-xs font-semibold text-background hover:opacity-90"
                      onClick={() =>
                        // Pass the existing edit through so approving an edited
                        // draft keeps the edited text instead of discarding it.
                        void onSalesAction(index, 'approved', action.editedText)
                      }
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      className="press-scale min-h-9 rounded-lg border px-3 text-xs font-medium hover:bg-muted"
                      onClick={() => {
                        setEditingIndex(index);
                        setEditDraft(action.editedText ?? action.draftOrBeats);
                      }}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="press-scale min-h-9 rounded-lg border px-3 text-xs font-medium hover:bg-muted"
                      onClick={() => void onSalesAction(index, 'skipped', action.editedText)}
                    >
                      Skip
                    </button>
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export type { MorningArrivalProps };
