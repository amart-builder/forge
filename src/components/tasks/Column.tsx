'use client';

import { useState } from 'react';
import {
  SortableContext,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { useDroppable } from '@dnd-kit/core';
import TaskCard from './TaskCard';

interface ColumnData {
  id: string;
  name: string;
  position: number;
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

interface ColumnProps {
  column: ColumnData;
  tasks: TaskData[];
  onAddTask: (columnId: string, title: string) => void;
  onOpenDetail: (taskId: string) => void;
  onUpdateColumn: (id: string, name: string) => void;
  onDeleteColumn: (id: string) => void;
}

export default function Column({
  column,
  tasks,
  onAddTask,
  onOpenDetail,
  onUpdateColumn,
  onDeleteColumn,
}: ColumnProps) {
  const [isAdding, setIsAdding] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(column.name);

  const { setNodeRef } = useDroppable({ id: column.id });

  function handleAddSubmit() {
    const trimmed = newTitle.trim();
    if (trimmed) {
      onAddTask(column.id, trimmed);
    }
    setNewTitle('');
    setIsAdding(false);
  }

  function handleAddKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddSubmit();
    } else if (e.key === 'Escape') {
      setNewTitle('');
      setIsAdding(false);
    }
  }

  function handleNameSubmit() {
    const trimmed = editName.trim();
    if (trimmed && trimmed !== column.name) {
      onUpdateColumn(column.id, trimmed);
    } else {
      setEditName(column.name);
    }
    setIsEditing(false);
  }

  function handleNameKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleNameSubmit();
    } else if (e.key === 'Escape') {
      setEditName(column.name);
      setIsEditing(false);
    }
  }

  return (
    <div className="flex flex-col w-72 shrink-0 bg-muted/50 rounded-xl border">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 bg-muted rounded-t-xl border-b">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {isEditing ? (
            <input
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onBlur={handleNameSubmit}
              onKeyDown={handleNameKeyDown}
              autoFocus
              className="text-sm font-semibold bg-white px-1.5 py-0.5 rounded border outline-none focus:ring-1 focus:ring-accent-blue w-full"
            />
          ) : (
            <span
              className="text-sm font-semibold truncate cursor-pointer"
              onDoubleClick={() => {
                setEditName(column.name);
                setIsEditing(true);
              }}
              title="Double-click to rename"
            >
              {column.name}
            </span>
          )}
          <span className="text-xs text-muted-foreground tabular-nums">
            {tasks.length}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setIsAdding(true)}
            className="w-6 h-6 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-white rounded transition-colors duration-150"
            title="Add task"
          >
            +
          </button>
          <button
            onClick={() => onDeleteColumn(column.id)}
            className="w-6 h-6 flex items-center justify-center text-muted-foreground hover:text-accent-red hover:bg-white rounded transition-colors duration-150"
            title="Delete column"
          >
            &times;
          </button>
        </div>
      </div>

      {/* Task list */}
      <div
        ref={setNodeRef}
        className="flex-1 p-2 space-y-2 overflow-y-auto min-h-[120px]"
      >
        {/* Quick add input */}
        {isAdding && (
          <div className="mb-1">
            <input
              type="text"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onBlur={handleAddSubmit}
              onKeyDown={handleAddKeyDown}
              placeholder="Task title..."
              autoFocus
              className="w-full px-2.5 py-2 text-sm bg-white rounded-lg border outline-none focus:ring-1 focus:ring-accent-blue"
            />
          </div>
        )}

        <SortableContext
          items={tasks.map((t) => t.id)}
          strategy={verticalListSortingStrategy}
        >
          {tasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              onOpenDetail={onOpenDetail}
            />
          ))}
        </SortableContext>

        {tasks.length === 0 && !isAdding && (
          <p className="text-xs text-muted-foreground text-center py-6">
            No tasks yet
          </p>
        )}
      </div>
    </div>
  );
}
