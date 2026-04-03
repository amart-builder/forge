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
    <div className="bg-muted/30 rounded-lg border overflow-hidden transition-colors duration-200">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-3.5 text-left hover:bg-muted/50 transition-colors duration-150"
      >
        <span className="text-sm font-semibold text-foreground">Action Log</span>
        <svg
          className={`w-3.5 h-3.5 text-muted-foreground transition-transform duration-150 ${expanded ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {expanded && (
        <div className="px-3.5 pb-3.5">
          <div className="flex items-center gap-1.5 mb-2.5">
            <button
              onClick={() => setFilter(null)}
              className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors duration-150 ${
                filter === null ? 'bg-foreground text-background' : 'bg-card text-muted-foreground hover:bg-muted'
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
                  className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors duration-150 ${
                    filter === type ? 'bg-foreground text-background' : 'bg-card text-muted-foreground hover:bg-muted'
                  }`}
                >
                  {badge?.label ?? type}
                </button>
              );
            })}
          </div>

          {filtered.length === 0 ? (
            <p className="text-[11px] text-muted-foreground py-2">No actions to show.</p>
          ) : (
            <div className="space-y-1.5">
              {filtered.map((action) => {
                const badge = ACTION_TYPE_BADGES[action.actionType] ?? {
                  label: action.actionType,
                  className: 'bg-muted text-muted-foreground',
                };
                return (
                  <div
                    key={action._id}
                    className="flex items-start gap-2.5 bg-card rounded-md p-2.5 border transition-colors duration-200"
                  >
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0 ${badge.className}`}>
                      {badge.label}
                    </span>
                    <p className="text-[12px] text-foreground flex-1">{action.description}</p>
                    <span className="text-[10px] text-muted-foreground shrink-0">
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
