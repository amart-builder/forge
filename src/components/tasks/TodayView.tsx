'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createTask as createRestTask,
  deleteTask as deleteRestTask,
  listTaskColumns,
  listTasks,
  updateTask as updateRestTask,
} from '@/lib/data/tasks';
import type { Task as RestTask, TaskColumn as RestTaskColumn } from '@/lib/data/types';
import {
  getQuietCurrent,
  recordDecision,
  reopenSuggestion,
  resolveSuggestion,
  type WorkSuggestion,
} from '@/lib/data/quiet-current';
import { realTimeLabel } from '@/lib/quiet-current/presentation';
import CurrentCanvas, { type CurrentPoint, type Tributary } from './CurrentCanvas';
import TaskDetail from './TaskDetail';

type TaskStatus = 'open' | 'done' | 'archived';

interface ColumnData {
  _id: string;
  name: string;
  position: number;
  createdAt: number;
}

interface TaskData {
  _id: string;
  columnId: string;
  title: string;
  description: string;
  priority: 'low' | 'medium' | 'high';
  dueDate?: string;
  dueAt?: string;
  tags: string[];
  status?: TaskStatus;
  blocked: boolean;
  position: number;
  createdAt: number;
  updatedAt: number;
}

type CreateTaskInput = {
  columnId: string;
  title: string;
  description?: string;
  priority?: 'low' | 'medium' | 'high';
  dueDate?: string;
  tags?: string[];
};

type UpdateTaskInput = {
  columnId?: string | null;
  title?: string;
  description?: string;
  priority?: 'low' | 'medium' | 'high';
  dueDate?: string | null;
  tags?: string[];
  position?: number;
  status?: TaskStatus;
};

interface TodayExperienceProps {
  columns: ColumnData[];
  tasks: TaskData[];
  loading: boolean;
  error?: string;
  createTask: (input: CreateTaskInput) => Promise<string>;
  updateTask: (id: string, patch: UpdateTaskInput) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;
}

type UndoAction = {
  message: string;
  run: () => Promise<void>;
};

const TODAY_ALIASES = new Set(['Must happen today', 'Needs to happen today', 'Today']);
const IN_FLIGHT_ALIASES = new Set(['In Flight / Waiting', 'In Progress']);
const DONE_ALIASES = new Set(['Done', 'Completed']);
const JARVIS_HELD_TAG = 'jarvis-held';
const BLOCKED_TAG = 'blocked';
const FOCUS_KEY = 'forge.quiet-current.focus';
const NOTES_KEY = 'forge.quiet-current.notes';

function hasTag(task: TaskData, tag: string): boolean {
  return task.tags.some((candidate) => candidate.trim().toLowerCase() === tag);
}

function isEmailDigest(task: TaskData): boolean {
  return hasTag(task, 'email') && task.title.trim().startsWith('Emails:');
}

function withTag(tags: string[], tag: string): string[] {
  return hasNormalizedTag(tags, tag) ? tags : [...tags, tag];
}

function withoutTag(tags: string[], tag: string): string[] {
  return tags.filter((candidate) => candidate.trim().toLowerCase() !== tag);
}

function hasNormalizedTag(tags: string[], tag: string): boolean {
  return tags.some((candidate) => candidate.trim().toLowerCase() === tag);
}

function findColumn(columns: ColumnData[], aliases: Set<string>): ColumnData | undefined {
  return columns.find((column) => aliases.has(column.name));
}

function toEpoch(value: string | null | undefined): number {
  const parsed = value ? new Date(value).getTime() : Number.NaN;
  return Number.isNaN(parsed) ? 0 : parsed;
}

function normalizeRestColumn(column: RestTaskColumn): ColumnData {
  return { _id: column.id, name: column.name, position: column.position, createdAt: 0 };
}

function normalizeRestTask(task: RestTask): TaskData {
  const tags = task.tags ?? [];
  return {
    _id: task.id,
    columnId: task.column_id ?? '',
    title: task.title,
    description: task.description ?? '',
    priority: task.priority,
    dueDate: task.due_at?.slice(0, 10),
    dueAt: task.due_at ?? undefined,
    tags,
    status: task.status,
    blocked: hasNormalizedTag(tags, BLOCKED_TAG),
    position: task.position,
    createdAt: toEpoch(task.created_at),
    updatedAt: toEpoch(task.updated_at ?? task.created_at),
  };
}

function getGreeting(hour: number): string {
  if (hour < 12) return "Good morning. Let’s build something meaningful.";
  if (hour < 17) return 'Good afternoon. Keep the current clear.';
  return 'Good evening. Let the day settle.';
}

function getDayProgress(date: Date): number {
  const minutes = date.getHours() * 60 + date.getMinutes();
  const start = 6 * 60;
  const end = 22 * 60;
  return Math.max(0, Math.min(1, (minutes - start) / (end - start)));
}

function cubicPoint(progress: number): { x: number; y: number } {
  const inverse = 1 - progress;
  const start = { x: 18, y: 112 };
  const controlOne = { x: 116, y: 116 };
  const controlTwo = { x: 244, y: 76 };
  const end = { x: 306, y: 18 };
  return {
    x:
      inverse ** 3 * start.x +
      3 * inverse ** 2 * progress * controlOne.x +
      3 * inverse * progress ** 2 * controlTwo.x +
      progress ** 3 * end.x,
    y:
      inverse ** 3 * start.y +
      3 * inverse ** 2 * progress * controlOne.y +
      3 * inverse * progress ** 2 * controlTwo.y +
      progress ** 3 * end.y,
  };
}

