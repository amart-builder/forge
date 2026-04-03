'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

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

function parseTags(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

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
  } = useSortable({ id: task.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  const tags = parseTags(task.tags);

  return (
    <div
      ref={isOverlay ? undefined : setNodeRef}
      style={isOverlay ? undefined : style}
      {...(isOverlay ? {} : attributes)}
      {...(isOverlay ? {} : listeners)}
      onClick={() => onOpenDetail(task.id)}
      className={`bg-white rounded-lg border p-3 cursor-pointer transition-shadow duration-150 hover:shadow-md ${
        isOverlay ? 'shadow-lg rotate-2' : ''
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

        {task.due_date && (
          <span className="text-[11px] text-muted-foreground">
            {formatDate(task.due_date)}
          </span>
        )}
      </div>

      {tags.length > 0 && (
        <div className="flex gap-1 mt-2 flex-wrap">
          {tags.map((tag) => (
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
