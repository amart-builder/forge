'use client';

import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type RefObject,
} from 'react';
import type { DayPlanExecutionState } from '@/lib/data/day-plan';
import { matchesArrivalAddition } from '@/lib/day-plan/arrival-addition';
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
  DayPlanMutationResult,
  DayPlanOwner as DayOwner,
} from '@/lib/day-plan/types';
import {
  assistantTurnStatusLabel,
  resolveArrivalEscape,
  selectEssentialItems,
} from '@/lib/day-plan/presentation';
import ArrivalStepBrief from './arrival/ArrivalStepBrief';
import ArrivalStepExtras from './arrival/ArrivalStepExtras';
import ArrivalStepPriorities from './arrival/ArrivalStepPriorities';
import type { OwnerChipEscapeHandler } from './arrival/OwnerChip';
import StepDots, { type ArrivalStep } from './arrival/StepDots';

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
  brief?: PublicMorningBrief;
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
  titleId: string;
  descriptionId: string;
  escapeRef?: RefObject<(() => void) | null>;
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
  onSalesAction?: (
    actionIndex: number,
    state: MorningBriefSalesActionState,
    editedText?: string,
  ) => void | Promise<void>;
  onAddSuggestion?: (
    addition: MorningBriefSuggestedAddition,
    owner: DayOwner,
  ) => Promise<DayPlanMutationResult>;
  onSnooze: () => void | Promise<void>;
  onSkip: () => void | Promise<void>;
  onBypass: () => void | Promise<void>;
  onStartDay: () => void | Promise<void>;
  onAddWhatChanged?: () => void;
  onOpenAllWork?: () => void;
}

const STEP_TITLES: Record<ArrivalStep, string> = {
  brief: 'Good morning.',
  priorities: 'Choose where your attention goes.',
  extras: 'Anything else?',
};

const STEP_DESCRIPTIONS: Record<ArrivalStep, string> = {
  brief: 'A quiet read on what changed, what matters, and what Forge is watching for you.',
  priorities: 'Drag three outcomes into priority order, then choose who owns each one.',
  extras: 'Review the optional details, make any final refinements, and begin your day.',
};

const STEP_ANNOUNCEMENTS: Record<ArrivalStep, string> = {
  brief: 'the brief',
  priorities: 'your priorities',
  extras: 'anything else',
};

