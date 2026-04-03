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
  const createColumnMutation = useMutation(api.columns.create);
  const updateColumnMutation = useMutation(api.columns.update);
  const removeColumnMutation = useMutation(api.columns.remove);
  const createTaskMutation = useMutation(api.tasks.create);
  const updateTaskMutation = useMutation(api.tasks.update);
  const removeTaskMutation = useMutation(api.tasks.remove);

  // Local state for optimistic DnD updates
  const [localTasks, setLocalTasks] = useState<TaskData[] | null>(null);
  const [activeTaskId, setActiveTaskId] = useState<UniqueIdentifier | null>(null);
  const [detailTaskId, setDetailTaskId] = useState<string | null>(null);
  const [seeded, setSeeded] = useState(false);

  // Seed default columns on mount
  useEffect(() => {
    if (!seeded) {
      seedMutation().then(() => setSeeded(true));
    }
  }, [seeded, seedMutation]);

  // Use local override during drag, otherwise use query data
  const columns = (columnsQuery ?? []) as ColumnData[];
  const tasks = (localTasks ?? tasksQuery ?? []) as TaskData[];

  // Keep a ref to current tasks for drag handlers
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;

  // Clear local override when query data updates (drag completed)
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

  function getTasksForColumn(columnId: string) {
    return tasks
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

    // Move the task to the new column optimistically
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

  async function handleAddColumn() {
    const name = prompt('New column name:');
    if (!name?.trim()) return;

    try {
      await createColumnMutation({ name: name.trim() });
    } catch (err) {
      console.error('Failed to add column:', err);
    }
  }

  async function handleAddTask(columnId: string, title: string) {
    try {
      await createTaskMutation({ title, columnId: columnId as any });
    } catch (err) {
      console.error('Failed to add task:', err);
    }
  }

  async function handleUpdateColumn(id: string, name: string) {
    try {
      await updateColumnMutation({ id: id as any, name });
    } catch (err) {
      console.error('Failed to update column:', err);
    }
  }

  async function handleDeleteColumn(id: string) {
    const colTasks = tasks.filter((t) => t.columnId === id);
    if (colTasks.length > 0) {
      const ok = confirm(
        `This column has ${colTasks.length} task(s). Delete them all?`
      );
      if (!ok) return;
    }

    try {
      await removeColumnMutation({ id: id as any });
    } catch (err) {
      console.error('Failed to delete column:', err);
    }
  }

  function handleTaskDeleted(id: string) {
    setDetailTaskId(null);
  }

  const activeTask = activeTaskId
    ? tasks.find((t) => t._id === activeTaskId) ?? null
    : null;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        Loading board...
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-6 py-3 border-b transition-colors duration-200">
        <h1 className="text-lg font-semibold">Tasks</h1>
        <button
          onClick={handleAddColumn}
          className="px-3 py-1.5 text-sm font-medium bg-foreground text-background rounded-lg hover:opacity-90 transition-opacity duration-150"
        >
          + Add Column
        </button>
      </div>

      <div className="flex-1 overflow-x-auto overflow-y-hidden">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
        >
          <div className="flex gap-4 p-6 h-full min-w-max">
            {columns.map((col) => (
              <Column
                key={col._id}
                column={col}
                tasks={getTasksForColumn(col._id)}
                onAddTask={handleAddTask}
                onOpenDetail={setDetailTaskId}
                onUpdateColumn={handleUpdateColumn}
                onDeleteColumn={handleDeleteColumn}
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
