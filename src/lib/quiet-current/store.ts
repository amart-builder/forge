import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

export type SuggestionKind = "create_task" | "returned_work";

export type SuggestionState =
  | "proposed"
  | "refined"
  | "accepted"
  | "deferred"
  | "dismissed"
  | "expired";

export type SuggestionPriority = "low" | "medium" | "high";

export type WorkSuggestion = {
  id: string;
  kind: SuggestionKind;
  title: string;
  description: string;
  reason: string;
  source: string;
  priority: SuggestionPriority;
  dueDate?: string;
  targetTaskId?: string;
  reviewMaterial?: string;
  state: SuggestionState;
  dismissReason?: string;
  resolvedTaskId?: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
};

export type DecisionEvent = {
  id: string;
  eventType: string;
  entityId?: string;
  before?: unknown;
  after?: unknown;
  reason?: string;
  source?: string;
  createdAt: string;
};

type QuietCurrentStore = {
  version: 1;
  suggestions: WorkSuggestion[];
  decisionEvents: DecisionEvent[];
};

const ACTIVE_STATES = new Set<SuggestionState>(["proposed", "refined"]);
const MAX_SUGGESTIONS = 500;
const MAX_EVENTS = 2000;
let testStorePath: string | undefined;
let tokenCache: string | undefined;

function storePath(): string {
  if (testStorePath) return testStorePath;
  const configuredName = process.env.FORGE_QUIET_CURRENT_FILE;
  const fileName = configuredName ? path.basename(configuredName) : "quiet-current.json";
  return path.join(process.cwd(), "data", fileName);
}

/** Test-only path override so state tests never touch a real Forge installation. */
export function setQuietCurrentStorePathForTests(file?: string): void {
  testStorePath = file;
  tokenCache = undefined;
}