function RefinePanel({
  headingId,
  open,
  setOpen,
  assistantPrompt,
  setAssistantPrompt,
  assistantPromptRef,
  assistantSubmitting,
  assistantTurn,
  assistantError,
  assistantActive,
  onInteract,
  onSubmit,
}: {
  headingId: string;
  open: boolean;
  setOpen: (open: boolean) => void;
  assistantPrompt: string;
  setAssistantPrompt: (value: string) => void;
  assistantPromptRef: RefObject<HTMLTextAreaElement | null>;
  assistantSubmitting: boolean;
  assistantTurn?: DayPlanAssistantTurn;
  assistantError?: string;
  assistantActive: boolean;
  onInteract?: () => void;
  onSubmit: (event: FormEvent) => void;
}) {
  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId} className="sr-only">Refine today with Claude</h2>
      <button
        type="button"
        className="press-scale min-h-9 text-sm font-medium text-muted-foreground hover:text-foreground hover:underline hover:underline-offset-4"
        aria-expanded={open}
        aria-controls={`${headingId}-form`}
        onClick={() => {
          onInteract?.();
          setOpen(!open);
          if (!open) window.requestAnimationFrame(() => assistantPromptRef.current?.focus());
        }}
      >
        Refine with Claude
      </button>

      {open && (
        <div
          id={`${headingId}-form`}
          className="mt-3 opacity-100 transition-opacity duration-150 ease-[var(--ease-out-forge)] motion-reduce:transition-none"
        >
          <p className="text-sm leading-relaxed text-muted-foreground">
            Tell Claude what’s missing, add context, or reprioritize today.
          </p>
          <form className="mt-3 flex flex-col gap-2 sm:flex-row" onSubmit={onSubmit}>
            <label className="sr-only" htmlFor={`${headingId}-prompt`}>
              Changes for today’s plan
            </label>
            <textarea
              ref={assistantPromptRef}
              id={`${headingId}-prompt`}
              value={assistantPrompt}
              maxLength={4000}
              rows={2}
              disabled={assistantSubmitting}
              className="max-h-40 min-h-11 min-w-0 flex-1 resize-none overflow-y-auto rounded-xl border bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-accent-blue/40 disabled:opacity-60"
              placeholder="Add context or change the order…"
              onChange={(event) => {
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
              className="press-scale min-h-11 min-w-20 rounded-xl border px-4 text-sm font-semibold text-foreground transition-[color,background-color,transform] duration-150 ease-[var(--ease-out-forge)] hover:bg-muted motion-reduce:transform-none motion-reduce:transition-none disabled:text-muted-foreground disabled:opacity-50"
            >
              {assistantSubmitting ? (
                <span aria-hidden="true" className="inline-block size-1.5 rounded-full bg-current opacity-50 motion-safe:animate-pulse" />
              ) : 'Send'}
            </button>
          </form>
        </div>
      )}

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
  onAddSuggestion,
  onSnooze,
  onSkip,
  onBypass,
  onStartDay,
  onAddWhatChanged,
  onOpenAllWork,
}: MorningArrivalProps) {
  const assistantHeadingId = useId();
  const [assistantPrompt, setAssistantPrompt] = useState('');
  const [refineOpen, setRefineOpen] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const assistantPromptRef = useRef<HTMLTextAreaElement>(null);
  const draggingRef = useRef(false);
  const disclosureRefs = useRef(new Map<string, HTMLButtonElement>());
  const ownerChipEscapeRef = useRef<OwnerChipEscapeHandler | null>(null);
  const hasExtras = useRef(
    Boolean(
      (brief?.salesActions.length && onSalesAction) || brief?.suggestedAdditions.length,
    ),
  ).current;
  const briefWriting =
    !brief && (briefGeneration?.state === 'queued' || briefGeneration?.state === 'running');
  const hasBrief = useRef(Boolean(recap || brief || briefWriting || recommendation)).current;
  const availableSteps: ArrivalStep[] = [
    ...(hasBrief ? ['brief' as const] : []),
    'priorities',
    ...(hasExtras ? ['extras' as const] : []),
  ];
  const [step, setStep] = useState<ArrivalStep>(() => hasBrief ? 'brief' : 'priorities');
  const [stepAnnouncement, setStepAnnouncement] = useState('');
  const previousStepRef = useRef(step);
  const visibleItems = selectEssentialItems(items.map((view) => view.item), 3)
    .map((item) => items.find((view) => view.item.id === item.id))
    .filter((view): view is MorningArrivalItem => Boolean(view));
  const addedSuggestionIndexes = new Set(
    brief?.suggestedAdditions.flatMap((addition, index) =>
      plan.items.some((item) => matchesArrivalAddition(item, addition)) ? [index] : [],
    ) ?? [],
  );
  const assistantActive = assistantTurn?.state === 'queued' || assistantTurn?.state === 'running';
  const anyExecutionBusy = executionBusyItemIds.size > 0;
  const currentStepIndex = Math.max(0, availableSteps.indexOf(step));
  const isFinalStep = currentStepIndex === availableSteps.length - 1;

  useEffect(() => {
    if (previousStepRef.current === step) return;
    previousStepRef.current = step;
    const focusFrame = window.requestAnimationFrame(() => {
      document.getElementById(titleId)?.focus();
      setStepAnnouncement(
        `Step ${currentStepIndex + 1} of ${availableSteps.length}: ${STEP_ANNOUNCEMENTS[step]}`,
      );
    });
    return () => window.cancelAnimationFrame(focusFrame);
  }, [availableSteps.length, currentStepIndex, step, titleId]);

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

  function setDisclosureRef(itemId: string, node: HTMLButtonElement | null) {
    if (node) disclosureRefs.current.set(itemId, node);
    else disclosureRefs.current.delete(itemId);
  }

  function focusDisclosure(itemId: string | undefined) {
    if (!itemId) return;
    window.requestAnimationFrame(() => disclosureRefs.current.get(itemId)?.focus());
  }

  function handleOwnerChipOpen(handler: OwnerChipEscapeHandler) {
    if (ownerChipEscapeRef.current?.itemId !== handler.itemId) {
      ownerChipEscapeRef.current?.closeAndFocus();
    }
    ownerChipEscapeRef.current = handler;
  }

  function handleOwnerChipClose(itemId: string) {
    if (ownerChipEscapeRef.current?.itemId === itemId) ownerChipEscapeRef.current = null;
  }

  function handleEscape() {
    const openOwnerChip = ownerChipEscapeRef.current;
    if (openOwnerChip) {
      openOwnerChip.closeAndFocus();
      return;
    }
    const decision = resolveArrivalEscape({
      dragging: draggingRef.current,
      expandedItemId,
    });
    if (decision.type === 'collapse') {
      onExpand(decision.itemId);
      focusDisclosure(decision.itemId);
    }
  }

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

  function changeStep(nextStep: ArrivalStep) {
    ownerChipEscapeRef.current?.closeAndFocus();
    onInteract?.();
    setStep(nextStep);
  }

  const refineContent = (
    <RefinePanel
      headingId={assistantHeadingId}
      open={refineOpen}
      setOpen={setRefineOpen}
      assistantPrompt={assistantPrompt}
      setAssistantPrompt={setAssistantPrompt}
      assistantPromptRef={assistantPromptRef}
      assistantSubmitting={assistantSubmitting}
      assistantTurn={assistantTurn}
      assistantError={assistantError}
      assistantActive={assistantActive}
      onInteract={onInteract}
      onSubmit={handleAssistantSubmit}
    />
  );

  return (
    <div
      className="my-auto overflow-hidden rounded-3xl border bg-background shadow-2xl"
      data-day-plan-id={plan.id}
    >
      <div className="max-h-[calc(100dvh-7rem)] overflow-y-auto">
        <header className="sticky top-0 z-20 border-b bg-background/95 px-6 py-5 backdrop-blur sm:px-10">
          <div className="flex items-center justify-between gap-4">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Morning arrival
            </p>
            <StepDots steps={availableSteps} activeStep={step} />
          </div>
          <h1
            id={titleId}
            tabIndex={-1}
            className="mt-3 text-2xl font-semibold tracking-tight text-foreground outline-none sm:text-3xl"
          >
            {STEP_TITLES[step]}
          </h1>
          <p id={descriptionId} className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            {STEP_DESCRIPTIONS[step]}
          </p>
          {freshnessLabel && <p className="mt-2 text-xs text-muted-foreground">{freshnessLabel}</p>}
          <p className="sr-only" aria-live="polite" aria-atomic="true">{stepAnnouncement}</p>
        </header>

        {(error || executionError) && (
          <div className="space-y-2 px-6 pt-5 sm:px-10">
            {error && (
              <p role="alert" className="rounded-xl border border-accent-red/30 bg-accent-red/5 p-3 text-sm text-accent-red">
                {error}
              </p>
            )}
            {executionError && (
              <p role="alert" className="rounded-xl border border-accent-red/30 bg-accent-red/5 p-3 text-sm text-accent-red">
                {executionError}
              </p>
            )}
          </div>
        )}

        <div key={step} className="day-ritual-swap-in pb-24 sm:pb-0">
          {step === 'brief' ? (
            <ArrivalStepBrief
              recap={recap}
              narrative={brief?.lensNarrative ?? recommendation}
              watchItems={brief?.watchItems ?? []}
              briefWriting={briefWriting}
            />
          ) : step === 'priorities' ? (
            <ArrivalStepPriorities
              visibleItems={visibleItems}
              expandedItemId={expandedItemId}
              busy={busy}
              executionState={executionState}
              executionLoading={executionLoading}
              executionBusyItemIds={executionBusyItemIds}
              draggingRef={draggingRef}
              onExpand={onExpand}
              onOwnerChange={onOwnerChange}
              onDragReorder={onDragReorder}
              onDismiss={handleDismiss}
              onKickoffExecution={onKickoffExecution}
              onCancelExecution={onCancelExecution}
              setDisclosureRef={setDisclosureRef}
              onOwnerChipOpen={handleOwnerChipOpen}
              onOwnerChipClose={handleOwnerChipClose}
              onAddWhatChanged={onAddWhatChanged}
              onOpenAllWork={onOpenAllWork}
              refineContent={refineContent}
            />
          ) : (
            <ArrivalStepExtras
              brief={brief}
              onSalesAction={onSalesAction}
              onAddSuggestion={onAddSuggestion}
              busy={busy}
              editingIndex={editingIndex}
              setEditingIndex={setEditingIndex}
              editDraft={editDraft}
              setEditDraft={setEditDraft}
              addedSuggestionIndexes={addedSuggestionIndexes}
              onOwnerChoiceOpen={handleOwnerChipOpen}
              onOwnerChoiceClose={handleOwnerChipClose}
              refineContent={refineContent}
            />
          )}
        </div>

        <footer className="sticky bottom-0 z-20 flex flex-col items-stretch gap-2 border-t bg-background/95 px-4 py-3 backdrop-blur sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-3 sm:px-10 sm:py-4">
          <div className="flex w-full flex-wrap items-center justify-center gap-x-3 sm:w-auto sm:justify-start sm:gap-x-4 sm:gap-y-1">
            {currentStepIndex > 0 && (
              <button
                type="button"
                className="press-scale min-h-8 whitespace-nowrap text-[11px] text-muted-foreground hover:underline hover:underline-offset-2 sm:min-h-9 sm:text-xs"
                onClick={() => changeStep(availableSteps[currentStepIndex - 1])}
              >
                Back
              </button>
            )}
            <button
              type="button"
              disabled={busy}
              className="press-scale min-h-8 whitespace-nowrap text-[11px] text-muted-foreground hover:underline hover:underline-offset-2 disabled:opacity-50 sm:min-h-9 sm:text-xs"
              onClick={() => void onSnooze()}
            >
              Snooze 15 minutes
            </button>
            <button
              type="button"
              disabled={busy}
              className="press-scale min-h-8 whitespace-nowrap text-[11px] text-muted-foreground hover:underline hover:underline-offset-2 disabled:opacity-50 sm:min-h-9 sm:text-xs"
              onClick={() => void onSkip()}
            >
              Skip today
            </button>
            <button
              type="button"
              disabled={busy}
              className="press-scale min-h-8 whitespace-nowrap text-[11px] text-muted-foreground hover:underline hover:underline-offset-2 disabled:opacity-50 sm:min-h-9 sm:text-xs"
              onClick={() => void onBypass()}
            >
              Enter Living Current
            </button>
          </div>

          <button
            type="button"
            data-ritual-primary={isFinalStep ? '' : undefined}
            disabled={isFinalStep && (
              busy ||
              assistantSubmitting ||
              assistantActive ||
              anyExecutionBusy ||
              visibleItems.length === 0
            )}
            className={`press-scale min-h-11 w-full rounded-xl px-5 text-sm font-semibold disabled:opacity-40 sm:ml-auto sm:w-auto ${
              isFinalStep
                ? 'bg-foreground text-background hover:opacity-90'
                : 'border text-foreground hover:bg-muted'
            }`}
            onClick={() => {
              if (isFinalStep) void onStartDay();
              else changeStep(availableSteps[currentStepIndex + 1]);
            }}
          >
            {isFinalStep ? (busy ? 'Setting your day…' : 'Start my day') : 'Continue'}
          </button>
        </footer>
      </div>
    </div>
  );
}

export type { MorningArrivalProps };
