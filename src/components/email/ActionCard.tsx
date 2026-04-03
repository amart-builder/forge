'use client';

import { useState } from 'react';
import { Id } from '../../../convex/_generated/dataModel';

export interface EmailItem {
  _id: Id<'emailItems'>;
  threadId?: string;
  messageId?: string;
  senderName?: string;
  senderEmail?: string;
  subject?: string;
  summary?: string;
  context?: string;
  recommendedAction: string;
  draftResponse?: string;
  priority: number;
  status: string;
  actionedAt?: number;
  createdAt: number;
}

interface ActionCardProps {
  email: EmailItem;
  onAction: (id: Id<'emailItems'>, action: string) => Promise<void>;
  onSend: (id: Id<'emailItems'>) => Promise<void>;
  onDraftChange: (id: Id<'emailItems'>, draft: string) => void;
}

const ACTION_BADGES: Record<string, { label: string; className: string }> = {
  reply: { label: 'Reply', className: 'bg-accent-blue/10 text-accent-blue' },
  archive: { label: 'Archive', className: 'bg-muted text-muted-foreground' },
  follow_up: { label: 'Follow Up', className: 'bg-accent-orange/10 text-accent-orange' },
  delegate: { label: 'Delegate', className: 'bg-purple-500/10 text-purple-400 dark:text-purple-300' },
  flag: { label: 'Flag', className: 'bg-accent-red/10 text-accent-red' },
  review: { label: 'Review', className: 'bg-muted text-muted-foreground' },
};

const PRIORITY_BORDER: Record<number, string> = {
  1: 'border-l-accent-red border-l-[3px]',
  2: 'border-l-accent-yellow border-l-[3px]',
  3: 'border-l-muted-foreground/30 border-l-[3px]',
};

function hashColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const colors = [
    'bg-accent-blue', 'bg-accent-green', 'bg-accent-red',
    'bg-accent-orange', 'bg-purple-500', 'bg-pink-500',
  ];
  return colors[Math.abs(hash) % colors.length];
}

function initials(name: string): string {
  return name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

export default function ActionCard({ email, onAction, onSend, onDraftChange }: ActionCardProps) {
  const [draftExpanded, setDraftExpanded] = useState(false);
  const [localDraft, setLocalDraft] = useState(email.draftResponse ?? '');
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  const badge = ACTION_BADGES[email.recommendedAction] ?? ACTION_BADGES.review;
  const borderClass = PRIORITY_BORDER[email.priority] ?? PRIORITY_BORDER[3];
  const hasDraft = email.recommendedAction === 'reply' || email.recommendedAction === 'follow_up';
  const senderName = email.senderName ?? 'Unknown';
  const senderEmail = email.senderEmail ?? '';

  async function handleAction(action: string) {
    setLoading(true);
    await onAction(email._id, action);
    setDone(true);
    setLoading(false);
  }

  async function handleSend() {
    setLoading(true);
    onDraftChange(email._id, localDraft);
    await onSend(email._id);
    setDone(true);
    setLoading(false);
  }

  if (done) {
    return (
      <div className={`bg-card rounded-xl border border-border overflow-hidden ${borderClass} opacity-60 transition-all duration-300`}>
        <div className="p-5 flex items-center justify-center text-muted-foreground text-sm">
          Done
        </div>
      </div>
    );
  }

  return (
    <div className={`bg-card rounded-xl border border-border overflow-hidden ${borderClass} transition-all duration-200`}>
      <div className="p-5">
        {/* Header row */}
        <div className="flex items-start gap-3 mb-3">
          <div className={`w-9 h-9 rounded-full ${hashColor(senderName)} flex items-center justify-center text-white text-xs font-semibold shrink-0`}>
            {initials(senderName)}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <span className="font-semibold text-foreground truncate">{senderName}</span>
              <span className="text-xs text-muted-foreground truncate">{senderEmail}</span>
            </div>
            <p className="font-semibold text-foreground">{email.subject}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${badge.className}`}>
              {badge.label}
            </span>
            <span className="text-xs text-muted-foreground">{formatTime(email.createdAt)}</span>
          </div>
        </div>

        {/* Summary */}
        <p className="text-muted-foreground text-sm mb-2 line-clamp-2">{email.summary}</p>

        {/* Context */}
        {email.context && (
          <p className="text-xs text-muted-foreground italic mb-3">{email.context}</p>
        )}

        {/* Draft area for reply/follow_up */}
        {hasDraft && email.draftResponse && (
          <div className="mt-3">
            <button
              onClick={() => setDraftExpanded(!draftExpanded)}
              className="text-xs text-accent-blue font-medium hover:underline mb-2"
            >
              {draftExpanded ? 'Hide draft' : 'Show draft response'}
            </button>
            {draftExpanded && (
              <div className="mt-2">
                <textarea
                  value={localDraft}
                  onChange={(e) => setLocalDraft(e.target.value)}
                  className="w-full border border-border rounded-lg p-3 text-sm bg-muted/50 resize-none focus:outline-none focus:ring-1 focus:ring-accent-blue text-foreground"
                  rows={5}
                />
                <div className="flex items-center gap-2 mt-2">
                  <button
                    onClick={handleSend}
                    disabled={loading}
                    className="px-4 py-1.5 bg-accent-blue text-white text-sm font-medium rounded-lg hover:bg-accent-blue/90 transition-colors duration-150 disabled:opacity-50"
                  >
                    Send
                  </button>
                  <button
                    onClick={() => handleAction('dismissed')}
                    disabled={loading}
                    className="px-4 py-1.5 bg-muted text-muted-foreground text-sm font-medium rounded-lg hover:bg-muted/80 transition-colors duration-150 disabled:opacity-50"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Action buttons for non-draft actions */}
        {!hasDraft && (
          <div className="flex items-center gap-2 mt-3">
            <button
              onClick={() => handleAction('actioned')}
              disabled={loading}
              className="px-4 py-1.5 bg-accent-blue text-white text-sm font-medium rounded-lg hover:bg-accent-blue/90 transition-colors duration-150 disabled:opacity-50"
            >
              {email.recommendedAction === 'archive' ? 'Archive' :
               email.recommendedAction === 'flag' ? 'Flag' :
               email.recommendedAction === 'delegate' ? 'Delegate' : 'Done'}
            </button>
            <button
              onClick={() => handleAction('dismissed')}
              disabled={loading}
              className="px-4 py-1.5 bg-muted text-muted-foreground text-sm font-medium rounded-lg hover:bg-muted/80 transition-colors duration-150 disabled:opacity-50"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Draft-having items without a draft yet still get action buttons */}
        {hasDraft && !email.draftResponse && (
          <div className="flex items-center gap-2 mt-3">
            <button
              onClick={() => handleAction('actioned')}
              disabled={loading}
              className="px-4 py-1.5 bg-accent-blue text-white text-sm font-medium rounded-lg hover:bg-accent-blue/90 transition-colors duration-150 disabled:opacity-50"
            >
              {email.recommendedAction === 'reply' ? 'Reply' : 'Follow Up'}
            </button>
            <button
              onClick={() => handleAction('dismissed')}
              disabled={loading}
              className="px-4 py-1.5 bg-muted text-muted-foreground text-sm font-medium rounded-lg hover:bg-muted/80 transition-colors duration-150 disabled:opacity-50"
            >
              Dismiss
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