export function getQuietCurrentCsrfToken(): string {
  if (tokenCache) return tokenCache;
  const file = `${storePath()}.token`;
  try {
    const existing = readFileSync(/* turbopackIgnore: true */ file, "utf8").trim();
    if (existing.length >= 32) {
      tokenCache = existing;
      return existing;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const token = randomUUID().replaceAll("-", "") + randomUUID().replaceAll("-", "");
  mkdirSync(/* turbopackIgnore: true */ path.dirname(file), { recursive: true });
  writeFileSync(/* turbopackIgnore: true */ file, `${token}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  tokenCache = token;
  return token;
}

function emptyStore(): QuietCurrentStore {
  return { version: 1, suggestions: [], decisionEvents: [] };
}

function readStore(): QuietCurrentStore {
  const file = storePath();
  try {
    const parsed = JSON.parse(
      readFileSync(/* turbopackIgnore: true */ file, "utf8"),
    ) as QuietCurrentStore;
    if (
      parsed.version !== 1 ||
      !Array.isArray(parsed.suggestions) ||
      !Array.isArray(parsed.decisionEvents)
    ) {
      throw new Error("Quiet Current data has an unsupported shape.");
    }
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyStore();
    throw error;
  }
}

function writeStore(store: QuietCurrentStore): void {
  const file = storePath();
  mkdirSync(/* turbopackIgnore: true */ path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(/* turbopackIgnore: true */ temporary, `${JSON.stringify(store, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  renameSync(
    /* turbopackIgnore: true */ temporary,
    /* turbopackIgnore: true */ file,
  );
}

function appendEvent(
  store: QuietCurrentStore,
  input: Omit<DecisionEvent, "id" | "createdAt">,
): DecisionEvent {
  const event: DecisionEvent = {
    ...input,
    id: randomUUID(),
    createdAt: new Date().toISOString(),
  };
  store.decisionEvents.push(event);
  if (store.decisionEvents.length > MAX_EVENTS) {
    store.decisionEvents = store.decisionEvents.slice(-MAX_EVENTS);
  }
  return event;
}

function expireSuggestions(store: QuietCurrentStore): boolean {
  const now = Date.now();
  let changed = false;

  for (const suggestion of store.suggestions) {
    if (
      ACTIVE_STATES.has(suggestion.state) &&
      new Date(suggestion.expiresAt).getTime() <= now
    ) {
      const previousState = suggestion.state;
      suggestion.state = "expired";
      suggestion.updatedAt = new Date().toISOString();
      appendEvent(store, {
        eventType: "suggestion_decay",
        entityId: suggestion.id,
        before: { state: previousState },
        after: { state: "expired" },
        source: "quiet_current",
      });
      changed = true;
    }
  }

  return changed;
}

export function pruneSuggestions(
  suggestions: WorkSuggestion[],
  maximum = MAX_SUGGESTIONS,
): WorkSuggestion[] {
  if (suggestions.length <= maximum) return suggestions;
  const terminal = suggestions.filter((suggestion) => !ACTIVE_STATES.has(suggestion.state));
  const removable = new Set(
    terminal.slice(0, Math.max(0, suggestions.length - maximum)).map((item) => item.id),
  );
  return suggestions.filter((suggestion) => !removable.has(suggestion.id));
}

export function getQuietCurrentSnapshot(): QuietCurrentStore {
  const store = readStore();
  if (expireSuggestions(store)) writeStore(store);
  return store;
}

export function createWorkSuggestion(input: {
  kind?: SuggestionKind;
  title: string;
  description?: string;
  reason: string;
  source: string;
  priority?: SuggestionPriority;
  dueDate?: string;
  targetTaskId?: string;
  reviewMaterial?: string;
  expiresAt?: string;
}): WorkSuggestion {
  const kind = input.kind ?? "create_task";
  if (kind === "returned_work" && !input.targetTaskId) {
    throw new Error("Returned work requires an existing target task.");
  }
  const store = readStore();
  expireSuggestions(store);
  const now = new Date();
  const expiresAt = input.expiresAt
    ? new Date(input.expiresAt)
    : new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
  if (Number.isNaN(expiresAt.getTime()) || expiresAt <= now) {
    throw new Error("Suggestion expiry must be a future date.");
  }

  const suggestion: WorkSuggestion = {
    id: randomUUID(),
    kind,
    title: input.title.trim(),
    description: input.description?.trim() ?? "",
    reason: input.reason.trim(),
    source: input.source.trim(),
    priority: input.priority ?? "medium",
    dueDate: input.dueDate,
    targetTaskId: input.targetTaskId,
    reviewMaterial: input.reviewMaterial,
    state: "proposed",
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };

  store.suggestions.push(suggestion);
  store.suggestions = pruneSuggestions(store.suggestions);
  appendEvent(store, {
    eventType: "suggestion_create",
    entityId: suggestion.id,
    after: suggestion,
    source: input.source,
  });
  writeStore(store);
  return suggestion;
}

export function resolveWorkSuggestion(
  id: string,
  input: {
    state: Exclude<SuggestionState, "proposed" | "expired">;
    title?: string;
    description?: string;
    dueDate?: string;
    priority?: SuggestionPriority;
    dismissReason?: string;
    resolvedTaskId?: string;
    source?: string;
  },
): WorkSuggestion {
  const store = readStore();
  expireSuggestions(store);
  const suggestion = store.suggestions.find((item) => item.id === id);
  if (!suggestion) throw new Error("Suggestion not found.");
  if (!ACTIVE_STATES.has(suggestion.state)) {
    throw new Error(`Suggestion is already ${suggestion.state}.`);
  }

  const before = { ...suggestion };
  if (input.title !== undefined) suggestion.title = input.title.trim();
  if (input.description !== undefined) {
    suggestion.description = input.description.trim();
  }
  if (input.dueDate !== undefined) suggestion.dueDate = input.dueDate;
  if (input.priority !== undefined) suggestion.priority = input.priority;
  suggestion.dismissReason = input.dismissReason;
  suggestion.resolvedTaskId = input.resolvedTaskId;
  suggestion.state = input.state;
  suggestion.updatedAt = new Date().toISOString();

  appendEvent(store, {
    eventType: {
      refined: "suggestion_refine",
      accepted: "suggestion_accept",
      deferred: "suggestion_defer",
      dismissed: "suggestion_dismiss",
    }[input.state],
    entityId: suggestion.id,
    before,
    after: suggestion,
    reason: input.dismissReason,
    source: input.source ?? "human",
  });
  writeStore(store);
  return suggestion;
}

export function reopenWorkSuggestion(
  id: string,
  state: "proposed" | "refined" = "proposed",
): WorkSuggestion {
  const store = readStore();
  const suggestion = store.suggestions.find((item) => item.id === id);
  if (!suggestion) throw new Error("Suggestion not found.");
  if (ACTIVE_STATES.has(suggestion.state) || suggestion.state === "expired") {
    throw new Error(`Suggestion cannot be reopened from ${suggestion.state}.`);
  }

  const before = { ...suggestion };
  suggestion.state = state;
  suggestion.dismissReason = undefined;
  suggestion.resolvedTaskId = undefined;
  suggestion.updatedAt = new Date().toISOString();
  if (new Date(suggestion.expiresAt).getTime() <= Date.now()) {
    suggestion.expiresAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
  }
  appendEvent(store, {
    eventType: "suggestion_undo",
    entityId: suggestion.id,
    before,
    after: suggestion,
    source: "human",
  });
  writeStore(store);
  return suggestion;
}

export function recordDecisionEvent(
  input: Omit<DecisionEvent, "id" | "createdAt">,
): DecisionEvent {
  const store = readStore();
  expireSuggestions(store);
  const event = appendEvent(store, input);
  writeStore(store);
  return event;
}
