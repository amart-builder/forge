'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation } from 'convex/react';
import { api } from '../../../convex/_generated/api';

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
  position: number;
  createdAt: number;
  updatedAt: number;
}

interface TaskDetailProps {
  taskId: string;
  task: TaskData;
  columns: ColumnData[];
  onClose: () => void;
  onDeleted: (id: string) => void;
}

function formatTimestamp(epoch: number): string {
  return new Date(epoch).toLocaleString('en-US', {
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
  onDeleted,
}: TaskDetailProps) {
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? '');
  const [priority, setPriority] = useState(task.priority);
  const [dueDate, setDueDate] = useState(task.dueDate ?? '');
  const [tagsStr, setTagsStr] = useState(task.tags.join(', '));
  const [columnId, setColumnId] = useState(task.columnId);
  const [saving, setSaving] = useState(false);

  const updateTask = useMutation(api.tasks.update);
  const removeTask = useMutation(api.tasks.remove);

  const backdropRef = useRef<HTMLDivElement>(null);
  const mouseDownTargetRef = useRef<EventTarget | null>(null);

  useEffect(() => {
    setTitle(task.title);
    setDescription(task.description ?? '');
    setPriority(task.priority);
    setDueDate(task.dueDate ?? '');
    setTagsStr(task.tags.join(', '));
    setColumnId(task.columnId);
  }, [task]);

  // Only close if BOTH mousedown and mouseup (click) happened on the backdrop.
  // This prevents accidental close when drag-selecting text inside the modal
  // and releasing the mouse outside the modal boundary.
  function handleBackdropMouseDown(e: React.MouseEvent) {
    mouseDownTargetRef.current = e.target;
  }

  function handleBackdropClick(e: React.MouseEvent) {
    if (
      e.target === backdropRef.current &&
      mouseDownTargetRef.current === backdropRef.current
    ) {
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

      await updateTask({
        id: taskId as any,
        title,
        description,
        priority,
        dueDate: dueDate || null,
        tags,
        columnId: columnId as any,
      });

      onClose();
    } catch (err) {
      console.error('Failed to save task:', err);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!confirm('Delete this task? This cannot be undone.')) return;

    try {
      await removeTask({ id: taskId as any });
      onDeleted(taskId);
    } catch (err) {
      console.error('Failed to delete task:', err);
    }
  }

  return (
    <div
      ref={backdropRef}
      onMouseDown={handleBackdropMouseDown}
      onClick={handleBackdropClick}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 dark:bg-black/40 backdrop-blur-sm"
    >
      <div className="bg-card rounded-lg border w-full max-w-lg mx-4 p-5 max-h-[90vh] overflow-y-auto transition-colors duration-200">
        <div className="flex items-start justify-between mb-4">
          <h2 className="text-sm font-semibold">Edit Task</h2>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground text-lg leading-none"
          >
            &times;
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-[11px] text-muted-foreground mb-1">Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-2.5 py-2 text-sm border rounded-md outline-none focus:ring-1 focus:ring-accent-blue/40 bg-background text-foreground"
            />
          </div>

          <div>
            <label className="block text-[11px] text-muted-foreground mb-1">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              className="w-full px-2.5 py-2 text-sm border rounded-md outline-none focus:ring-1 focus:ring-accent-blue/40 resize-y bg-background text-foreground"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] text-muted-foreground mb-1">Priority</label>
              <select
                value={priority}
                onChange={(e) =>
                  setPriority(e.target.value as 'low' | 'medium' | 'high')
                }
                className="w-full px-2.5 py-2 text-sm border rounded-md outline-none focus:ring-1 focus:ring-accent-blue/40 bg-background text-foreground"
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] text-muted-foreground mb-1">Status</label>
              <select
                value={columnId}
                onChange={(e) => setColumnId(e.target.value)}
                className="w-full px-2.5 py-2 text-sm border rounded-md outline-none focus:ring-1 focus:ring-accent-blue/40 bg-background text-foreground"
              >
                {columns.map((col) => (
                  <option key={col._id} value={col._id}>
                    {col.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-[11px] text-muted-foreground mb-1">Due Date</label>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="w-full px-2.5 py-2 text-sm border rounded-md outline-none focus:ring-1 focus:ring-accent-blue/40 bg-background text-foreground"
            />
          </div>

          <div>
            <label className="block text-[11px] text-muted-foreground mb-1">Tags (comma-separated)</label>
            <input
              type="text"
              value={tagsStr}
              onChange={(e) => setTagsStr(e.target.value)}
              placeholder="design, frontend, urgent"
              className="w-full px-2.5 py-2 text-sm border rounded-md outline-none focus:ring-1 focus:ring-accent-blue/40 bg-background text-foreground"
            />
          </div>

          <div className="flex gap-4 text-[10px] text-muted-foreground pt-1">
            <span>Created: {formatTimestamp(task.createdAt)}</span>
            <span>Updated: {formatTimestamp(task.updatedAt)}</span>
          </div>
        </div>

        <div className="flex items-center justify-between mt-5 pt-3 border-t">
          <button
            onClick={handleDelete}
            className="text-[11px] text-accent-red hover:underline"
          >
            Delete task
          </button>
          <div className="flex gap-1.5">
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors duration-150"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !title.trim()}
              className="px-3 py-1.5 text-xs font-medium bg-accent-blue text-white rounded-md hover:opacity-90 transition-opacity duration-150 disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
