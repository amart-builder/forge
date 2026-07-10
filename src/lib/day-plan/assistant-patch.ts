import { DayPlanInvalidTransition } from "./store-errors";
import type {
  DayPlan,
  DayPlanAssistantProposal,
} from "./types";

const EDITABLE_DECISIONS = new Set(["pending", "preselected", "accepted"]);

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

export function validateAssistantProposal(
  plan: DayPlan,
  proposal: DayPlanAssistantProposal,
): DayPlanAssistantProposal {
  const assistantText = proposal.assistantText?.trim();
  if (!assistantText || assistantText.length > 2000) {
    throw new DayPlanInvalidTransition("Assistant response text is invalid.");
  }
  if (!Array.isArray(proposal.operations) || proposal.operations.length > 12) {
    throw new DayPlanInvalidTransition("Assistant proposal has too many operations.");
  }
  if (typeof proposal.needsClarification !== "boolean") {
    throw new DayPlanInvalidTransition("Assistant clarification state is invalid.");
  }
  const editable = plan.items.filter((item) => EDITABLE_DECISIONS.has(item.decision));
  const editableIds = new Set(editable.map((item) => item.id));
  let reorderCount = 0;
  for (const operation of proposal.operations) {
    if (operation.operation === "reorder") {
      reorderCount += 1;
      if (reorderCount > 1) {
        throw new DayPlanInvalidTransition("Assistant proposal may reorder only once.");
      }
      if (
        operation.orderedItemIds.length !== editable.length ||
        new Set(operation.orderedItemIds).size !== editable.length ||
        operation.orderedItemIds.some((id) => !editableIds.has(id))
      ) {
        throw new DayPlanInvalidTransition("Assistant order must contain every retained item once.");
      }
      continue;
    }
    if (!editableIds.has(operation.itemId)) {
      throw new DayPlanInvalidTransition("Assistant proposal references an unavailable item.");
    }
    if (operation.operation === "set_owner") {
      if (!(["me", "claude", "together"] as const).includes(operation.owner)) {
        throw new DayPlanInvalidTransition("Assistant proposal has an invalid owner.");
      }
      continue;
    }
    if (operation.operation !== "edit_item") {
      throw new DayPlanInvalidTransition("Assistant proposal has an unsupported operation.");
    }
    const title = operation.title === undefined ? undefined : clean(operation.title);
    const outcome = operation.outcome === undefined ? undefined : clean(operation.outcome);
    const definition = operation.definitionOfDone === null
      ? null
      : operation.definitionOfDone === undefined
        ? undefined
        : clean(operation.definitionOfDone);
    if (operation.title !== undefined && (!title || title.length > 240)) {
      throw new DayPlanInvalidTransition("Assistant item title is invalid.");
    }
    if (operation.outcome !== undefined && (!outcome || outcome.length > 1200)) {
      throw new DayPlanInvalidTransition("Assistant item outcome is invalid.");
    }
    if (definition && definition.length > 1200) {
      throw new DayPlanInvalidTransition("Assistant definition of done is too long.");
    }
    if (title === undefined && outcome === undefined && definition === undefined) {
      throw new DayPlanInvalidTransition("Assistant edit has no supported fields.");
    }
  }
  if (proposal.needsClarification && proposal.operations.length > 0) {
    throw new DayPlanInvalidTransition("A clarification response cannot also edit the plan.");
  }
  return structuredClone({ ...proposal, assistantText });
}

export function applyAssistantProposal(
  plan: DayPlan,
  proposal: DayPlanAssistantProposal,
): void {
  for (const operation of proposal.operations) {
    if (operation.operation === "edit_item") {
      const item = plan.items.find((candidate) => candidate.id === operation.itemId)!;
      if (operation.title !== undefined) item.title = operation.title.trim();
      if (operation.outcome !== undefined) item.outcome = operation.outcome.trim();
      if (operation.definitionOfDone !== undefined) {
        item.definitionOfDone = operation.definitionOfDone?.trim() || undefined;
      }
    } else if (operation.operation === "set_owner") {
      plan.items.find((candidate) => candidate.id === operation.itemId)!.owner = operation.owner;
    } else {
      const retained = new Map(
        plan.items
          .filter((item) => EDITABLE_DECISIONS.has(item.decision))
          .map((item) => [item.id, item]),
      );
      const resolved = plan.items.filter((item) => !EDITABLE_DECISIONS.has(item.decision));
      plan.items = [
        ...operation.orderedItemIds.map((id) => retained.get(id)!),
        ...resolved,
      ];
    }
  }
  plan.items.forEach((item, position) => {
    item.position = position;
  });
}
