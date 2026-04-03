'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
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
  id: string;
  name: string;
  position: number;
  created_at: string;
}

interface TaskData {
  id: string;
  column_id: string;
  title: string;
  description: string;
  priority: 'low' | 'medium' | 'high';
  due_date: string | null;
  tags: string;
  position: number;
  created_at: string;
  updated_at: string;
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
  const [columns, setColumns] = useState<ColumnData[]>([]);
  const [tasks, setTasks] = useState<TaskData[]>([]);
  const [activeTaskId, setActiveTaskId] = useState<UniqueIdentifier | null>(null);
  const [detailTaskId, setDetailTaskId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Track the latest tasks in a ref so drag handlers always see current state
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const fetchData = useCallback(async () => {
    try {
      const [colRes, taskRes] = await Promise.all([
        fetch('/api/columns'),
        fetch('/api/tasks'),
      ]);
      const colData = await colRes.json();
      const taskData = await taskRes.json();
      setColumns(colData.columns ?? []);
      setTasks(taskData.tasks ?? []);
    } catch (err) {
      console.error('Failed to fetch board data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  function getTasksForColumn(columnId: string) {
    return tasks
      .filter((t) => t.column_id === columnId)
      .sort((a, b) => a.position - b.position);
  }

  function findColumnOfTask(taskId: UniqueIdentifier): string | undefined {
    return tasksRef.current.find((t) => t.id === taskId)?.column_id;
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
    // overId could be a column id or a task id
    const overCol =
      columns.find((c) => c.id === overId)?.id ?? findColumnOfTask(overId);

    if (!activeCol || !overCol || activeCol === overCol) return;

    // Move the task to the new column optimistically
    setTasks((prev) => {
      const updated = prev.map((t) =>
        t.id === activeId ? { ...t, column_id: overCol } : t
      );
      return updated;
    });
  }

  async function handleDragEnd(event: DragEndEvent) {
    setActiveTaskId(null);

    const { active, over } = event;
    if (!over) return;

    const activeId = active.id as string;
    const overId = over.id as string;

    const activeCol = findColumnOfTask(activeId);
    const overCol =
      columns.find((c) => c.id === overId)?.id ?? findColumnOfTask(overId);

    if (!activeCol || !overCol) return;

    const newTasks = [...tasksRef.current];
    const colTasks = newTasks
      .filter((t) => t.column_id === overCol)
      .sort((a, b) => a.position - b.position);

    const activeIndex = colTasks.findIndex((t) => t.id === activeId);
    const overIndex = colTasks.findIndex((t) => t.id === overId);

    if (activeIndex !== -1 && overIndex !== -1 && activeIndex !== overIndex) {
      const reordered = arrayMove(colTasks, activeIndex, overIndex);
      // Reassign positions
      reordered.forEach((t, i) => {
        const idx = newTasks.findIndex((nt) => nt.id === t.id);
        if (idx !== -1) newTasks[idx] = { ...newTasks[idx], position: i };
      });
    }

    // Calculate final position for the moved task
    const finalColTasks = newTasks
      .filter((t) => t.column_id === overCol)
      .sort((a, b) => a.position - b.position);
    const finalTask = finalColTasks.find((t) => t.id === activeId);
    const newPosition = finalTask?.position ?? finalColTasks.length;

    setTasks(newTasks);

    try {
      await fetch(`/api/tasks/${activeId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ column_id: overCol, position: newPosition }),
      });
    } catch (err) {
      console.error('Failed to persist drag:', err);
      fetchData();
    }
  }

  async function handleAddColumn() {
    const name = prompt('New column name:');
    if (!name?.trim()) return;

    try {
      const res = await fetch('/api/columns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      });
      if (res.ok) {
        const col = await res.json();
        setColumns((prev) => [...prev, col]);
      }
    } catch (err) {
      console.error('Failed to add column:', err);
    }
  }

  async function handleAddTask(columnId: string, title: string) {
    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, column_id: columnId }),
      });
      if (res.ok) {
        const task = await res.json();
        setTasks((prev) => [...prev, task]);
      }
    } catch (err) {
      console.error('Failed to add task:', err);
    }
  }

  async function handleUpdateColumn(id: string, name: string) {
    try {
      await fetch(`/api/columns/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      setColumns((prev) =>
        prev.map((c) => (c.id === id ? { ...c, name } : c))
      );
    } catch (err) {
      console.error('Failed to update column:', err);
    }
  }

  async function handleDeleteColumn(id: string) {
    const colTasks = tasks.filter((t) => t.column_id === id);
    if (colTasks.length > 0) {
      const ok = confirm(
        `This column has ${colTasks.length} task(s). Delete them all?`
      );
      if (!ok) return;
    }

    try {
      await fetch(`/api/columns/${id}`, { method: 'DELETE' });
      setColumns((prev) => prev.filter((c) => c.id !== id));
      setTasks((prev) => prev.filter((t) => t.column_id !== id));
    } catch (err) {
      console.error('Failed to delete column:', err);
    }
  }

  function handleTaskUpdated(updated: TaskData) {
    setTasks((prev) =>
      prev.map((t) => (t.id === updated.id ? updated : t))
    );
  }

  function handleTaskDeleted(id: string) {
    setTasks((prev) => prev.filter((t) => t.id !== id));
    setDetailTaskId(null);
  }

  const activeTask = activeTaskId
    ? tasks.find((t) => t.id === activeTaskId) ?? null
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
                key={col.id}
                column={col}
                tasks={getTasksForColumn(col.id)}
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
          task={tasks.find((t) => t.id === detailTaskId)!}
          onClose={() => setDetailTaskId(null)}
          onUpdated={handleTaskUpdated}
          onDeleted={handleTaskDeleted}
        />
      )}
    </div>
  );
}
