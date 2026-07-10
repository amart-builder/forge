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
import { useId, useRef, type RefObject } from 'react';
import type {
  DayPlan,
  DayPlanItem,
  DayPlanOwner as DayOwner,
} from '@/lib/day-plan/types';
import {
  ownerDescription,
  ownerLabel,
  selectEssentialItems,
} from '@/lib/day-plan/presentation';
import DayRitualLayer from './DayRitualLayer';

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
  recap?: string;
  freshnessLabel?: string;
  expandedItemId?: string | null;
  announcement?: string;
  busy?: boolean;
  error?: string;
  inertTargetRef?: RefObject<HTMLElement | null>;
  onExpand: (itemId: string) => void;
  onOwnerChange: (itemId: string, owner: DayOwner) => void | Promise<void>;
  onDragReorder: (activeId: string, overId: string) => void | Promise<void>;
  onDismiss: (itemId: string, title: string) => void | Promise<void>;
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

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`min-w-0 ${isDragging ? 'relative z-10 opacity-80' : ''}`}
    >
      <article
        aria-labelledby={titleId}
        aria-describedby={`${contextId} ${metadataId}`}
        className="flex h-full flex-col rounded-2xl border bg-card p-4 shadow-sm sm:p-5"
      >
        <span id={contextId} className="sr-only">
          Priority {index + 1} of {total}. Owner {ownerLabel(view.item.owner)}.
        </span>
        <div className="flex items-start gap-3">
          <button
            type="button"
            className="flex min-h-11 min-w-11 shrink-0 cursor-grab items-center justify-center rounded-xl border text-muted-foreground hover:bg-muted focus:outline-none focus:ring-2 focus:ring-accent-blue/40 active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-50"
            aria-label={`Reorder ${view.title}. Priority ${index + 1} of ${total}. Owner ${ownerLabel(view.item.owner)}.`}
            disabled={busy}
            style={{ touchAction: 'none' }}
            {...attributes}
            {...listeners}
          >
            <span aria-hidden="true">↔</span>
          </button>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {view.project && <span className="rounded-full bg-muted px-2 py-1">{view.project}</span>}
            </div>
            <h2
              id={titleId}
              className={`${view.project ? 'mt-2' : ''} text-base font-semibold leading-snug text-foreground sm:text-lg`}
            >
              {view.title}
            </h2>
            {view.summary && (
              <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-muted-foreground">
                {view.summary}
              </p>
            )}
            <span id={metadataId} className="sr-only">{view.whyToday}</span>
          </div>
        </div>

        <div className="mt-auto flex flex-wrap items-center gap-2 border-t pt-3">
          <button
            ref={(node) => setDisclosureRef(view.item.id, node)}
            type="button"
            className="ml-auto min-h-11 rounded-xl px-3 text-sm font-medium text-foreground hover:bg-muted"
            aria-label={`${expanded ? 'Hide' : 'Show'} details for ${view.title}`}
            aria-expanded={expanded}
            aria-controls={`arrival-details-${view.item.id}`}
            onClick={() => onExpand(view.item.id)}
          >
            {expanded ? 'Hide details' : 'Show details'}
          </button>
        </div>

        {expanded && (
          <div
            id={`arrival-details-${view.item.id}`}
            className="mt-3 max-h-64 space-y-3 overflow-y-auto rounded-xl bg-muted/60 p-4 text-sm"
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
            <fieldset className="border-t pt-3">
              <legend className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Owner</legend>
              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
                {OWNERS.map((owner) => (
                  <label
                    key={owner}
                    className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border px-3 text-sm font-medium focus-within:ring-2 focus-within:ring-accent-blue/40 ${
                      view.item.owner === owner ? 'border-accent-blue bg-accent-blue/5 text-foreground' : 'text-muted-foreground'
                    }`}
                  >
                    <input
                      type="radio"
                      name={`owner-${view.item.id}`}
                      value={owner}
                      checked={view.item.owner === owner}
                      disabled={busy}
                      onChange={() => void onOwnerChange(view.item.id, owner)}
                      className="h-4 w-4 accent-[var(--accent-blue)]"
                    />
                    {ownerLabel(owner)}
                  </label>
                ))}
              </div>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground" role="status">
                {ownerDescription(view.item.owner)}
              </p>
            </fieldset>
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
        )}
      </article>
    </li>
  );
}

export default function MorningArrival({
  plan,
  items,
  recommendation,
  recap,
  freshnessLabel,
  expandedItemId,
  announcement,
  busy = false,
  error,
  inertTargetRef,
  onExpand,
  onOwnerChange,
  onDragReorder,
  onDismiss,
  onSnooze,
  onSkip,
  onBypass,
  onStartDay,
  onAddWhatChanged,
  onOpenAllWork,
}: MorningArrivalProps) {
  const titleId = useId();
  const descriptionId = useId();
  const draggingRef = useRef(false);
  const disclosureRefs = useRef(new Map<string, HTMLButtonElement>());
  const visibleItems = selectEssentialItems(items.map((view) => view.item), 3)
    .map((item) => items.find((view) => view.item.id === item.id))
    .filter((view): view is MorningArrivalItem => Boolean(view));
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

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
    if (draggingRef.current) return;
    if (expandedItemId) {
      onExpand(expandedItemId);
      focusDisclosure(expandedItemId);
      return;
    }
    void onBypass();
  }

  async function handleDismiss(itemId: string, title: string) {
    const nextItemId = visibleItems.find((view) => view.item.id !== itemId)?.item.id;
    if (expandedItemId === itemId) onExpand(itemId);
    await onDismiss(itemId, title);
    focusDisclosure(nextItemId);
  }

  return (
    <DayRitualLayer
      labelledBy={titleId}
      describedBy={descriptionId}
      announcement={announcement}
      inertTargetRef={inertTargetRef}
      width="wide"
      onEscape={handleEscape}
    >
      <div
        className="my-auto overflow-hidden rounded-3xl border bg-background shadow-2xl"
        data-day-plan-id={plan.id}
      >
        <div className="max-h-[calc(100dvh-7rem)] overflow-y-auto">
          <header className="sticky top-0 z-10 border-b bg-background/95 px-4 py-5 backdrop-blur sm:px-7">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Morning arrival</p>
            <h1 id={titleId} className="mt-2 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
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
                <p className="mt-1 text-sm leading-relaxed text-foreground">{recommendation}</p>
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

            {error && <p role="alert" className="rounded-xl border border-accent-red/30 bg-accent-red/5 p-3 text-sm text-accent-red">{error}</p>}
          </div>

          <footer className="sticky bottom-0 z-10 flex flex-wrap items-center gap-2 border-t bg-background/95 px-4 py-4 backdrop-blur sm:px-7">
            <button type="button" disabled={busy} className="min-h-11 rounded-xl px-3 text-sm text-muted-foreground hover:bg-muted disabled:opacity-50" onClick={() => void onSnooze()}>
              Snooze 15 minutes
            </button>
            <button type="button" disabled={busy} className="min-h-11 rounded-xl px-3 text-sm text-muted-foreground hover:bg-muted disabled:opacity-50" onClick={() => void onSkip()}>
              Skip Today
            </button>
            <button type="button" disabled={busy} className="min-h-11 rounded-xl px-3 text-sm text-muted-foreground hover:bg-muted disabled:opacity-50" onClick={() => void onBypass()}>
              Enter Living Current
            </button>
            <button
              type="button"
              data-ritual-primary
              disabled={busy || visibleItems.length === 0}
              className="min-h-11 rounded-xl bg-foreground px-5 text-sm font-semibold text-background hover:opacity-90 disabled:opacity-40 sm:ml-auto"
              onClick={() => void onStartDay()}
            >
              {busy ? 'Setting your day…' : 'Start My Day'}
            </button>
          </footer>
        </div>
      </div>
    </DayRitualLayer>
  );
}

export type { MorningArrivalProps };
