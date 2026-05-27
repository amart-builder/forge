'use client';

import {
  SortableContext,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { useDroppable } from '@dnd-kit/core';
import TaskCard from './TaskCard';

interface ColumnData {
  _id: string;
  name: string;
  position: number;
}

interface TaskData {
  _id: string;
  columnId: string;
  title: string;
  description: string;
  priority: 'low' | 'medium' | 'high';
  dueDate?: string;
  tags: string[];
  status?: 'open' | 'done' | 'archived';
  blocked: boolean;
  position: number;
  createdAt: number;
  updatedAt: number;
}

interface ColumnProps {
  column: ColumnData;
  tasks: TaskData[];
  onOpenDetail: (taskId: string) => void;
  onCompleteTask?: (taskId: string) => void | Promise<void>;
  completingTaskId?: string | null;
}

const COLUMN_ICONS: Record<string, React.ReactNode> = {
  'Must happen today': (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-accent-red">
      <path d="M12 2v4" />
      <path d="M12 18v4" />
      <path d="m4.93 4.93 2.83 2.83" />
      <path d="m16.24 16.24 2.83 2.83" />
      <path d="M2 12h4" />
      <path d="M18 12h4" />
      <path d="m4.93 19.07 2.83-2.83" />
      <path d="m16.24 7.76 2.83-2.83" />
    </svg>
  ),
  'Not Started': (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground">
      <circle cx="12" cy="12" r="10" />
    </svg>
  ),
  'In Flight / Waiting': (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-accent-blue">
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  ),
  'Blocked': (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-accent-orange">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  ),
  'Done': (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-accent-green">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  ),
};

export default function Column({
  column,
  tasks,
  onOpenDetail,
  onCompleteTask,
  completingTaskId,
}: ColumnProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: `column-${column._id}`,
  });
  const icon = COLUMN_ICONS[column.name] ?? COLUMN_ICONS['Not Started'];
  const isDoneColumn = column.name === 'Done';

  return (
    <div
      ref={setNodeRef}
      className={`flex flex-col w-72 shrink-0 rounded-lg border bg-muted/30 transition-colors duration-200 ${
        isOver ? 'ring-2 ring-accent-blue/30 bg-accent-blue/5' : ''
      }`}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b transition-colors duration-200">
        {icon}
        <span className="text-xs font-semibold text-foreground truncate">
          {column.name}
        </span>
        <span className="text-[11px] text-muted-foreground tabular-nums ml-auto">
          {tasks.length}
        </span>
      </div>

      {/* Task list */}
      <div className="flex-1 p-2 space-y-1.5 overflow-y-auto min-h-[120px]">
        <SortableContext
          items={tasks.map((t) => t._id)}
          strategy={verticalListSortingStrategy}
        >
          {tasks.map((task) => (
            <TaskCard
              key={task._id}
              task={task}
              onOpenDetail={onOpenDetail}
              onCompleteTask={onCompleteTask}
              isDone={isDoneColumn}
              isCompleting={completingTaskId === task._id}
            />
          ))}
        </SortableContext>

        {tasks.length === 0 && (
          <p className="text-[11px] text-muted-foreground text-center py-6">
            No tasks
          </p>
        )}
      </div>
    </div>
  );
}
