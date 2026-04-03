'use client';

import { useState } from 'react';
import { Id } from '../../../convex/_generated/dataModel';

export interface EmailAction {
  _id: Id<'emailActions'>;
  emailItemId: Id<'emailItems'>;
  actionType: string;
  description?: string;
  createdAt: number;
}

interface ActionLogProps {
  actions: EmailAction[];
}

const ACTION_TYPE_BADGES: Record<string, { label: string; className: string }> = {
  sent: { label: 'Sent', className: 'bg-accent-blue/10 text-accent-blue' },
  triaged: { label: 'Triaged', className: 'bg-accent-green/10 text-accent-green' },
  archive: { label: 'Archived', className: 'bg-muted text-muted-foreground' },
  flag: { label: 'Flagged', className: 'bg-accent-red/10 text-accent-red' },
  dismiss: { label: 'Dismissed', className: 'bg-muted text-muted-foreground' },
};

function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function ActionLog({ actions }: ActionLogProps) {
  const [expanded, setExpanded] = useState(false);
  const [filter, setFilter] = useState<string | null>(null);

  const actionTypes = Array.from(new Set(actions.map((a) => a.actionType)));
  const filtered = filter ? actions.filter((a) => a.actionType === filter) : actions;

  return (
    <div className="bg-muted rounded-xl border border-border overflow-hidden transition-colors duration-200">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-4 text-left hover:bg-muted/80 transition-colors duration-150"
      >
        <span className="font-semibold text-foreground">Action Log</span>
        <svg
          className={`w-4 h-4 text-muted-foreground transition-transform duration-150 ${expanded ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {expanded && (
        <div className="px-4 pb-4">
          {/* Filter buttons */}
          <div className="flex items-center gap-2 mb-3">
            <button
              onClick={() => setFilter(null)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors duration-150 ${
                filter === null ? 'bg-foreground text-background' : 'bg-card text-muted-foreground hover:bg-muted/80'
              }`}
            >
              All
            </button>
            {actionTypes.map((type) => {
              const badge = ACTION_TYPE_BADGES[type];
              return (
                <button
                  key={type}
                  onClick={() => setFilter(type)}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition-colors duration-150 ${
                    filter === type ? 'bg-foreground text-background' : 'bg-card text-muted-foreground hover:bg-muted/80'
                  }`}
                >
                  {badge?.label ?? type}
                </button>
              );
            })}
          </div>

          {/* Action list */}
          {filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground py-2">No actions to show.</p>
          ) : (
            <div className="space-y-2">
              {filtered.map((action) => {
                const badge = ACTION_TYPE_BADGES[action.actionType] ?? {
                  label: action.actionType,
                  className: 'bg-muted text-muted-foreground',
                };
                return (
                  <div
                    key={action._id}
                    className="flex items-start gap-3 bg-card rounded-lg p-3 border border-border transition-colors duration-200"
                  >
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium shrink-0 ${badge.className}`}>
                      {badge.label}
                    </span>
                    <p className="text-sm text-foreground flex-1">{action.description}</p>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {formatTimestamp(action.createdAt)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
