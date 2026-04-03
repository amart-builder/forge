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
  high: 'bg-accent-red/10 text-accent-red',
  medium: 'bg-accent-orange/10 text-accent-orange',
  low: 'bg-accent-green/10 text-accent-green',
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
      className={`bg-card rounded-md border p-2.5 cursor-pointer transition-all duration-150 hover:border-muted-foreground/30 ${
        isOverlay
          ? 'shadow-lg scale-[1.02] rotate-[2deg]'
          : isDragging
            ? 'ring-1 ring-accent-blue/30 border-dashed'
            : ''
      }`}
    >
      {/* Tags row */}
      {task.tags.length > 0 && (
        <div className="flex gap-1 mb-1.5 flex-wrap">
          {task.tags.slice(0, 2).map((tag) => (
            <span
              key={tag}
              className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded"
            >
              {tag}
            </span>
          ))}
          {task.tags.length > 2 && (
            <span className="text-[10px] text-muted-foreground">+{task.tags.length - 2}</span>
          )}
        </div>
      )}

      <p className="text-[13px] font-medium leading-snug text-foreground">{task.title}</p>

      {task.description && (
        <p className="text-[11px] text-muted-foreground mt-1 line-clamp-2 leading-relaxed">
          {task.description}
        </p>
      )}

      <div className="flex items-center gap-1.5 mt-2 flex-wrap">
        <span
          className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
            priorityColors[task.priority] ?? priorityColors.medium
          }`}
        >
          {task.priority}
        </span>

        {task.dueDate && (
          <span className="text-[10px] text-muted-foreground">
            {formatDate(task.dueDate)}
          </span>
        )}
      </div>
    </div>
  );
}
