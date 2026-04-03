'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

interface TaskData {
  _id: string;
  columnId: string;
  title: string;
  description: string;
  priority: 'low' | 'medium' | 'high';
  dueDate?: string;
  tags: string[];
  position: number;
  createdAt: number;
  updatedAt: number;
}

interface TaskCardProps {
  task: TaskData;
  onOpenDetail: (taskId: string) => void;
  isOverlay?: boolean;
}

const priorityColors: Record<string, string> = {
  high: 'bg-accent-red/15 text-accent-red',
  medium: 'bg-accent-orange/15 text-accent-orange',
  low: 'bg-accent-green/15 text-accent-green',
};

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function TaskCard({
  task,
  onOpenDetail,
  isOverlay,
}: TaskCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task._id });

  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition: transition ?? undefined,
    opacity: isDragging ? 0 : 1,
  };

  return (
    <div
      ref={isOverlay ? undefined : setNodeRef}
      style={isOverlay ? undefined : style}
      {...(isOverlay ? {} : attributes)}
      {...(isOverlay ? {} : listeners)}
      onClick={() => onOpenDetail(task._id)}
      className={`bg-card rounded-lg border p-3 cursor-pointer transition-all duration-200 hover:shadow-md ${
        isOverlay
          ? 'shadow-xl scale-[1.02] rotate-[2deg]'
          : isDragging
            ? 'ring-2 ring-accent-blue/30 border-dashed'
            : ''
      }`}
    >
      <p className="text-sm font-medium leading-snug">{task.title}</p>

      <div className="flex items-center gap-1.5 mt-2 flex-wrap">
        <span
          className={`text-[11px] font-medium px-1.5 py-0.5 rounded-full ${
            priorityColors[task.priority] ?? priorityColors.medium
          }`}
        >
          {task.priority}
        </span>

        {task.dueDate && (
          <span className="text-[11px] text-muted-foreground">
            {formatDate(task.dueDate)}
          </span>
        )}
      </div>

      {task.tags.length > 0 && (
        <div className="flex gap-1 mt-2 flex-wrap">
          {task.tags.map((tag) => (
            <span
              key={tag}
              className="text-[11px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded"
            >
              {tag}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
