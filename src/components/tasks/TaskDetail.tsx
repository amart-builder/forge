'use client';

import { useEffect, useRef, useState } from 'react';

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

interface TaskDetailProps {
  taskId: string;
  task: TaskData;
  columns: ColumnData[];
  onClose: () => void;
  onUpdated: (task: TaskData) => void;
  onDeleted: (id: string) => void;
}

function parseTags(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function TaskDetail({
  taskId,
  task,
  columns,
  onClose,
  onUpdated,
  onDeleted,
}: TaskDetailProps) {
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? '');
  const [priority, setPriority] = useState(task.priority);
  const [dueDate, setDueDate] = useState(task.due_date ?? '');
  const [tagsStr, setTagsStr] = useState(parseTags(task.tags).join(', '));
  const [columnId, setColumnId] = useState(task.column_id);
  const [saving, setSaving] = useState(false);

  const backdropRef = useRef<HTMLDivElement>(null);

  // Sync state when task prop changes
  useEffect(() => {
    setTitle(task.title);
    setDescription(task.description ?? '');
    setPriority(task.priority);
    setDueDate(task.due_date ?? '');
    setTagsStr(parseTags(task.tags).join(', '));
    setColumnId(task.column_id);
  }, [task]);

  function handleBackdropClick(e: React.MouseEvent) {
    if (e.target === backdropRef.current) {
      onClose();
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      const tags = tagsStr
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

      const res = await fetch(`/api/tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          description,
          priority,
          due_date: dueDate || null,
          tags,
          column_id: columnId,
        }),
      });

      if (res.ok) {
        const updated = await res.json();
        onUpdated(updated);
        onClose();
      }
    } catch (err) {
      console.error('Failed to save task:', err);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!confirm('Delete this task? This cannot be undone.')) return;

    try {
      const res = await fetch(`/api/tasks/${taskId}`, { method: 'DELETE' });
      if (res.ok) {
        onDeleted(taskId);
      }
    } catch (err) {
      console.error('Failed to delete task:', err);
    }
  }

  return (
    <div
      ref={backdropRef}
      onClick={handleBackdropClick}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 dark:bg-black/50 backdrop-blur-sm"
    >
      <div className="bg-card rounded-xl shadow-xl w-full max-w-lg mx-4 p-6 max-h-[90vh] overflow-y-auto transition-colors duration-200">
        {/* Header */}
        <div className="flex items-start justify-between mb-5">
          <h2 className="text-base font-semibold">Edit Task</h2>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground text-lg leading-none"
          >
            &times;
          </button>
        </div>

        <div className="space-y-4">
          {/* Title */}
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              Title
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-3 py-2 text-sm border rounded-lg outline-none focus:ring-1 focus:ring-accent-blue bg-background text-foreground"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              Description / Notes
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              className="w-full px-3 py-2 text-sm border rounded-lg outline-none focus:ring-1 focus:ring-accent-blue resize-y bg-background text-foreground"
            />
          </div>

          {/* Priority & Column */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Priority
              </label>
              <select
                value={priority}
                onChange={(e) =>
                  setPriority(e.target.value as 'low' | 'medium' | 'high')
                }
                className="w-full px-3 py-2 text-sm border rounded-lg outline-none focus:ring-1 focus:ring-accent-blue bg-background text-foreground"
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Status
              </label>
              <select
                value={columnId}
                onChange={(e) => setColumnId(e.target.value)}
                className="w-full px-3 py-2 text-sm border rounded-lg outline-none focus:ring-1 focus:ring-accent-blue bg-background text-foreground"
              >
                {columns.map((col) => (
                  <option key={col.id} value={col.id}>
                    {col.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Due Date */}
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              Due Date
            </label>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="w-full px-3 py-2 text-sm border rounded-lg outline-none focus:ring-1 focus:ring-accent-blue bg-background text-foreground"
            />
          </div>

          {/* Tags */}
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              Tags (comma-separated)
            </label>
            <input
              type="text"
              value={tagsStr}
              onChange={(e) => setTagsStr(e.target.value)}
              placeholder="design, frontend, urgent"
              className="w-full px-3 py-2 text-sm border rounded-lg outline-none focus:ring-1 focus:ring-accent-blue bg-background text-foreground"
            />
          </div>

          {/* Timestamps */}
          <div className="flex gap-4 text-[11px] text-muted-foreground pt-1">
            <span>Created: {formatTimestamp(task.created_at)}</span>
            <span>Updated: {formatTimestamp(task.updated_at)}</span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between mt-6 pt-4 border-t">
          <button
            onClick={handleDelete}
            className="text-sm text-accent-red hover:underline"
          >
            Delete task
          </button>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors duration-150"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !title.trim()}
              className="px-4 py-2 text-sm font-medium bg-accent-blue text-white rounded-lg hover:opacity-90 transition-opacity duration-150 disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