function applyPatch(task: TaskData, patch: UpdateTaskInput): TaskData {
  return {
    ...task,
    columnId: patch.columnId === undefined ? task.columnId : (patch.columnId ?? ''),
    title: patch.title ?? task.title,
    description: patch.description ?? task.description,
    priority: patch.priority ?? task.priority,
    dueDate: patch.dueDate === undefined ? task.dueDate : (patch.dueDate ?? undefined),
    tags: patch.tags ?? task.tags,
    blocked:
      patch.tags === undefined ? task.blocked : hasNormalizedTag(patch.tags, BLOCKED_TAG),
    position: patch.position ?? task.position,
    status: patch.status ?? task.status,
    updatedAt: Date.now(),
  };
}

function toRestPatch(patch: UpdateTaskInput): Partial<RestTask> {
  return {
    column_id: patch.columnId,
    title: patch.title,
    description: patch.description,
    priority: patch.priority,
    due_at:
      patch.dueDate === undefined
        ? undefined
        : patch.dueDate
          ? new Date(`${patch.dueDate}T00:00:00`).toISOString()
          : null,
    tags: patch.tags,
    position: patch.position,
    status: patch.status,
  };
}

export default function TodayView() {
  return <RestTodayView />;
}

function RestTodayView() {
  const [columns, setColumns] = useState<ColumnData[]>([]);
  const [tasks, setTasks] = useState<TaskData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  const reload = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const [nextColumns, nextTasks] = await Promise.all([listTaskColumns(), listTasks()]);
      setColumns(nextColumns.map(normalizeRestColumn));
      setTasks(nextTasks.map(normalizeRestTask));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return (
    <TodayExperience
      columns={columns}
      tasks={tasks}
      loading={loading}
      error={error}
      createTask={async (input) => {
        const nextPosition =
          tasks
            .filter((task) => task.columnId === input.columnId)
            .reduce((maximum, task) => Math.max(maximum, task.position), -1) + 1;
        const created = await createRestTask({
          column_id: input.columnId,
          title: input.title,
          description: input.description,
          priority: input.priority,
          due_at: input.dueDate
            ? new Date(`${input.dueDate}T00:00:00`).toISOString()
            : undefined,
          tags: input.tags,
          position: nextPosition,
          source_type: 'quiet_current',
        });
        const normalized = normalizeRestTask(created);
        setTasks((current) => [...current, normalized]);
        return normalized._id;
      }}
      updateTask={async (id, patch) => {
        setTasks((current) =>
          current.map((task) => (task._id === id ? applyPatch(task, patch) : task)),
        );
        try {
          const updated = await updateRestTask(id, toRestPatch(patch));
          setTasks((current) =>
            current.map((task) => (task._id === id ? normalizeRestTask(updated) : task)),
          );
        } catch (nextError) {
          await reload();
          throw nextError;
        }
      }}
      deleteTask={async (id) => {
        setTasks((current) => current.filter((task) => task._id !== id));
        try {
          await deleteRestTask(id);
        } catch (nextError) {
          await reload();
          throw nextError;
        }
      }}
    />
  );
}

