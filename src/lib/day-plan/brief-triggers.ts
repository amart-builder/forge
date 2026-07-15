import { morningBriefModelConfig } from "../claude-execution/brief-commands";
import {
  localDateInTimezone,
  nextBriefTargetLocalDate,
  settlementReconciliationComplete,
} from "./brief";
import type { MorningBriefArtifact } from "./brief";
import type {
  DayPlan,
  DayPlanMutationResult,
  DayPlanReconciliation,
  DayPlanReconciliationResult,
} from "./types";

// The slice of the store the trigger decision needs. Structural so tests can
// exercise every branch with a recording fake instead of a full settlement flow.
export type MorningBriefTriggerStore = {
  listPendingReconciliations(): DayPlanReconciliation[];
  getPlan(id: string): DayPlan | undefined;
  latestEligibleMorningBrief(
    targetLocalDate: string,
  ): MorningBriefArtifact | undefined;
  enqueueMorningBrief(
    targetLocalDate: string,
    provenance: { modelAlias: string; effort: string; budgetUsd: number },
  ): unknown;
};

// Queues Morning Brief generation on the spec's triggers, always fail-open:
// brief machinery must never block or delay the ritual response.
// - After Day Settlement reconciliation completes for THIS settlement. A
//   settlement with no defer/drop work is complete the moment it commits; one
//   with defer/drop rows completes on its last reconciliation ack. Pending
//   work from an earlier settlement never suppresses it, resurfaces never
//   participate, and idempotent replays never re-queue.
// - When arrival opens (or the plan is ensured) without an eligible artifact:
//   the arrival stays deterministic today and regeneration happens in the
//   background. A plan that already consumed a brief never re-queues.
export function maybeQueueMorningBrief(
  store: MorningBriefTriggerStore,
  action: string,
  result: unknown,
  now: Date = new Date(),
): void {
  try {
    if (action === "settlement_commit") {
      const mutation = result as DayPlanMutationResult;
      // A replayed commit already ran this trigger the first time.
      if (mutation.replayed) return;
      const plan = mutation.plan;
      if (!plan) return;
      if (
        !settlementReconciliationComplete(
          store.listPendingReconciliations(),
          mutation.snapshot?.id,
        )
      ) {
        return;
      }
      store.enqueueMorningBrief(
        nextBriefTargetLocalDate(plan.localDate, now, plan.timezone),
        morningBriefModelConfig(),
      );
      return;
    }
    if (action === "reconciliation_applied") {
      const ack = result as DayPlanReconciliationResult;
      if (ack.replayed) return;
      const reconciliation = ack.reconciliation;
      // Resurface acks land days after the settlement; only the settlement-night
      // defer/drop applications conclude a settlement's reconciliation.
      if (reconciliation.action === "resurface") return;
      if (
        !settlementReconciliationComplete(
          store.listPendingReconciliations(),
          reconciliation.snapshotId,
        )
      ) {
        return;
      }
      const plan = store.getPlan(reconciliation.dayPlanId);
      if (!plan) return;
      store.enqueueMorningBrief(
        nextBriefTargetLocalDate(plan.localDate, now, plan.timezone),
        morningBriefModelConfig(),
      );
      return;
    }
    if (action === "ensure" || action === "arrival_open") {
      const plan = (result as DayPlanMutationResult).plan;
      if (!plan || plan.briefId) return;
      // Only today's arrival regenerates. A stale plan surfacing here heads to
      // settlement, whose reconciliation trigger targets the right morning.
      if (plan.localDate !== localDateInTimezone(now, plan.timezone)) return;
      if (store.latestEligibleMorningBrief(plan.localDate)) return;
      store.enqueueMorningBrief(plan.localDate, morningBriefModelConfig());
    }
  } catch {
    // Fail open. The ritual response already succeeded.
  }
}
