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
  status?: 'open' | 'done' | 'archived';
  blocked: boolean;
  position: number;
  createdAt: number;
  updatedAt: number;
}

interface TaskCardProps {
  task: TaskData;
  onOpenDetail: (taskId: string) => void;
  onCompleteTask?: (taskId: string) => void | Promise<void>;
  isDone?: boolean;
  isOverlay?: boolean;
  isCompleting?: boolean;
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

function visibleTags(tags: string[]): string[] {
  return tags.filter((tag) => tag.trim().toLowerCase() !== 'blocked');
}

export default function TaskCard({
  task,
  onOpenDetail,
  onCompleteTask,
  isDone = false,
  isOverlay,
  isCompleting = false,
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
    touchAction: 'none',
  };
  const displayTags = visibleTags(task.tags);
  const showCompleteButton = !isOverlay && !isDone && Boolean(onCompleteTask);

  function handleCompletePointerDown(e: React.PointerEvent<HTMLButtonElement>) {
    e.stopPropagation();
  }

  function handleCompleteClick(e: React.MouseEvent<HTMLButtonElement>) {
    e.preventDefault();
    e.stopPropagation();
    if (!onCompleteTask || isCompleting) return;
    void onCompleteTask(task._id);
  }

  return (
    <div
      ref={isOverlay ? undefined : setNodeRef}
      style={isOverlay ? undefined : style}
      {...(isOverlay ? {} : attributes)}
      {...(isOverlay ? {} : listeners)}
      role={isOverlay ? undefined : 'group'}
      aria-label={isOverlay ? undefined : `Task: ${task.title}`}
      onClick={() => onOpenDetail(task._id)}
      className={`relative bg-card rounded-md border p-2.5 transition-all duration-150 hover:border-muted-foreground/30 ${
        isOverlay ? '' : 'cursor-grab active:cursor-grabbing'
      } ${
        showCompleteButton ? 'pr-8' : ''
      } ${
        isOverlay
          ? 'shadow-lg scale-[1.02] rotate-[2deg]'
          : isDragging
            ? 'ring-1 ring-accent-blue/30 border-dashed'
            : ''
      }`}
    >
      {showCompleteButton && (
        <button
          type="button"
          aria-label={`Mark "${task.title}" done`}
          title="Mark done"
          disabled={isCompleting}
          onPointerDown={handleCompletePointerDown}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={handleCompleteClick}
          className="absolute right-2 top-2 flex h-5 w-5 cursor-pointer items-center justify-center rounded-full border border-muted-foreground/30 bg-background/95 text-muted-foreground shadow-sm transition-colors duration-150 hover:border-accent-green hover:bg-accent-green/10 hover:text-accent-green focus:outline-none focus:ring-2 focus:ring-accent-green/30 disabled:cursor-wait disabled:opacity-60"
        >
          <svg
            aria-hidden="true"
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </button>
      )}

      {/* Tags row */}
      {(task.blocked || displayTags.length > 0) && (
        <div className="flex gap-1 mb-1.5 flex-wrap">
          {task.blocked && (
            <span className="text-[10px] font-medium text-accent-orange bg-accent-orange/10 px-1.5 py-0.5 rounded">
              Blocked
            </span>
          )}
          {displayTags.slice(0, 2).map((tag) => (
            <span
              key={tag}
              className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded"
            >
              {tag}
            </span>
          ))}
          {displayTags.length > 2 && (
            <span className="text-[10px] text-muted-foreground">+{displayTags.length - 2}</span>
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