function TodayExperience({
  columns,
  tasks,
  loading,
  error,
  createTask,
  updateTask,
  deleteTask,
}: TodayExperienceProps) {
  const [suggestions, setSuggestions] = useState<WorkSuggestion[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(true);
  const [surfaceError, setSurfaceError] = useState<string>();
  const [now, setNow] = useState(() => new Date());
  const [ambientPaused, setAmbientPaused] = useState(() => {
    if (typeof document === 'undefined') return false;
    return document.hidden || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  });
  const [focusedTaskId, setFocusedTaskId] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return window.localStorage.getItem(FOCUS_KEY);
  });
  const [capture, setCapture] = useState('');
  const [capturing, setCapturing] = useState(false);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [focusExpanded, setFocusExpanded] = useState(false);
  const [wakeOpen, setWakeOpen] = useState(false);
  const [showAllDownstream, setShowAllDownstream] = useState(false);
  const [expandedSuggestionId, setExpandedSuggestionId] = useState<string | null>(null);
  const [detailTaskId, setDetailTaskId] = useState<string | null>(null);
  const [completingTaskId, setCompletingTaskId] = useState<string | null>(null);
  const [undo, setUndo] = useState<UndoAction | null>(null);
  const [undoPaused, setUndoPaused] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [dismissMenuId, setDismissMenuId] = useState<string | null>(null);
  const [editingSuggestionId, setEditingSuggestionId] = useState<string | null>(null);
  const [suggestionDraft, setSuggestionDraft] = useState({ title: '', description: '' });
  const [notes, setNotes] = useState<Record<string, string>>(() => {
    if (typeof window === 'undefined') return {};
    try {
      return JSON.parse(window.localStorage.getItem(NOTES_KEY) ?? '{}') as Record<string, string>;
    } catch {
      return {};
    }
  });
  const focusHeadingRef = useRef<HTMLHeadingElement>(null);
  const searchDialogRef = useRef<HTMLDivElement>(null);
  const searchReturnFocusRef = useRef<HTMLElement | null>(null);
  const undoRunningRef = useRef(false);

  const todayColumn = findColumn(columns, TODAY_ALIASES);
  const inFlightColumn = findColumn(columns, IN_FLIGHT_ALIASES);
  const doneColumn = findColumn(columns, DONE_ALIASES);

  const openTasks = useMemo(
    () =>
      tasks.filter(
        (task) =>
          task.status !== 'archived' &&
          task.status !== 'done' &&
          task.columnId !== doneColumn?._id,
      ),
    [doneColumn?._id, tasks],
  );

  const jarvisTasks = useMemo(
    () =>
      openTasks
        .filter((task) => hasTag(task, JARVIS_HELD_TAG) || isEmailDigest(task))
        .sort((left, right) => left.position - right.position),
    [openTasks],
  );

  const commitments = useMemo(() => {
    const activeColumnIds = new Set(
      [todayColumn?._id, inFlightColumn?._id].filter(Boolean) as string[],
    );
    return openTasks
      .filter(
        (task) =>
          activeColumnIds.has(task.columnId) &&
          !hasTag(task, JARVIS_HELD_TAG) &&
          !isEmailDigest(task),
      )
      .sort((left, right) => {
        const leftFlight = left.columnId === inFlightColumn?._id ? 0 : 1;
        const rightFlight = right.columnId === inFlightColumn?._id ? 0 : 1;
        return leftFlight - rightFlight || left.position - right.position;
      });
  }, [inFlightColumn?._id, openTasks, todayColumn?._id]);

  const doneToday = useMemo(() => {
    const today = new Date();
    return tasks
      .filter((task) => {
        if (task.columnId !== doneColumn?._id && task.status !== 'done') return false;
        const updated = new Date(task.updatedAt);
        return (
          updated.getFullYear() === today.getFullYear() &&
          updated.getMonth() === today.getMonth() &&
          updated.getDate() === today.getDate()
        );
      })
      .sort((left, right) => right.updatedAt - left.updatedAt);
  }, [doneColumn?._id, tasks]);

  const focusedTask = focusedTaskId
    ? openTasks.find((task) => task._id === focusedTaskId) ?? null
    : null;
  const focusedIsWithJarvis = Boolean(
    focusedTask && hasTag(focusedTask, JARVIS_HELD_TAG),
  );
  const focusedIsBrief = Boolean(focusedTask && isEmailDigest(focusedTask));
  const focusedIsOutsideToday = Boolean(
    focusedTask && !commitments.some((task) => task._id === focusedTask._id),
  );
  const detailTask = detailTaskId
    ? tasks.find((task) => task._id === detailTaskId) ?? null
    : null;
  const activeSuggestions = suggestions
    .filter((suggestion) => suggestion.state === 'proposed' || suggestion.state === 'refined')
    .slice(0, 3);

  const loadSuggestions = useCallback(async () => {
    try {
      const snapshot = await getQuietCurrent();
      setSuggestions(snapshot.suggestions);
      setSurfaceError(undefined);
    } catch (nextError) {
      setSurfaceError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setSuggestionsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSuggestions();
  }, [loadSuggestions]);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(new Date()), 30000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const updateAmbientMotion = () => {
      setAmbientPaused(document.hidden || reducedMotion.matches);
    };
    document.addEventListener('visibilitychange', updateAmbientMotion);
    reducedMotion.addEventListener('change', updateAmbientMotion);
    updateAmbientMotion();
    return () => {
      document.removeEventListener('visibilitychange', updateAmbientMotion);
      reducedMotion.removeEventListener('change', updateAmbientMotion);
    };
  }, []);

  useEffect(() => {
    if (loading || focusedTask || commitments.length === 0) return;
    const first = commitments[0];
    setFocusedTaskId(first._id);
    window.localStorage.setItem(FOCUS_KEY, first._id);
  }, [commitments, focusedTask, loading]);

  useEffect(() => {
    if (!undo || undoPaused) return;
    const timeout = window.setTimeout(() => setUndo(null), 10000);
    return () => window.clearTimeout(timeout);
  }, [undo, undoPaused]);

  useEffect(() => {
    if (!dismissMenuId) return;
    function closeOnOutsidePointer(event: PointerEvent) {
      const element = event.target as Element | null;
      const menu = element?.closest('[data-dismiss-menu]');
      if (menu?.getAttribute('data-dismiss-menu') !== dismissMenuId) {
        setDismissMenuId(null);
      }
    }
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer);
  }, [dismissMenuId]);

  const openSearch = useCallback(() => {
    searchReturnFocusRef.current = document.activeElement as HTMLElement | null;
    setSearchOpen(true);
  }, []);

  const closeSearch = useCallback((restoreFocus = true) => {
    setSearchOpen(false);
    setSearchQuery('');
    if (restoreFocus) {
      window.requestAnimationFrame(() => searchReturnFocusRef.current?.focus());
    }
  }, []);

  const focusTask = useCallback(
    (taskId: string, source: string) => {
      const previous = focusedTaskId;
      setFocusExpanded(false);
      setFocusedTaskId(taskId);
      window.localStorage.setItem(FOCUS_KEY, taskId);
      void recordDecision({
        eventType: 'focus_change',
        entityId: taskId,
        before: { focusedTaskId: previous },
        after: { focusedTaskId: taskId },
        source,
      }).catch(() => undefined);
      window.requestAnimationFrame(() => {
        focusHeadingRef.current?.focus({ preventScroll: true });
        focusHeadingRef.current?.closest('.current-now-shell')?.scrollIntoView({
          behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
          block: 'center',
        });
      });
    },
    [focusedTaskId],
  );

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const isTyping =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.tagName === 'SELECT' ||
        target?.isContentEditable;

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        openSearch();
        return;
      }
      if (searchOpen) {
        if (event.key === 'Escape') {
          event.preventDefault();
          closeSearch();
          return;
        }
        if (event.key === 'Tab') {
          const focusable = Array.from(
            searchDialogRef.current?.querySelectorAll<HTMLElement>(
              'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
            ) ?? [],
          );
          if (focusable.length > 0) {
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first.focus();
            }
          }
        }
        return;
      }
      if (event.key === 'Escape' && dismissMenuId) {
        setDismissMenuId(null);
        return;
      }
      if (isTyping || searchOpen || commitments.length === 0) return;
      if (!['j', 'k', 'ArrowDown', 'ArrowUp'].includes(event.key)) return;
      event.preventDefault();
      const currentIndex = commitments.findIndex((task) => task._id === focusedTaskId);
      const direction = event.key === 'j' || event.key === 'ArrowDown' ? 1 : -1;
      const baseIndex = currentIndex < 0 ? (direction > 0 ? -1 : 0) : currentIndex;
      const nextIndex = (baseIndex + direction + commitments.length) % commitments.length;
      focusTask(commitments[nextIndex]._id, 'keyboard');
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [closeSearch, commitments, dismissMenuId, focusTask, focusedTaskId, openSearch, searchOpen]);

  async function handleCapture(event: React.FormEvent) {
    event.preventDefault();
    const title = capture.trim();
    if (!title || !todayColumn || capturing) return;
    setCapturing(true);
    setSurfaceError(undefined);
    try {
      const taskId = await createTask({
        columnId: todayColumn._id,
        title,
        tags: ['captured-today'],
        priority: 'medium',
      });
      await recordDecision({
        eventType: 'plan_add',
        entityId: taskId,
        after: { title, commitment: 'ink' },
        source: 'what_changed',
      });
      setCapture('');
      setCaptureOpen(false);
      focusTask(taskId, 'capture');
    } catch (nextError) {
      setSurfaceError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setCapturing(false);
    }
  }

  function showUndo(action: UndoAction) {
    setUndoPaused(false);
    setUndo(action);
  }

  async function runUndo() {
    if (!undo || undoRunningRef.current) return;
    undoRunningRef.current = true;
    const action = undo;
    setUndo(null);
    try {
      await action.run();
    } catch (nextError) {
      setSurfaceError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      undoRunningRef.current = false;
    }
  }

  async function commitSuggestion(
    suggestion: WorkSuggestion,
    source: 'explicit_accept' | 'began_work',
  ) {
    if (!todayColumn) return;
    setSurfaceError(undefined);
    let resolvedTaskId: string | undefined;
    const targetTask = suggestion.targetTaskId
      ? tasks.find((task) => task._id === suggestion.targetTaskId)
      : undefined;
    if (suggestion.kind === 'returned_work' && !targetTask) {
      setSurfaceError('The task this returned work refers to no longer exists.');
      return;
    }
    const targetBefore = targetTask
      ? {
          columnId: targetTask.columnId,
          // Returned work is still Jarvis-held until the human accepts it. Keep
          // that ownership marker explicit so compensation and Undo restore the
          // handoff even if a stale client snapshot omitted the tag.
          tags:
            suggestion.kind === 'returned_work'
              ? withTag([...targetTask.tags], JARVIS_HELD_TAG)
              : [...targetTask.tags],
          status: targetTask.status,
          position: targetTask.position,
        }
      : undefined;

    async function rollBackTaskMutation() {
      if (targetTask && targetBefore) {
        await updateTask(targetTask._id, targetBefore);
      } else if (resolvedTaskId) {
        await deleteTask(resolvedTaskId);
      }
    }

    try {
      if (targetTask && suggestion.kind === 'returned_work') {
        resolvedTaskId = targetTask._id;
        await updateTask(targetTask._id, {
          tags: withoutTag(targetTask.tags, JARVIS_HELD_TAG),
        });
        focusTask(targetTask._id, 'returned_work');
      } else {
        resolvedTaskId = await createTask({
          columnId: todayColumn._id,
          title: suggestion.title,
          description: suggestion.description,
          priority: suggestion.priority,
          dueDate: suggestion.dueDate,
          tags: [],
        });
        focusTask(resolvedTaskId, source);
      }

      try {
        await resolveSuggestion(suggestion.id, {
          state: 'accepted',
          resolvedTaskId,
          source,
        });
      } catch (resolutionError) {
        try {
          await rollBackTaskMutation();
        } catch (rollbackError) {
          throw new Error(
            `The proposal could not be accepted, and Forge could not restore the task: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
          );
        } finally {
          setFocusedTaskId(commitments[0]?._id ?? null);
          await loadSuggestions();
        }
        throw resolutionError;
      }

      await loadSuggestions();
      showUndo({
        message: suggestion.kind === 'returned_work' ? 'Review moved to your current' : 'Added to your current',
        run: async () => {
          await reopenSuggestion(
            suggestion.id,
            suggestion.state === 'refined' ? 'refined' : 'proposed',
          );
          try {
            await rollBackTaskMutation();
          } catch (rollbackError) {
            await loadSuggestions();
            throw rollbackError;
          }
          await loadSuggestions();
          setUndo(null);
        },
      });
    } catch (nextError) {
      setSurfaceError(nextError instanceof Error ? nextError.message : String(nextError));
    }
  }

  async function refineSuggestion(suggestion: WorkSuggestion) {
    try {
      await resolveSuggestion(suggestion.id, {
        state: 'refined',
        title: suggestionDraft.title,
        description: suggestionDraft.description,
        source: 'human_refinement',
      });
      setEditingSuggestionId(null);
      await loadSuggestions();
    } catch (nextError) {
      setSurfaceError(nextError instanceof Error ? nextError.message : String(nextError));
    }
  }

  async function deferSuggestion(suggestion: WorkSuggestion) {
    try {
      await resolveSuggestion(suggestion.id, { state: 'deferred', source: 'human' });
      await loadSuggestions();
      showUndo({
        message: 'Set aside for later',
        run: async () => {
          await reopenSuggestion(
            suggestion.id,
            suggestion.state === 'refined' ? 'refined' : 'proposed',
          );
          await loadSuggestions();
          setUndo(null);
        },
      });
    } catch (nextError) {
      setSurfaceError(nextError instanceof Error ? nextError.message : String(nextError));
    }
  }

  async function dismissSuggestion(suggestion: WorkSuggestion, dismissReason: string) {
    try {
      await resolveSuggestion(suggestion.id, {
        state: 'dismissed',
        dismissReason,
        source: 'human',
      });
      await loadSuggestions();
      showUndo({
        message: 'Suggestion dismissed',
        run: async () => {
          await reopenSuggestion(
            suggestion.id,
            suggestion.state === 'refined' ? 'refined' : 'proposed',
          );
          await loadSuggestions();
          setUndo(null);
        },
      });
    } catch (nextError) {
      setSurfaceError(nextError instanceof Error ? nextError.message : String(nextError));
    }
  }

  async function completeTask(task: TaskData) {
    if (!doneColumn || completingTaskId) return;
    setCompletingTaskId(task._id);
    setSurfaceError(undefined);
    await new Promise((resolve) => window.setTimeout(resolve, 230));
    try {
      await updateTask(task._id, {
        columnId: doneColumn._id,
        status: 'done',
        position: tasks.filter((candidate) => candidate.columnId === doneColumn._id).length,
      });
      await recordDecision({
        eventType: 'task_complete',
        entityId: task._id,
        before: { columnId: task.columnId, status: task.status },
        after: { columnId: doneColumn._id, status: 'done' },
        source: 'human',
      });
      const nextTask = commitments.find((candidate) => candidate._id !== task._id);
      setFocusedTaskId(nextTask?._id ?? null);
      if (nextTask) window.localStorage.setItem(FOCUS_KEY, nextTask._id);
      else window.localStorage.removeItem(FOCUS_KEY);
      showUndo({
        message: 'Completed',
        run: async () => {
          await updateTask(task._id, {
            columnId: task.columnId,
            status: task.status ?? 'open',
            position: task.position,
          });
          await recordDecision({
            eventType: 'task_undo',
            entityId: task._id,
            reason: 'completion_undo',
            source: 'human',
          });
          focusTask(task._id, 'undo');
          setUndo(null);
        },
      });
    } catch (nextError) {
      setSurfaceError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setCompletingTaskId(null);
    }
  }

  async function handToJarvis(task: TaskData) {
    const nextTags = withTag(task.tags, JARVIS_HELD_TAG);
    try {
      await updateTask(task._id, { tags: nextTags });
      await recordDecision({
        eventType: 'task_handoff',
        entityId: task._id,
        before: { holder: 'human' },
        after: { holder: 'jarvis' },
        source: 'human',
      });
      const nextTask = commitments.find((candidate) => candidate._id !== task._id);
      setFocusedTaskId(nextTask?._id ?? null);
      showUndo({
        message: 'Jarvis is carrying it',
        run: async () => {
          await updateTask(task._id, { tags: task.tags });
          focusTask(task._id, 'pluck_back');
          setUndo(null);
        },
      });
    } catch (nextError) {
      setSurfaceError(nextError instanceof Error ? nextError.message : String(nextError));
    }
  }

  async function bringBack(task: TaskData) {
    try {
      await updateTask(task._id, { tags: withoutTag(task.tags, JARVIS_HELD_TAG) });
      await recordDecision({
        eventType: 'task_pluck_back',
        entityId: task._id,
        before: { holder: 'jarvis' },
        after: { holder: 'human' },
        source: 'human',
      });
      focusTask(task._id, 'pluck_back');
    } catch (nextError) {
      setSurfaceError(nextError instanceof Error ? nextError.message : String(nextError));
    }
  }

  function updateWorkingNote(taskId: string, value: string) {
    const nextNotes = { ...notes, [taskId]: value };
    setNotes(nextNotes);
    window.localStorage.setItem(NOTES_KEY, JSON.stringify(nextNotes));
  }

  async function saveDetail(patch: UpdateTaskInput) {
    if (!detailTask) return;
    let nextPatch = patch;
    if (patch.columnId && patch.columnId !== detailTask.columnId && patch.position === undefined) {
      nextPatch = {
        ...patch,
        position: tasks.filter((task) => task.columnId === patch.columnId).length,
        status: patch.columnId === doneColumn?._id ? 'done' : 'open',
      };
    }
    await updateTask(detailTask._id, nextPatch);
  }

  const timeLabel = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  }).format(now);
  const downstream = commitments.filter((task) => task._id !== focusedTask?._id);
  const visibleDownstream = showAllDownstream ? downstream : downstream.slice(0, 5);
  const hiddenDownstreamCount = Math.max(0, downstream.length - visibleDownstream.length);
  const focusPoint: CurrentPoint = { x: 500, y: 330 };
  const downstreamStartY = focusPoint.y + (focusExpanded ? 520 : 230);
  const downstreamGap = 150;
  const downstreamLayout = visibleDownstream.map((task, index) => ({
    task,
    x: [548, 438, 536, 456, 556, 448][index % 6],
    y: downstreamStartY + index * downstreamGap,
    side: index % 2 === 0 ? 'right' as const : 'left' as const,
  }));
  const tailY = downstreamStartY + visibleDownstream.length * downstreamGap;
  let tributaryCursor = tailY + (hiddenDownstreamCount > 0 ? 170 : 100);
  const suggestionLayout = activeSuggestions.map((suggestion, index) => {
    const expanded =
      expandedSuggestionId === suggestion.id || editingSuggestionId === suggestion.id;
    const layout = {
      suggestion,
      expanded,
      y: tributaryCursor,
      side: index % 2 === 0 ? 'left' as const : 'right' as const,
    };
    tributaryCursor += expanded ? 430 : 180;
    return layout;
  });
  const stageHeight = Math.max(
    900,
    suggestionLayout.length > 0 ? tributaryCursor + 100 : tailY + 260,
  );
  const pathPoints: CurrentPoint[] = [
    { x: 540, y: 0 },
    { x: 468, y: 128 },
    { x: 522, y: 224 },
    focusPoint,
    ...downstreamLayout.map(({ x, y }) => ({ x, y })),
    { x: 500, y: stageHeight },
  ];
  const tributaries: Tributary[] = suggestionLayout.map(({ suggestion, side, y }) => ({
    id: suggestion.id,
    side,
    y,
  }));
  const progress = getDayProgress(now);
  const dayPoint = cubicPoint(progress);
  const greeting = getGreeting(now.getHours());
  const waterTone = now.getHours() < 11 ? 'morning' : now.getHours() < 17 ? 'day' : 'evening';
  const searchResults = openTasks
    .filter((task) => {
      const query = searchQuery.trim().toLowerCase();
      return !query || `${task.title} ${task.description} ${task.tags.join(' ')}`.toLowerCase().includes(query);
    })
    .slice(0, 8);

  if (loading) {
    return (
      <div className="quiet-current-surface flex h-full items-center justify-center">
        <div className="quiet-loading-orb" aria-label="Loading your current" />
      </div>
    );
  }

  if (error || !todayColumn || !doneColumn) {
    return (
      <div className="quiet-current-surface flex h-full items-center justify-center p-6">
        <div className="quiet-error-card max-w-lg">
          <p className="text-sm font-semibold">Today could not form.</p>
          <p className="mt-2 text-sm text-muted-foreground">
            {error || 'Forge needs its Today and Done columns before Quiet Current can open.'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={`quiet-current-surface current-river-surface is-${waterTone} ${ambientPaused ? 'is-ambient-paused' : ''} h-full overflow-y-auto`}>
      <div className="current-water-plane" aria-hidden="true">
        <span className="current-water-drift current-water-drift-one" />
        <span className="current-water-drift current-water-drift-two" />
      </div>

      <div className="current-river-shell">
        <header className="current-arrival" aria-label={`Today at ${timeLabel}`}>
          <div className="current-arrival-copy">
            <p className="current-today-label">Today</p>
            <time className="current-time" dateTime={now.toISOString()}>{timeLabel}</time>
            <p className="current-greeting">{greeting}</p>
            <button
              type="button"
              className="current-capture-toggle"
              aria-expanded={captureOpen}
              onClick={() => setCaptureOpen((current) => !current)}
            >
              <span aria-hidden="true">＋</span>
              What changed?
            </button>
            {captureOpen && (
              <form onSubmit={handleCapture} className="current-capture-form">
                <label htmlFor="quiet-capture" className="sr-only">Add missing work or context</label>
                <input
                  id="quiet-capture"
                  autoFocus
                  value={capture}
                  onChange={(event) => setCapture(event.target.value)}
                  placeholder="Add the work Jarvis could not know."
                />
                <button type="submit" disabled={!capture.trim() || capturing}>Add</button>
              </form>
            )}
            {surfaceError && <p role="alert" className="current-surface-error">{surfaceError}</p>}
          </div>

          <div className="current-day-arc" aria-hidden="true">
            <svg viewBox="0 0 324 132">
              <path d="M 18 112 C 116 116, 244 76, 306 18" />
              <circle cx={dayPoint.x} cy={dayPoint.y} r="6" />
              <g className="current-sun" transform="translate(306 18)">
                <circle r="9" />
                {[0, 45, 90, 135].map((angle) => (
                  <path key={angle} d="M 0 -17 L 0 -24" transform={`rotate(${angle})`} />
                ))}
              </g>
            </svg>
          </div>
        </header>

        <section
          className="current-river-stage"
          style={{ height: stageHeight }}
          aria-label="Your current"
        >
          <CurrentCanvas
            height={stageHeight}
            points={pathPoints}
            tributaries={tributaries}
            focusPoint={focusPoint}
            completing={Boolean(completingTaskId)}
            ambientPaused={ambientPaused}
          />

          {doneToday.length > 0 && (
            <div className="current-wake-cluster">
              <button type="button" onClick={() => setWakeOpen((current) => !current)} aria-expanded={wakeOpen}>
                <span className="current-wake-dots" aria-hidden="true">
                  {doneToday.slice(0, 3).map((task) => <i key={task._id} />)}
                </span>
                <span>{doneToday.length} done today</span>
              </button>
              {wakeOpen && (
                <div className="current-wake-list">
                  {doneToday.slice(0, 5).map((task) => <p key={task._id}>{task.title}</p>)}
                  {doneToday.length > 5 && <span>And {doneToday.length - 5} more in the wake</span>}
                </div>
              )}
            </div>
          )}

          {focusedTask ? (
            <article
              className={`current-now-shell ${focusExpanded ? 'is-expanded' : ''} ${completingTaskId === focusedTask._id ? 'is-completing' : ''}`}
              style={{ top: focusPoint.y }}
              aria-labelledby="quiet-now-title"
            >
              <div className="current-now-pill">
                <button
                  type="button"
                  className="current-now-main"
                  aria-expanded={focusExpanded}
                  onClick={() => setFocusExpanded((current) => !current)}
                >
                  <span className="current-now-kicker">
                    {focusedIsWithJarvis ? 'With Jarvis' : focusedIsBrief ? 'Brief' : 'Now'}
                    {focusedTask.blocked ? ' · Waiting' : ''}
                    {focusedIsOutsideToday && !focusedIsWithJarvis && !focusedIsBrief ? ' · Outside today' : ''}
                  </span>
                  <h2 ref={focusHeadingRef} id="quiet-now-title" tabIndex={-1}>{focusedTask.title}</h2>
                  <span className="current-now-reveal" aria-hidden="true">{focusExpanded ? '−' : '＋'}</span>
                </button>
                <button
                  type="button"
                  className="current-complete-orb"
                  disabled={Boolean(completingTaskId)}
                  aria-label={focusedIsWithJarvis ? `Bring back ${focusedTask.title}` : `Complete ${focusedTask.title}`}
                  onClick={() => focusedIsWithJarvis ? void bringBack(focusedTask) : void completeTask(focusedTask)}
                >
                  {focusedIsWithJarvis ? (
                    <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m15 6-6 6 6 6" /></svg>
                  ) : (
                    <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m5 12 4 4L19 6" /></svg>
                  )}
                </button>
              </div>

              {focusExpanded && (
                <div className="current-focus-details">
                  <h3 className="current-focus-full-title">{focusedTask.title}</h3>
                  {focusedTask.description && <p className="current-focus-description">{focusedTask.description}</p>}
                  <div className="current-focus-materials">
                    <div>
                      <label htmlFor={`working-note-${focusedTask._id}`}>Working note</label>
                      <textarea
                        id={`working-note-${focusedTask._id}`}
                        value={notes[focusedTask._id] ?? ''}
                        onChange={(event) => updateWorkingNote(focusedTask._id, event.target.value)}
                        readOnly={focusedIsWithJarvis}
                        placeholder={focusedIsWithJarvis ? 'Bring this work back before adding a note.' : 'Keep the thought you are carrying.'}
                        rows={3}
                      />
                    </div>
                    <dl>
                      <div><dt>Priority</dt><dd className="capitalize">{focusedTask.priority}</dd></div>
                      <div><dt>Due</dt><dd>{focusedTask.dueDate ? new Date(`${focusedTask.dueDate}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'Open'}</dd></div>
                      <div><dt>State</dt><dd>{focusedIsWithJarvis ? 'With Jarvis' : 'Ink'}</dd></div>
                    </dl>
                  </div>
                  <div className="current-focus-actions">
                    <button type="button" onClick={() => setDetailTaskId(focusedTask._id)}>Edit details</button>
                    {!focusedIsWithJarvis && <button type="button" onClick={() => void handToJarvis(focusedTask)}>Hand to Jarvis</button>}
                    <button type="button" onClick={openSearch}>Find other work <kbd>⌘K</kbd></button>
                  </div>
                </div>
              )}
            </article>
          ) : (
            <div className="current-empty-now" style={{ top: focusPoint.y }}>
              <p>The current is clear.</p>
              <button type="button" onClick={openSearch}>Choose what comes next</button>
            </div>
          )}

          {downstreamLayout.map(({ task, x, y, side }, index) => {
            const time = realTimeLabel(task.dueAt);
            return (
              <button
                key={task._id}
                type="button"
                className={`current-river-node is-${side} ${time ? 'is-anchored' : ''}`}
                style={{ left: `${x / 10}%`, top: y }}
                onClick={() => focusTask(task._id, 'pointer')}
                aria-label={`Downstream ${index + 1} of ${downstream.length}: ${task.title}${time ? ` at ${time}` : ''}`}
              >
                <span className="current-node-dot" aria-hidden="true" />
                <span className="current-node-copy">
                  {time && <time>{time}</time>}
                  <strong>{task.title}</strong>
                </span>
              </button>
            );
          })}

          {hiddenDownstreamCount > 0 && (
            <button
              type="button"
              className="current-river-tail"
              style={{ top: tailY - 30 }}
              onClick={() => setShowAllDownstream(true)}
            >
              <span aria-hidden="true">⌄</span>
              {hiddenDownstreamCount} more downstream
            </button>
          )}
          {showAllDownstream && downstream.length > 5 && (
            <button type="button" className="current-river-tail" style={{ top: tailY - 30 }} onClick={() => setShowAllDownstream(false)}>
              Show less
            </button>
          )}

          <aside className="current-jarvis-current" aria-labelledby="jarvis-lane-title">
            <div className="current-jarvis-heading">
              <span>Second current</span>
              <h2 id="jarvis-lane-title">With Jarvis</h2>
              <i aria-hidden="true" />
            </div>
            <div className="current-jarvis-nodes">
              {jarvisTasks.length > 0 ? jarvisTasks.slice(0, 3).map((task) => (
                <article key={task._id} className={focusedTaskId === task._id ? 'is-focused' : ''}>
                  <button type="button" onClick={() => isEmailDigest(task) ? setDetailTaskId(task._id) : focusTask(task._id, 'jarvis_current')}>
                    <span>{isEmailDigest(task) ? 'Brief ready' : 'Jarvis is carrying this'}</span>
                    <strong>{task.title}</strong>
                  </button>
                </article>
              )) : <p className="current-jarvis-empty">The second current is quiet.</p>}
              {jarvisTasks.length > 3 && (
                <button type="button" className="current-jarvis-more" onClick={openSearch}>
                  +{jarvisTasks.length - 3} more with Jarvis
                </button>
              )}
            </div>
          </aside>

          {!suggestionsLoading && suggestionLayout.map(({ suggestion, expanded, side, y }) => (
            <article
              key={suggestion.id}
              className={`current-tributary is-${side} ${expanded ? 'is-expanded' : ''}`}
              style={{ top: y }}
            >
              <button
                type="button"
                className="current-tributary-summary"
                aria-expanded={expanded}
                onClick={() => setExpandedSuggestionId((current) => current === suggestion.id ? null : suggestion.id)}
              >
                <span className="current-pencil-mark">Pencil</span>
                <strong>{suggestion.title}</strong>
                <span>{suggestion.reason}</span>
              </button>

              {expanded && (
                <div className="current-tributary-details">
                  {editingSuggestionId === suggestion.id ? (
                    <div className="space-y-3">
                      <label className="quiet-material-label" htmlFor={`suggestion-title-${suggestion.id}`}>Refine the proposal</label>
                      <input id={`suggestion-title-${suggestion.id}`} value={suggestionDraft.title} onChange={(event) => setSuggestionDraft((current) => ({ ...current, title: event.target.value }))} className="quiet-pencil-input" />
                      <textarea aria-label="Suggestion description" value={suggestionDraft.description} onChange={(event) => setSuggestionDraft((current) => ({ ...current, description: event.target.value }))} rows={3} className="quiet-pencil-input resize-none" />
                      <div className="flex gap-2">
                        <button type="button" onClick={() => void refineSuggestion(suggestion)} className="quiet-pencil-action is-primary">Save wording</button>
                        <button type="button" onClick={() => setEditingSuggestionId(null)} className="quiet-pencil-action">Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      {suggestion.description && <p>{suggestion.description}</p>}
                      {suggestion.kind === 'returned_work' && suggestion.reviewMaterial && <details className="quiet-returned-work"><summary>Read Jarvis&apos;s work</summary><pre>{suggestion.reviewMaterial}</pre></details>}
                      <small>Source: {suggestion.source}</small>
                      <div className="current-tributary-actions">
                        <button type="button" onClick={() => void commitSuggestion(suggestion, 'explicit_accept')} className="quiet-pencil-action is-primary">Accept</button>
                        <button type="button" onClick={() => void commitSuggestion(suggestion, 'began_work')} className="quiet-pencil-action">Begin</button>
                        <button type="button" onClick={() => { setEditingSuggestionId(suggestion.id); setSuggestionDraft({ title: suggestion.title, description: suggestion.description }); }} className="quiet-pencil-action">Edit</button>
                        <button type="button" onClick={() => void deferSuggestion(suggestion)} className="quiet-pencil-action">Later</button>
                        <div className="quiet-dismiss-menu relative" data-dismiss-menu={suggestion.id}>
                          <button type="button" aria-haspopup="menu" aria-expanded={dismissMenuId === suggestion.id} onClick={() => setDismissMenuId((current) => current === suggestion.id ? null : suggestion.id)} className="quiet-pencil-action">Dismiss</button>
                          {dismissMenuId === suggestion.id && <div className="quiet-dismiss-popover" role="menu">
                            {[[ 'not_mine', 'Not mine' ], [ 'already_done', 'Already done' ], [ 'not_real_work', 'Not real work' ], [ 'wrong_time', 'Wrong time' ]].map(([reason, label]) => (
                              <button key={reason} role="menuitem" type="button" onClick={() => { setDismissMenuId(null); void dismissSuggestion(suggestion, reason); }}>{label}</button>
                            ))}
                          </div>}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}
            </article>
          ))}

          <p className="current-switch-hint" style={{ top: stageHeight - 72 }}>
            Switch focus by choosing what&apos;s next.
          </p>
        </section>
      </div>

      {undo && (
        <div
          className="quiet-undo"
          role="status"
          onMouseEnter={() => setUndoPaused(true)}
          onMouseLeave={() => setUndoPaused(false)}
          onFocusCapture={() => setUndoPaused(true)}
          onBlurCapture={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
              setUndoPaused(false);
            }
          }}
        >
          <span>{undo.message}</span>
          <button type="button" onClick={() => void runUndo()}>Undo</button>
          {!undoPaused && <span className="quiet-undo-timer" aria-hidden="true" />}
        </div>
      )}

      {searchOpen && (
        <div className="quiet-search-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && closeSearch()}>
          <div ref={searchDialogRef} className="quiet-search-dialog" role="dialog" aria-modal="true" aria-label="Find work">
            <div className="flex items-center gap-3 border-b px-4">
              <svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="text-muted-foreground">
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" />
              </svg>
              <input
                autoFocus
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Focus any task without changing its state"
                className="h-14 min-w-0 flex-1 border-0 bg-transparent text-sm outline-none"
              />
              <kbd className="quiet-key">Esc</kbd>
            </div>
            <div className="max-h-[360px] overflow-y-auto p-2">
              {searchResults.map((task) => {
                const inCurrent = commitments.some((candidate) => candidate._id === task._id);
                const withJarvis = hasTag(task, JARVIS_HELD_TAG);
                const brief = isEmailDigest(task);
                return (
                  <button
                    key={task._id}
                    type="button"
                    onClick={() => {
                      focusTask(task._id, 'search');
                      closeSearch(false);
                    }}
                    className="quiet-search-result"
                  >
                    <span className="min-w-0 flex-1 truncate text-left">{task.title}</span>
                    <span className="text-[10px] text-muted-foreground">
                      {withJarvis ? 'With Jarvis' : brief ? 'Brief' : inCurrent ? 'In current' : 'Outside today'}
                    </span>
                  </button>
                );
              })}
              {searchResults.length === 0 && <p className="px-3 py-8 text-center text-sm text-muted-foreground">No matching work.</p>}
            </div>
          </div>
        </div>
      )}

      {detailTask && (
        <TaskDetail
          taskId={detailTask._id}
          task={detailTask}
          columns={columns}
          onClose={() => setDetailTaskId(null)}
          onDeleted={() => setDetailTaskId(null)}
          onSaveTask={saveDetail}
          onDeleteTask={() => deleteTask(detailTask._id)}
        />
      )}
    </div>
  );
}
