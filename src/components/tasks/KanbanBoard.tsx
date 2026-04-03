'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery, useMutation } from 'convex/react';
import { api } from '../../../convex/_generated/api';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCorners,
  defaultDropAnimationSideEffects,
} from '@dnd-kit/core';
import type {
  DragEndEvent,
  DragOverEvent,
  DragStartEvent,
  UniqueIdentifier,
} from '@dnd-kit/core';
import { arrayMove, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import Column from './Column';
import TaskCard from './TaskCard';
import TaskDetail from './TaskDetail';

interface ColumnData {
  _id: string;
  name: string;
  position: number;
  _creationTime: number;
  createdAt: number;
}

interface TaskData {
  _id: string;
  columnId: string;
  title: string;
  description: string;
  priority: 'low' | 'medium' | 'high';
  dueDate?: string;
  tags: string[];
  position: number;
  _creationTime: number;
  createdAt: number;
  updatedAt: number;
}

const dropAnimationConfig = {
  duration: 250,
  easing: 'cubic-bezier(0.25, 1, 0.5, 1)',
  sideEffects: defaultDropAnimationSideEffects({
    styles: {
      active: {
        opacity: '0.5',
      },
    },
  }),
};

export default function KanbanBoard() {
  const columnsQuery = useQuery(api.columns.list);
  const tasksQuery = useQuery(api.tasks.list);

  const seedMutation = useMutation(api.init.seed);
  const createTaskMutation = useMutation(api.tasks.create);
  const updateTaskMutation = useMutation(api.tasks.update);
  const removeTaskMutation = useMutation(api.tasks.remove);

  const [localTasks, setLocalTasks] = useState<TaskData[] | null>(null);
  const [activeTaskId, setActiveTaskId] = useState<UniqueIdentifier | null>(null);
  const [detailTaskId, setDetailTaskId] = useState<string | null>(null);
  const [seeded, setSeeded] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Add task form state
  const [newTask, setNewTask] = useState({
    title: '',
    priority: 'medium' as 'low' | 'medium' | 'high',
    dueDate: '',
    description: '',
    tags: '',
  });

  useEffect(() => {
    if (!seeded) {
      seedMutation().then(() => setSeeded(true));
    }
  }, [seeded, seedMutation]);

  // Force canonical column order regardless of position field
  // Handle both old names (To Do) and new names (Not Started)
  const COLUMN_ORDER: Record<string, number> = {
    'Not Started': 0, 'To Do': 0,
    'In Progress': 1,
    'Blocked': 2,
    'Done': 3, 'Completed': 3,
  };
  const columns = ((columnsQuery ?? []) as ColumnData[]).sort((a, b) => {
    return (COLUMN_ORDER[a.name] ?? 99) - (COLUMN_ORDER[b.name] ?? 99);
  });
  const tasks = (localTasks ?? tasksQuery ?? []) as TaskData[];

  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;

  useEffect(() => {
    if (tasksQuery && localTasks) {
      setLocalTasks(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasksQuery]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const loading = columnsQuery === undefined || tasksQuery === undefined;
  const totalTasks = tasks.length;

  // Filter tasks by search
  const filteredTasks = searchQuery.trim()
    ? tasks.filter(
        (t) =>
          t.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
          t.description?.toLowerCase().includes(searchQuery.toLowerCase()) ||
          t.tags.some((tag) => tag.toLowerCase().includes(searchQuery.toLowerCase()))
      )
    : tasks;

  function getTasksForColumn(columnId: string) {
    return filteredTasks
      .filter((t) => t.columnId === columnId)
      .sort((a, b) => a.position - b.position);
  }

  function findColumnOfTask(taskId: UniqueIdentifier): string | undefined {
    return tasksRef.current.find((t) => t._id === taskId)?.columnId;
  }

  function handleDragStart(event: DragStartEvent) {
    setActiveTaskId(event.active.id);
  }

  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event;
    if (!over) return;

    const activeId = active.id;
    const overId = over.id;

    const activeCol = findColumnOfTask(activeId);
    const overCol =
      columns.find((c) => c._id === overId)?._id ?? findColumnOfTask(overId);

    if (!activeCol || !overCol || activeCol === overCol) return;

    setLocalTasks((prev) => {
      const base = prev ?? tasksRef.current;
      return base.map((t) =>
        t._id === activeId ? { ...t, columnId: overCol } : t
      );
    });
  }

  async function handleDragEnd(event: DragEndEvent) {
    setActiveTaskId(null);

    const { active, over } = event;
    if (!over) {
      setLocalTasks(null);
      return;
    }

    const activeId = active.id as string;
    const overId = over.id as string;

    const activeCol = findColumnOfTask(activeId);
    const overCol =
      columns.find((c) => c._id === overId)?._id ?? findColumnOfTask(overId);

    if (!activeCol || !overCol) {
      setLocalTasks(null);
      return;
    }

    const currentTasks = [...tasksRef.current];
    const colTasks = currentTasks
      .filter((t) => t.columnId === overCol)
      .sort((a, b) => a.position - b.position);

    const activeIndex = colTasks.findIndex((t) => t._id === activeId);
    const overIndex = colTasks.findIndex((t) => t._id === overId);

    if (activeIndex !== -1 && overIndex !== -1 && activeIndex !== overIndex) {
      const reordered = arrayMove(colTasks, activeIndex, overIndex);
      reordered.forEach((t, i) => {
        const idx = currentTasks.findIndex((nt) => nt._id === t._id);
        if (idx !== -1) currentTasks[idx] = { ...currentTasks[idx], position: i };
      });
    }

    const finalColTasks = currentTasks
      .filter((t) => t.columnId === overCol)
      .sort((a, b) => a.position - b.position);
    const finalTask = finalColTasks.find((t) => t._id === activeId);
    const newPosition = finalTask?.position ?? finalColTasks.length;

    setLocalTasks(currentTasks);

    try {
      await updateTaskMutation({
        id: activeId as any,
        columnId: overCol as any,
        position: newPosition,
      });
    } catch (err) {
      console.error('Failed to persist drag:', err);
    } finally {
      setLocalTasks(null);
    }
  }

  async function handleAddTask(e: React.FormEvent) {
    e.preventDefault();
    if (!newTask.title.trim()) return;

    // Find "Not Started" column (first column by position)
    const notStartedCol = columns.find((c) => c.name === 'Not Started') ?? columns[0];
    if (!notStartedCol) return;

    try {
      const tags = newTask.tags
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

      await createTaskMutation({
        title: newTask.title.trim(),
        columnId: notStartedCol._id as any,
        priority: newTask.priority,
        description: newTask.description || undefined,
        dueDate: newTask.dueDate || undefined,
        tags: tags.length > 0 ? tags : undefined,
      });

      setNewTask({ title: '', priority: 'medium', dueDate: '', description: '', tags: '' });
      setShowAddForm(false);
    } catch (err) {
      console.error('Failed to add task:', err);
    }
  }

  function handleTaskDeleted() {
    setDetailTaskId(null);
  }

  const activeTask = activeTaskId
    ? tasks.find((t) => t._id === activeTaskId) ?? null
    : null;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        Loading board...
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-2.5 border-b transition-colors duration-200">
        <h1 className="text-sm font-semibold text-foreground">Tasks</h1>
        <span className="text-xs text-muted-foreground tabular-nums">{totalTasks}</span>

        <div className="ml-4 flex items-center gap-2 flex-1">
          <div className="relative max-w-[240px] flex-1">
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <input
              type="text"
              placeholder="Search tasks..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 text-xs rounded-md border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-accent-blue/40"
            />
          </div>
        </div>

        {/* Filter tab */}
        <div className="flex items-center gap-1">
          <span className="px-2.5 py-1 text-xs font-medium bg-foreground text-background rounded-md">
            All ({totalTasks})
          </span>
        </div>

        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="ml-2 px-3 py-1.5 text-xs font-medium bg-foreground text-background rounded-md hover:opacity-90 transition-opacity duration-150"
        >
          + Add
        </button>
      </div>

      {/* Add Task Form */}
      {showAddForm && (
        <form onSubmit={handleAddTask} className="px-5 py-3 border-b bg-muted/30 transition-colors duration-200">
          <div className="flex items-end gap-3 max-w-2xl">
            <div className="flex-1">
              <label className="block text-[11px] text-muted-foreground mb-1">Title *</label>
              <input
                type="text"
                value={newTask.title}
                onChange={(e) => setNewTask((p) => ({ ...p, title: e.target.value }))}
                placeholder="Task title"
                autoFocus
                className="w-full px-2.5 py-1.5 text-sm rounded-md border bg-card text-foreground focus:outline-none focus:ring-1 focus:ring-accent-blue/40"
              />
            </div>
            <div className="w-24">
              <label className="block text-[11px] text-muted-foreground mb-1">Priority</label>
              <select
                value={newTask.priority}
                onChange={(e) => setNewTask((p) => ({ ...p, priority: e.target.value as any }))}
                className="w-full px-2 py-1.5 text-sm rounded-md border bg-card text-foreground focus:outline-none focus:ring-1 focus:ring-accent-blue/40"
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </div>
            <div className="w-36">
              <label className="block text-[11px] text-muted-foreground mb-1">Due date</label>
              <input
                type="date"
                value={newTask.dueDate}
                onChange={(e) => setNewTask((p) => ({ ...p, dueDate: e.target.value }))}
                className="w-full px-2 py-1.5 text-sm rounded-md border bg-card text-foreground focus:outline-none focus:ring-1 focus:ring-accent-blue/40"
              />
            </div>
            <div className="flex gap-1.5 shrink-0">
              <button
                type="submit"
                disabled={!newTask.title.trim()}
                className="px-3 py-1.5 text-xs font-medium bg-accent-blue text-white rounded-md hover:opacity-90 transition-opacity duration-150 disabled:opacity-40"
              >
                Add Task
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowAddForm(false);
                  setNewTask({ title: '', priority: 'medium', dueDate: '', description: '', tags: '' });
                }}
                className="px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors duration-150"
              >
                Cancel
              </button>
            </div>
          </div>
          <div className="flex items-end gap-3 max-w-2xl mt-2">
            <div className="flex-1">
              <label className="block text-[11px] text-muted-foreground mb-1">Description</label>
              <input
                type="text"
                value={newTask.description}
                onChange={(e) => setNewTask((p) => ({ ...p, description: e.target.value }))}
                placeholder="Optional description"
                className="w-full px-2.5 py-1.5 text-sm rounded-md border bg-card text-foreground focus:outline-none focus:ring-1 focus:ring-accent-blue/40"
              />
            </div>
            <div className="flex-1">
              <label className="block text-[11px] text-muted-foreground mb-1">Tags</label>
              <input
                type="text"
                value={newTask.tags}
                onChange={(e) => setNewTask((p) => ({ ...p, tags: e.target.value }))}
                placeholder="design, frontend (comma-separated)"
                className="w-full px-2.5 py-1.5 text-sm rounded-md border bg-card text-foreground focus:outline-none focus:ring-1 focus:ring-accent-blue/40"
              />
            </div>
          </div>
        </form>
      )}

      {/* Board */}
      <div className="flex-1 overflow-x-auto overflow-y-hidden">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
        >
          <div className="flex gap-3 p-5 h-full min-w-max">
            {columns.map((col) => (
              <Column
                key={col._id}
                column={col}
                tasks={getTasksForColumn(col._id)}
                onOpenDetail={setDetailTaskId}
              />
            ))}
          </div>

          <DragOverlay dropAnimation={dropAnimationConfig}>
            {activeTask ? (
              <TaskCard
                task={activeTask}
                onOpenDetail={() => {}}
                isOverlay
              />
            ) : null}
          </DragOverlay>
        </DndContext>
      </div>

      {detailTaskId && (
        <TaskDetail
          taskId={detailTaskId}
          columns={columns}
          task={tasks.find((t) => t._id === detailTaskId)!}
          onClose={() => setDetailTaskId(null)}
          onDeleted={handleTaskDeleted}
        />
      )}
    </div>
  );
}
