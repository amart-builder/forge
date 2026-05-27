'use client';

import { useMemo, useState } from 'react';

export interface EmailItem {
  _id: string;
  accountEmail?: string;
  threadId?: string;
  messageId?: string;
  senderName?: string;
  senderEmail?: string;
  subject?: string;
  summary?: string;
  bodyExcerpt?: string;
  originalBody?: string;
  originalBodySource?: string;
  meetingNotesUrl?: string;
  attioRecordUrl?: string;
  actionTitle?: string;
  actionRequirement?: string;
  context?: string;
  classification?: 'action_item' | 'tiding' | 'log_only';
  recommendedAction: string;
  draftResponse?: string;
  priority: number;
  status: string;
  actionedAt?: number;
  createdAt: number;
  receivedAt?: number;
}

interface ActionCardProps {
  email: EmailItem;
  onAction: (id: string, action: string) => Promise<void>;
  onSendDraft: (email: EmailItem, draft: string) => Promise<void>;
  onCreateTask: (
    email: EmailItem,
    dueDate: string,
    draft: string
  ) => Promise<{ columnName: string }>;
}

const ACTION_BADGES: Record<string, { label: string; className: string }> = {
  reply: { label: 'Reply', className: 'bg-accent-blue/10 text-accent-blue' },
  archive: { label: 'Archive', className: 'bg-muted text-muted-foreground' },
  follow_up: { label: 'Follow Up', className: 'bg-accent-orange/10 text-accent-orange' },
  delegate: { label: 'Delegate', className: 'bg-purple-500/10 text-purple-400 dark:text-purple-300' },
  flag: { label: 'Flag', className: 'bg-accent-red/10 text-accent-red' },
  review: { label: 'Review', className: 'bg-muted text-muted-foreground' },
  meeting_followups: { label: 'Meeting follow-ups', className: 'bg-accent-green/10 text-accent-green' },
};

