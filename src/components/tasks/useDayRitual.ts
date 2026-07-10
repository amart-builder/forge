'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  acknowledgeDayPlanReconciliation,
  DayPlanApiConflict,
  ensureDayPlan,
  getDayPlanState,
  mutateDayPlan,
  newDayPlanMutationId,
  onceOnlyDayPlanMutationId,
} from '@/lib/data/day-plan';
import type {
  DayPlan,
  DayPlanMutationAction,
  DayPlanMutationInput,
  DayPlanMutationResult,
  DayPlanOwner,
  DayPlanReconciliation,
  DaySnapshot,
  RecommendationCandidate,
  SettlementDisposition,
} from '@/lib/day-plan/types';

export type DayRitualView = 'checking' | 'none' | 'arrival' | 'transition' | 'settlement';

type UseDayRitualInput = {
  enabled: boolean;
  candidates: RecommendationCandidate[];
  candidatesReady: boolean;
};

function localDateInTimezone(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function inferView(plan?: DayPlan): DayRitualView {
  if (!plan) return 'none';
  if (plan.state === 'settling' && plan.settlementState === 'in_progress') {
    return 'settlement';
  }
  if (plan.state === 'proposed' && plan.arrivalState === 'opened') {
    return 'arrival';
  }
  return 'none';
}

function snoozeHasElapsed(plan: DayPlan, now = new Date()): boolean {
  if (plan.arrivalState !== 'snoozed' || !plan.snoozedUntil) return false;
  const wakeAt = new Date(plan.snoozedUntil).getTime();
  return Number.isFinite(wakeAt) && wakeAt <= now.getTime();
}

function stableMutationId(action: string, plan: DayPlan): string {
  return `${action}:${plan.id}:${plan.version}`;
}

export default function useDayRitual({
  enabled,
  candidates,
  candidatesReady,
}: UseDayRitualInput) {
  const [plan, setPlan] = useState<DayPlan>();
  const [latestSnapshot, setLatestSnapshot] = useState<DaySnapshot>();
  const [pendingReconciliations, setPendingReconciliations] = useState<DayPlanReconciliation[]>([]);
  const [view, setView] = useState<DayRitualView>(enabled ? 'checking' : 'none');
  const [busy, setBusy] = useState(false);
  const [savingItemIds, setSavingItemIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string>();
  const [announcement, setAnnouncement] = useState('');
  const [transitionMessage, setTransitionMessage] = useState('');
  const planRef = useRef<DayPlan | undefined>(undefined);
  const candidatesRef = useRef(candidates);
  const reconciliationBlockedRef = useRef(false);
  const mutationQueueRef = useRef<Promise<unknown>>(Promise.resolve());

  candidatesRef.current = candidates;

  const acceptPlan = useCallback((nextPlan: DayPlan, snapshot?: DaySnapshot) => {
    planRef.current = nextPlan;
    setPlan(nextPlan);
    if (snapshot) setLatestSnapshot(snapshot);
    setView(inferView(nextPlan));
  }, []);

  useEffect(() => {
    if (!enabled) {
      setView('none');
      return;
    }

    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    const localDate = localDateInTimezone(new Date(), timezone);
    let cancelled = false;

    async function initialize() {
      setView('checking');
      setError(undefined);
      try {
        const readModel = await getDayPlanState();
        if (cancelled) return;
        setLatestSnapshot(readModel.latestSnapshot);
        setPendingReconciliations(readModel.pendingReconciliations);

        let nextPlan = readModel.currentPlan;
        if (!nextPlan) {
          if (readModel.pendingReconciliations.length > 0) {
            reconciliationBlockedRef.current = true;
            planRef.current = undefined;
            setPlan(undefined);
            setView('none');
            setError('Forge is finishing the previous day before it prepares today.');
            return;
          }
          if (reconciliationBlockedRef.current) {
            setView('none');
            return;
          }
          if (!candidatesReady) {
            setView('none');
            setError('Forge needs a fresh task refresh before it can propose today’s plan.');
            return;
          }
          const ensured = await ensureDayPlan({
            localDate,
            timezone,
            mutationId: onceOnlyDayPlanMutationId('ensure', localDate),
            candidates: candidatesRef.current,
          });
          nextPlan = ensured.plan;
          if (ensured.snapshot) setLatestSnapshot(ensured.snapshot);
        }

        if (cancelled) return;

        if (nextPlan.localDate !== localDate) {
          let stalePlan = nextPlan;
          for (let attempt = 0; attempt < 3; attempt += 1) {
            try {
              if (
                stalePlan.state === 'settling' &&
                stalePlan.settlementState === 'in_progress'
              ) {
                break;
              }
              if (stalePlan.state === 'proposed') {
                if (stalePlan.arrivalState === 'failed') {
                  stalePlan = (await mutateDayPlan({
                    planId: stalePlan.id,
                    mutationId: stableMutationId('stale-arrival-reopen', stalePlan),
                    expectedVersion: stalePlan.version,
                    action: 'arrival_reopen',
                  })).plan;
                }
                if (!['skipped', 'bypassed'].includes(stalePlan.arrivalState)) {
                  stalePlan = (await mutateDayPlan({
                    planId: stalePlan.id,
                    mutationId: stableMutationId('stale-arrival-bypass', stalePlan),
                    expectedVersion: stalePlan.version,
                    action: 'arrival_bypass',
                  })).plan;
                }
              }
              stalePlan = (await mutateDayPlan({
                planId: stalePlan.id,
                mutationId: stableMutationId('stale-settlement-start', stalePlan),
                expectedVersion: stalePlan.version,
                action: 'settlement_start',
              })).plan;
              break;
            } catch (nextError) {
              if (nextError instanceof DayPlanApiConflict) {
                stalePlan = nextError.currentPlan;
                continue;
              }
              throw nextError;
            }
          }
          if (
            stalePlan.state !== 'settling' ||
            stalePlan.settlementState !== 'in_progress'
          ) {
            throw new Error('Forge could not prepare the previous workday for Settlement.');
          }
          if (cancelled) return;
          setAnnouncement('Close the previous workday before planning today.');
          acceptPlan(stalePlan, readModel.latestSnapshot);
          return;
        }

        planRef.current = nextPlan;
        setPlan(nextPlan);

        if (
          nextPlan.state === 'proposed' &&
          (nextPlan.arrivalState === 'due' ||
            nextPlan.arrivalState === 'not_due' ||
            nextPlan.arrivalState === 'failed' ||
            snoozeHasElapsed(nextPlan))
        ) {
          const opened = await mutateDayPlan({
            planId: nextPlan.id,
            mutationId: stableMutationId('arrival-open', nextPlan),
            expectedVersion: nextPlan.version,
            action: 'arrival_open',
          });
          if (!cancelled) acceptPlan(opened.plan, opened.snapshot);
          return;
        }

        acceptPlan(nextPlan, readModel.latestSnapshot);
      } catch (nextError) {
        if (cancelled) return;
        setView('none');
        setError(
          nextError instanceof Error
            ? nextError.message
            : "Forge couldn't load the morning ritual. Living Current is still available.",
        );
      }
    }

    void initialize();
    return () => {
      cancelled = true;
    };
  }, [acceptPlan, candidatesReady, enabled]);

  const enqueueMutation = useCallback(
    async (
      action: DayPlanMutationAction,
      patch: Partial<Omit<DayPlanMutationInput, 'planId' | 'mutationId' | 'expectedVersion' | 'action'>> = {},
      options: { mutationId?: string; itemId?: string; announce?: string } = {},
    ): Promise<DayPlanMutationResult> => {
      const run = async () => {
        const current = planRef.current;
        if (!current) throw new Error('The day plan is not ready.');
        setBusy(true);
        setError(undefined);
        if (options.itemId) {
          setSavingItemIds((items) => new Set(items).add(options.itemId!));
        }
        try {
          const result = await mutateDayPlan({
            planId: current.id,
            mutationId: options.mutationId ?? newDayPlanMutationId(),
            expectedVersion: current.version,
            action,
            ...patch,
          });
          acceptPlan(result.plan, result.snapshot);
          if (result.pendingReconciliations) {
            setPendingReconciliations(result.pendingReconciliations);
            if (result.pendingReconciliations.length > 0) {
              reconciliationBlockedRef.current = true;
            }
          }
          if (options.announce) setAnnouncement(options.announce);
          return result;
        } catch (nextError) {
          if (nextError instanceof DayPlanApiConflict) {
            acceptPlan(nextError.currentPlan);
          }
          const message =
            nextError instanceof Error ? nextError.message : "Forge couldn't update the day plan.";
          setError(message);
          throw nextError;
        } finally {
          setBusy(false);
          if (options.itemId) {
            setSavingItemIds((items) => {
              const next = new Set(items);
              next.delete(options.itemId!);
              return next;
            });
          }
        }
      };

      const queued = mutationQueueRef.current.then(run, run);
      mutationQueueRef.current = queued.catch(() => undefined);
      return queued;
    },
    [acceptPlan],
  );

  const openArrival = useCallback(async () => {
    const current = planRef.current;
    if (!current) throw new Error('There is no day plan to open.');
    if (current.state !== 'proposed') throw new Error('Today is already underway.');
    if (current.arrivalState === 'opened') {
      setView('arrival');
      return;
    }
    const action = current.arrivalState === 'skipped' || current.arrivalState === 'bypassed'
      ? 'arrival_reopen'
      : 'arrival_open';
    await enqueueMutation(action, {}, { announce: 'Morning Arrival opened.' });
  }, [enqueueMutation]);

  const snooze = useCallback(async () => {
    const snoozedUntil = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    await enqueueMutation('arrival_snooze', { snoozedUntil }, {
      announce: 'Morning Arrival snoozed for 15 minutes.',
    });
    setView('none');
  }, [enqueueMutation]);

  const skip = useCallback(async () => {
    await enqueueMutation('arrival_skip', {}, { announce: 'Morning Arrival skipped for today.' });
    setView('none');
  }, [enqueueMutation]);

  const bypass = useCallback(async () => {
    await enqueueMutation('arrival_bypass', {}, { announce: 'Entered Living Current.' });
    setView('none');
  }, [enqueueMutation]);

  const setOwner = useCallback(async (itemId: string, owner: DayPlanOwner) => {
    await enqueueMutation('item_owner', { itemId, owner }, {
      itemId,
      announce: `Owner changed to ${owner === 'me' ? 'Me' : owner === 'claude' ? 'Claude' : 'Together'}.`,
    });
  }, [enqueueMutation]);

  const reorder = useCallback(async (itemId: string, position: number, title: string) => {
    await enqueueMutation('item_reorder', { itemId, position }, {
      itemId,
      announce: `${title} moved to priority ${position + 1}.`,
    });
  }, [enqueueMutation]);

  const dismissItem = useCallback(async (itemId: string, title: string) => {
    await enqueueMutation('item_dismiss', { itemId }, {
      itemId,
      announce: `${title} removed from today’s essentials. The task is still in All Work.`,
    });
  }, [enqueueMutation]);

  const startDay = useCallback(async (): Promise<string | undefined> => {
    const current = planRef.current;
    if (!current) throw new Error('The day plan is not ready.');
    const result = await enqueueMutation('start_day', {}, {
      mutationId: onceOnlyDayPlanMutationId('start-day', current.id),
      announce: 'Your day is set.',
    });
    const firstItem = result.plan.items.find(
      (item) => item.id === result.plan.recommendedFirstItemId,
    );
    setTransitionMessage(firstItem
      ? firstItem.owner === 'me'
        ? `Your day is set. Start with ${firstItem.title}.`
        : `Your day is set. Start with the brief for ${firstItem.title}. Claude execution is not active yet.`
      : 'Your day is set. Living Current is ready.');
    setView('transition');
    await new Promise((resolve) => window.setTimeout(resolve, 1200));
    setView('none');
    return result.plan.recommendedFirstTaskId;
  }, [enqueueMutation]);

  const openSettlement = useCallback(async () => {
    const current = planRef.current;
    if (!current) throw new Error('There is no day plan to settle.');
    if (current.state === 'settling' && current.settlementState === 'in_progress') {
      setView('settlement');
      return;
    }
    if (current.state === 'settled') throw new Error('Today is already closed.');
    await enqueueMutation('settlement_start', {}, {
      mutationId: stableMutationId('settlement-start', current),
      announce: 'Day Settlement opened.',
    });
  }, [enqueueMutation]);

  const cancelSettlement = useCallback(() => {
    setView('none');
    setAnnouncement('Day Settlement left open for later.');
  }, []);

  const decideSettlement = useCallback(async (
    itemId: string,
    disposition: SettlementDisposition,
  ) => {
    const deferUntil = disposition === 'defer'
      ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
      : undefined;
    await enqueueMutation('settlement_decide', { itemId, disposition, deferUntil }, {
      itemId,
      announce: `Settlement decision saved: ${disposition}.`,
    });
  }, [enqueueMutation]);

  const commitSettlement = useCallback(async (
    completedHumanTaskIds: string[],
    nextDayNote?: string,
  ): Promise<DayPlanMutationResult> => {
    const current = planRef.current;
    if (!current) throw new Error('The day plan is not ready.');
    const result = await enqueueMutation(
      'settlement_commit',
      { completedHumanTaskIds, nextDayNote },
      {
        mutationId: onceOnlyDayPlanMutationId('settlement-commit', current.id),
        announce: 'The day is closed.',
      },
    );
    setView('none');
    return result;
  }, [enqueueMutation]);

  const openCurrentDayAfterSettlement = useCallback(async (
    settledLocalDate: string,
    excludedTaskIds: ReadonlySet<string> = new Set(),
  ) => {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    const localDate = localDateInTimezone(new Date(), timezone);
    if (settledLocalDate === localDate) return;
    if (!candidatesReady) {
      throw new Error('Forge needs a fresh task refresh before it can prepare today.');
    }
    const readModel = await getDayPlanState();
    let nextPlan = readModel.currentPlan;
    if (!nextPlan) {
      nextPlan = (await ensureDayPlan({
        localDate,
        timezone,
        mutationId: onceOnlyDayPlanMutationId('ensure', localDate),
        candidates: candidatesRef.current.filter(
          (candidate) => !excludedTaskIds.has(candidate.taskId),
        ),
      })).plan;
    }
    if (
      nextPlan.localDate === localDate &&
      nextPlan.state === 'proposed' &&
      ['due', 'not_due', 'failed'].includes(nextPlan.arrivalState)
    ) {
      nextPlan = (await mutateDayPlan({
        planId: nextPlan.id,
        mutationId: stableMutationId('arrival-open', nextPlan),
        expectedVersion: nextPlan.version,
        action: 'arrival_open',
      })).plan;
    }
    acceptPlan(nextPlan, readModel.latestSnapshot);
    reconciliationBlockedRef.current = false;
    setAnnouncement('The previous day is closed. Morning Arrival is ready.');
  }, [acceptPlan, candidatesReady]);

  const acknowledgeReconciliation = useCallback(async (reconciliationId: string) => {
    await acknowledgeDayPlanReconciliation(reconciliationId);
    setPendingReconciliations((current) =>
      current.filter((reconciliation) => reconciliation.id !== reconciliationId),
    );
  }, []);

  return {
    plan,
    latestSnapshot,
    pendingReconciliations,
    view,
    busy,
    savingItemIds,
    error,
    announcement,
    transitionMessage,
    ritualOpen: view === 'arrival' || view === 'transition' || view === 'settlement',
    openArrival,
    snooze,
    skip,
    bypass,
    setOwner,
    reorder,
    dismissItem,
    startDay,
    openSettlement,
    cancelSettlement,
    decideSettlement,
    commitSettlement,
    openCurrentDayAfterSettlement,
    acknowledgeReconciliation,
  };
}