const CLASSIFICATION_BADGES: Record<string, { label: string; className: string }> = {
  action_item: { label: 'Needs Alex', className: 'bg-accent-red/10 text-accent-red' },
  tiding: { label: 'Update', className: 'bg-accent-orange/10 text-accent-orange' },
  log_only: { label: 'Log', className: 'bg-muted text-muted-foreground' },
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
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function getGmailThreadUrl(threadId?: string): string | null {
  if (!threadId) return null;
  return `https://mail.google.com/mail/u/0/#inbox/${encodeURIComponent(threadId)}`;
}

function getTodayDateInput(): string {
  const now = new Date();
  const localDate = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return localDate.toISOString().slice(0, 10);
}

function cleanText(value?: string): string | undefined {
  const text = value?.trim();
  return text || undefined;
}

function isUsefulBodyExcerpt(email: EmailItem): boolean {
  const excerpt = cleanText(email.bodyExcerpt);
  if (!excerpt) return false;
  if (excerpt === cleanText(email.summary)) return false;
  return true;
}

function getSourceEmail(email: EmailItem): {
  label: string;
  body?: string;
  note?: string;
  url?: string;
} {
  const meetingNotesUrl = cleanText(email.meetingNotesUrl);
  if (isMeetingFollowUps(email) && meetingNotesUrl) {
    return {
      label: 'Meeting notes',
      note: 'Full notes are in Google Drive.',
      url: meetingNotesUrl,
    };
  }

  const original = cleanText(email.originalBody);
  const originalSource = cleanText(email.originalBodySource);
  if (original && originalSource?.includes('fallback')) {
    return {
      label: 'Email preview',
      body: original,
      note: 'Filled from stored preview text.',
    };
  }

  if (original) return { label: 'Original email', body: original };

  if (isUsefulBodyExcerpt(email)) {
    return {
      label: 'Email preview',
      body: cleanText(email.bodyExcerpt),
      note: 'Full body was not stored for this older item.',
    };
  }

  return {
    label: 'Email preview',
    note: 'Full body was not stored for this older item.',
  };
}

function humanizeAction(value: string): string | undefined {
  const action = cleanText(value);
  if (!action) return undefined;
  if (['reply', 'archive', 'follow_up', 'delegate', 'flag', 'review'].includes(action)) return undefined;
  const words = action.replace(/[_-]+/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function getActionTitle(email: EmailItem): string {
  const explicitTitle = cleanText(email.actionTitle);
  if (explicitTitle) return explicitTitle;

  const text = `${email.subject ?? ''} ${email.summary ?? ''} ${email.context ?? ''}`;
  if (/stripe/i.test(text)) {
    return 'Complete Stripe business profile';
  }

  if (isMeetingFollowUps(email)) {
    return 'Review meeting follow-ups';
  }

  if (/password|credential|login|access/i.test(text)) {
    return 'Secure the login credential';
  }

  const customAction = humanizeAction(email.recommendedAction);
  if (customAction) return customAction;

  const actionLabels: Record<string, string> = {
    delegate: 'Delegate this to the right person',
    flag: 'Flag this for follow-up',
    follow_up: 'Follow up outside Forge',
    review: 'Review and complete the offline task',
  };

  return actionLabels[email.recommendedAction] ?? 'Handle this outside email';
}

function cleanContext(context?: string): string | undefined {
  const value = cleanText(context);
  if (!value) return undefined;
  return value
    .replace(/^Full thread read via Composio\.\s*/i, '')
    .replace(/^No reply needed;\s*/i, '')
    .trim();
}

function isMeetingFollowUps(email: EmailItem): boolean {
  return email.recommendedAction === 'meeting_followups';
}

function getForgeRead(
  email: EmailItem,
  hasDraft: boolean,
  isNoReplyAction: boolean,
  isMeetingFollowUpCard: boolean
): string {
  const parts: string[] = [];
  const context = cleanText(email.context);

  if (isMeetingFollowUpCard) {
    parts.push('Forge filed the meeting notes in Attio and found possible follow-ups.');
  } else if (/Full thread read via Composio/i.test(context ?? '') && cleanText(email.originalBody)) {
    parts.push('Forge read the full thread.');
  } else if (/Full thread read via Composio/i.test(context ?? '')) {
    parts.push('Forge triaged this from stored thread context.');
  } else {
    parts.push('Forge triaged this email.');
  }

  if (email.summary) parts.push(email.summary);
  if (hasDraft) parts.push('A reply draft is prepared below.');
  if (isNoReplyAction) parts.push('No email reply is needed.');

  return parts.join(' ');
}

function getActionRequirement(email: EmailItem): string {
  const explicitRequirement = cleanText(email.actionRequirement);
  if (explicitRequirement) return explicitRequirement;

  const text = `${email.subject ?? ''} ${email.summary ?? ''} ${email.context ?? ''}`;
  if (/stripe/i.test(text)) {
    return 'Open Stripe, finish the required business profile steps, and confirm live payments are enabled. Mark this handled once the account is ready to accept payments.';
  }

  if (isMeetingFollowUps(email)) {
    return 'Review the suggested follow-ups, decide which should become Tasks, then tell Codex what to add to the board. No email reply is needed.';
  }

  if (/password|credential|login|access/i.test(text)) {
    return 'Open Gmail, retrieve the credential safely, store it where you manage passwords, and confirm the account works. No Forge reply is needed.';
  }

  const context = cleanContext(email.context);
  if (context) return context;

  return cleanText(email.summary) ?? 'Open the email, complete the required non-email step, then mark the task handled.';
}

export default function ActionCard({ email, onAction, onSendDraft, onCreateTask }: ActionCardProps) {
  const [localDraft, setLocalDraft] = useState(email.draftResponse ?? '');
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);
  const [taskFormOpen, setTaskFormOpen] = useState(false);
  const [taskDueDate, setTaskDueDate] = useState('');
  const [taskLoading, setTaskLoading] = useState(false);
  const [taskAddedLabel, setTaskAddedLabel] = useState<string>();
  const [error, setError] = useState<string>();

  const badge = ACTION_BADGES[email.recommendedAction] ?? ACTION_BADGES.review;
  const classificationBadge = email.classification ? CLASSIFICATION_BADGES[email.classification] : null;
  const borderClass = PRIORITY_BORDER[email.priority] ?? PRIORITY_BORDER[3];
  const hasDraft = Boolean(email.draftResponse);
  const isMeetingFollowUpCard = isMeetingFollowUps(email);
  const isNoReplyAction = !hasDraft && email.classification === 'action_item';
  const senderName = email.senderName ?? 'Unknown';
  const senderEmail = email.senderEmail ?? '';
  const timestamp = email.receivedAt ?? email.createdAt;
  const gmailUrl = useMemo(() => getGmailThreadUrl(email.threadId), [email.threadId]);
  const sourceEmail = getSourceEmail(email);
  const forgeRead = getForgeRead(email, hasDraft, isNoReplyAction, isMeetingFollowUpCard);
  const actionBadge = isMeetingFollowUpCard
    ? ACTION_BADGES.meeting_followups
    : isNoReplyAction
      ? { label: 'No reply', className: 'bg-muted text-muted-foreground' }
      : badge;
  const recommendationTitle = hasDraft
    ? 'Send or edit the prepared reply'
    : isNoReplyAction
      ? getActionTitle(email)
      : undefined;
  const recommendationDetail = hasDraft
    ? 'Review the draft below, make any edits, then send it from Forge once Gmail sending is configured.'
    : isNoReplyAction
      ? getActionRequirement(email)
      : undefined;
  const completionLabel = hasDraft
    ? 'Mark handled without sending'
    : isMeetingFollowUpCard
      ? 'Mark handled'
      : isNoReplyAction
      ? 'Mark task handled'
      : email.classification === 'tiding'
        ? 'Mark reviewed'
        : 'Mark handled';
  const isBusy = loading || taskLoading;

  async function handleAction(action: string) {
    setLoading(true);
    setError(undefined);
    try {
      await onAction(email._id, action);
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update email.');
    } finally {
      setLoading(false);
    }
  }

  async function handleSendDraft() {
    if (!localDraft.trim()) return;
    const confirmed = window.confirm(
      'Send this draft from Gmail now? This will actually email the recipient.'
    );
    if (!confirmed) return;

    setLoading(true);
    setError(undefined);
    try {
      await onSendDraft(email, localDraft);
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send draft.');
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateTask(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!taskDueDate) return;

    setTaskLoading(true);
    setError(undefined);
    try {
      const result = await onCreateTask(email, taskDueDate, localDraft);
      setTaskAddedLabel(`Task added to ${result.columnName}`);
      setTaskFormOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add task.');
    } finally {
      setTaskLoading(false);
    }
  }

  if (done) {
    return (
      <div className={`bg-card rounded-lg border overflow-hidden ${borderClass} opacity-50 transition-all duration-300`}>
        <div className="p-4 flex items-center justify-center text-muted-foreground text-xs">
          Done
        </div>
      </div>
    );
  }

  return (
    <div className={`bg-card rounded-lg border overflow-hidden ${borderClass} transition-all duration-200`}>
      <div className="p-4">
        <div className="flex items-start gap-3 mb-2">
          <div className={`w-8 h-8 rounded-full ${hashColor(senderName)} flex items-center justify-center text-white text-[10px] font-semibold shrink-0`}>
            {initials(senderName)}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-0.5">
              <span className="text-sm font-medium text-foreground truncate">{senderName}</span>
              <span className="text-[11px] text-muted-foreground truncate">{senderEmail}</span>
            </div>
            <p className="text-sm font-medium text-foreground">{email.subject || 'No subject'}</p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-1.5 shrink-0 max-w-[190px]">
            {classificationBadge && (
              <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${classificationBadge.className}`}>
                {classificationBadge.label}
              </span>
            )}
            <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${actionBadge.className}`}>
              {actionBadge.label}
            </span>
            <span className="text-[10px] text-muted-foreground">{formatTime(timestamp)}</span>
          </div>
        </div>

        <section className="mt-4 border-t pt-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Forge read
          </p>
          <p className="mt-2 text-sm leading-6 text-foreground">
            {forgeRead}
          </p>
        </section>

        <section className="mt-4 border-t pt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {sourceEmail.label}
            </p>
            {sourceEmail.note && (
              <p className="text-[11px] text-muted-foreground">
                {sourceEmail.note}
              </p>
            )}
          </div>
          {sourceEmail.body && (
            <div className="mt-2 max-h-72 overflow-y-auto whitespace-pre-wrap text-sm leading-6 text-foreground">
              {sourceEmail.body}
            </div>
          )}
          {sourceEmail.url && (
            <a
              href={sourceEmail.url}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-flex rounded-md border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground"
            >
              Open meeting notes
            </a>
          )}
        </section>

        {recommendationTitle && recommendationDetail && (
          <section className="mt-4 border-t pt-4">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Recommended move
            </p>
            <p className="mt-2 text-base font-semibold leading-snug text-foreground">
              {recommendationTitle}
            </p>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-foreground">
              {recommendationDetail}
            </p>
          </section>
        )}

        {hasDraft && (
          <section className="mt-4 border-t pt-4">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Draft response
              </p>
              <p className="text-[11px] text-muted-foreground">
                Edit if needed, then send from Forge.
              </p>
            </div>
            <textarea
              value={localDraft}
              onChange={(e) => setLocalDraft(e.target.value)}
              className="w-full border rounded-md p-2.5 text-sm bg-card resize-none focus:outline-none focus:ring-1 focus:ring-accent-blue/40 text-foreground"
              rows={6}
            />
          </section>
        )}

        {taskFormOpen && (
          <form
            onSubmit={handleCreateTask}
            className="mt-4 rounded-md border bg-muted/30 p-3"
          >
            <div className="flex flex-wrap items-end gap-2">
              <div>
                <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
                  Due date
                </label>
                <input
                  type="date"
                  value={taskDueDate}
                  onChange={(event) => setTaskDueDate(event.target.value)}
                  autoFocus
                  className="rounded-md border bg-card px-2.5 py-1.5 text-xs text-foreground outline-none focus:ring-1 focus:ring-accent-blue/40"
                />
              </div>
              <button
                type="submit"
                disabled={taskLoading || !taskDueDate}
                className="rounded-md bg-accent-green px-3 py-1.5 text-xs font-medium text-white transition-opacity duration-150 hover:opacity-90 disabled:opacity-50"
              >
                {taskLoading ? 'Adding...' : 'Confirm task'}
              </button>
              <button
                type="button"
                onClick={() => setTaskFormOpen(false)}
                disabled={taskLoading}
                className="rounded-md px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2 border-t pt-4">
          {hasDraft && (
            <button
              onClick={handleSendDraft}
              disabled={isBusy || !localDraft.trim()}
              className="px-3 py-1.5 bg-foreground text-background text-xs font-medium rounded-md hover:opacity-90 transition-opacity duration-150 disabled:opacity-50"
            >
              Send draft
            </button>
          )}
          {taskAddedLabel ? (
            <span className="rounded-md bg-accent-green/10 px-3 py-1.5 text-xs font-medium text-accent-green">
              ✓ {taskAddedLabel}
            </span>
          ) : !isMeetingFollowUpCard && !taskFormOpen ? (
            <button
              onClick={() => {
                setTaskDueDate((value) => value || getTodayDateInput());
                setTaskFormOpen(true);
              }}
              disabled={isBusy}
              className="px-3 py-1.5 border rounded-md text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors duration-150 disabled:opacity-50"
            >
              Add task
            </button>
          ) : null}
          <button
            onClick={() => handleAction('actioned')}
            disabled={isBusy}
            className="px-3 py-1.5 bg-accent-blue text-white text-xs font-medium rounded-md hover:opacity-90 transition-opacity duration-150 disabled:opacity-50"
          >
            {completionLabel}
          </button>
          {gmailUrl && (
            <a
              href={gmailUrl}
              target="_blank"
              rel="noreferrer"
              className="px-3 py-1.5 border rounded-md text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors duration-150"
            >
              Open Gmail
            </a>
          )}
        </div>

        {error && (
          <p className="mt-2 text-xs text-accent-red">{error}</p>
        )}
      </div>
    </div>
  );
}
