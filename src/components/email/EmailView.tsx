'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { api } from '../../../convex/_generated/api';
import type { Id } from '../../../convex/_generated/dataModel';
import { getRuntimeMode } from '@/lib/runtime/mode';
import {
  getLatestEmailSummary,
  listAllEmailItems as listAllSupabaseEmailItems,
  listDrafts,
  listEmailActionLog,
  listEmailItems as listPendingSupabaseEmailItems,
  sendDraftEmail,
  updateDraft,
  updateEmailItem,
} from '@/lib/data/email';
import {
  createTask as createSupabaseTask,
  createTaskColumn as createSupabaseTaskColumn,
  listTaskColumns,
  listTasks,
} from '@/lib/data/tasks';
import type {
  Draft,
  EmailActionLog as SupabaseEmailAction,
  EmailItem as SupabaseEmailItem,
  TaskColumn as SupabaseTaskColumn,
} from '@/lib/data/types';
import SummaryCard from './SummaryCard';
import ActionCard, { type EmailItem } from './ActionCard';
import ActionLog, { type EmailAction } from './ActionLog';

type EmailState = {
  emails: EmailItem[];
  allEmails: EmailItem[];
  actions: EmailAction[];
  summary: string;
};

type EmailStatus = SupabaseEmailItem['status'];
type QueueMode = 'action' | 'updates' | 'handled' | 'all';
type CreateEmailTaskResult = { columnName: string };

type EmailTaskColumnTarget = {
  name: string;
  aliases: string[];
  position: number;
};

const EMAIL_TASK_COLUMNS = {
  notStarted: {
    name: 'Not Started',
    aliases: ['Not Started', 'To Do'],
    position: 0,
  },
  today: {
    name: 'Must happen today',
    aliases: ['Must happen today', 'Needs to happen today', 'Today'],
    position: 10,
  },
} satisfies Record<string, EmailTaskColumnTarget>;

const emptyEmailState: EmailState = {
  emails: [],
  allEmails: [],
  actions: [],
  summary: 'No triage data yet.',
};

export default function EmailView() {
  // Local and Supabase both use the REST-backed view; only Convex differs.
  if (getRuntimeMode() !== 'convex') return <SupabaseEmailView />;
  return <ConvexEmailView />;
}

function ConvexEmailView() {
  const pendingEmails = useQuery(api.emails.list, { status: 'pending' });
  const allEmails = useQuery(api.emails.list, {});
  const actions = useQuery(api.emailActions.list);
  const summaryValue = useQuery(api.appState.get, { key: 'email_triage_summary' });
  const taskColumns = useQuery(api.columns.list);

  const updateEmail = useMutation(api.emails.update);
  const sendEmail = useMutation(api.emails.send);
  const createTask = useMutation(api.tasks.create);
  const createTaskColumn = useMutation(api.columns.create);

  const loading =
    pendingEmails === undefined ||
    allEmails === undefined ||
    actions === undefined ||
    summaryValue === undefined ||
    taskColumns === undefined;

  if (loading) return <EmailLoading />;

  async function handleAction(id: string, action: string) {
    await updateEmail({ id: id as Id<'emailItems'>, status: action });
  }

  async function handleSendDraft(email: EmailItem, draft: string) {
    const emailId = email._id as Id<'emailItems'>;
    await updateEmail({ id: emailId, draftResponse: draft });
    await sendEmail({ id: emailId });
  }

  async function handleCreateTaskFromEmail(
    email: EmailItem,
    dueDate: string,
    draft: string
  ): Promise<CreateEmailTaskResult> {
    const target = getEmailTaskColumnTarget(dueDate);
    const column =
      findTaskColumn(taskColumns as Array<{ _id: string; name: string }>, target.aliases) ??
      null;
    const columnId = column
      ? (column._id as Id<'columns'>)
      : ((await createTaskColumn({ name: target.name })) as Id<'columns'>);

    await createTask({
      columnId,
      title: getEmailTaskTitle(email),
      description: buildEmailTaskDescription(email, dueDate, draft),
      priority: getEmailTaskPriority(email.priority),
      dueDate,
      tags: getEmailTaskTags(email),
    });

    return { columnName: target.name };
  }

  return (
    <EmailContent
      emails={pendingEmails as EmailItem[]}
      allEmails={allEmails as EmailItem[]}
      actions={actions as EmailAction[]}
      summary={summaryValue ?? 'No triage data yet.'}
      onAction={handleAction}
      onSendDraft={handleSendDraft}
      onCreateTask={handleCreateTaskFromEmail}
    />
  );
}

function SupabaseEmailView() {
  const [state, setState] = useState<EmailState>(emptyEmailState);
  const [draftsByEmailId, setDraftsByEmailId] = useState<Map<string, Draft>>(new Map());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string>();

  const loadEmail = useCallback(async () => {
    setRefreshing(true);
    setError(undefined);
    try {
      const [pendingRows, allRows, actionRows, summary, draftRows] = await Promise.all([
        listPendingSupabaseEmailItems('pending'),
        listAllSupabaseEmailItems(),
        listEmailActionLog(),
        getLatestEmailSummary(),
        listDrafts(),
      ]);
      const nextDrafts = new Map(
        draftRows
          .filter((draft) => draft.email_item_id)
          .map((draft) => [draft.email_item_id as string, draft])
      );

      setDraftsByEmailId(nextDrafts);
      setState({
        emails: pendingRows.map((email) => normalizeSupabaseEmail(email, nextDrafts)),
        allEmails: allRows.map((email) => normalizeSupabaseEmail(email, nextDrafts)),
        actions: actionRows.map(normalizeSupabaseAction),
        summary,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadEmail();
  }, [loadEmail]);

  if (loading) return <EmailLoading />;

  if (error) {
    return (
      <div className="flex items-center justify-center h-full p-6">
        <div className="max-w-lg rounded-lg border bg-card p-4 text-sm">
          <p className="font-medium text-foreground">Email could not load.</p>
          <p className="mt-1 text-muted-foreground">{error}</p>
          <button
            onClick={() => void loadEmail()}
            className="mt-3 rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  async function handleAction(id: string, action: string) {
    const previousState = state;
    const status = action as EmailStatus;
    setState((currentState) => updateEmailStatus(currentState, id, status));
    try {
      await updateEmailItem(id, { status });
    } catch (err) {
      setState(previousState);
      throw err;
    }
  }

  async function handleSendDraft(email: EmailItem, draft: string) {
    const previousState = state;
    setState((currentState) => updateEmailStatus(currentState, email._id, 'actioned'));
    try {
      await sendDraftEmail({
        accountEmail: email.accountEmail,
        body: draft,
        messageId: email.messageId,
        senderEmail: email.senderEmail,
        subject: email.subject,
        threadId: email.threadId,
      });

      const existingDraft = draftsByEmailId.get(email._id);
      if (existingDraft) {
        await updateDraft(existingDraft.id, { body: draft, status: 'sent' });
      }
      await updateEmailItem(email._id, { status: 'actioned' });
    } catch (err) {
      setState(previousState);
      throw err;
    }
  }

  async function handleCreateTaskFromEmail(
    email: EmailItem,
    dueDate: string,
    draft: string
  ): Promise<CreateEmailTaskResult> {
    const target = getEmailTaskColumnTarget(dueDate);
    const [columns, tasks] = await Promise.all([
      listTaskColumns(),
      listTasks(),
    ]);
    let targetColumn = findSupabaseTaskColumn(columns, target.aliases);

    if (!targetColumn) {
      targetColumn = await createSupabaseTaskColumn({
        name: target.name,
        position: target.position,
        is_default: true,
      });
    }

    const nextPosition =
      tasks
        .filter((task) => task.column_id === targetColumn.id)
        .reduce((maxPosition, task) => Math.max(maxPosition, task.position), -1) + 1;

    await createSupabaseTask({
      column_id: targetColumn.id,
      title: getEmailTaskTitle(email),
      description: buildEmailTaskDescription(email, dueDate, draft),
      priority: getEmailTaskPriority(email.priority),
      due_at: toSupabaseDueAt(dueDate),
      tags: getEmailTaskTags(email),
      position: nextPosition,
      source_type: 'email',
    });

    return { columnName: target.name };
  }

  return (
    <EmailContent
      emails={state.emails}
      allEmails={state.allEmails}
      actions={state.actions}
      summary={state.summary}
      refreshing={refreshing}
      onAction={handleAction}
      onSendDraft={handleSendDraft}
      onCreateTask={handleCreateTaskFromEmail}
      onRefresh={loadEmail}
    />
  );
}

function EmailLoading() {
  return (
    <div className="flex items-center justify-center h-full">
      <div className="text-muted-foreground text-sm">Loading email...</div>
    </div>
  );
}

function EmailContent({
  allEmails,
  actions,
  summary,
  refreshing = false,
  onAction,
  onSendDraft,
  onCreateTask,
  onRefresh,
}: EmailState & {
  refreshing?: boolean;
  onAction: (id: string, action: string) => Promise<void>;
  onSendDraft: (email: EmailItem, draft: string) => Promise<void>;
  onCreateTask: (
    email: EmailItem,
    dueDate: string,
    draft: string
  ) => Promise<CreateEmailTaskResult>;
  onRefresh?: () => Promise<void>;
}) {
  const [mode, setMode] = useState<QueueMode>('action');
  const [search, setSearch] = useState('');

  const pending = allEmails.filter(isPendingEmail);
  const actionQueue = pending.filter(isActionEmail).sort(sortImportantFirst);
  const updatesQueue = pending.filter((email) => !isActionEmail(email)).sort(sortNewestFirst);
  const handledQueue = allEmails.filter((email) => !isPendingEmail(email)).sort(sortNewestFirst);

  const visibleEmails = useMemo(() => {
    const source =
      mode === 'action'
        ? actionQueue
        : mode === 'updates'
          ? updatesQueue
          : mode === 'handled'
            ? handledQueue
            : allEmails.slice().sort(sortNewestFirst);

    const q = search.trim().toLowerCase();
    if (!q) return source;
    return source.filter((email) =>
      [
        email.senderName,
        email.senderEmail,
        email.subject,
        email.summary,
        email.actionTitle,
        email.actionRequirement,
        email.context,
        email.meetingNotesUrl,
        email.bodyExcerpt,
        email.draftResponse,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(q)
    );
  }, [actionQueue, allEmails, handledQueue, mode, search, updatesQueue]);

  const counts = {
    action: actionQueue.length,
    updates: updatesQueue.length,
    handled: handledQueue.length,
    pending: pending.length,
    drafts: allEmails.filter((email) => Boolean(email.draftResponse) && isPendingEmail(email)).length,
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl space-y-4 px-5 py-5">
        <div className="flex flex-wrap items-center gap-2">
          <div>
            <h1 className="text-base font-semibold text-foreground">Email</h1>
            <p className="text-xs text-muted-foreground">
              Reply and decision work first, useful updates second.
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search email..."
              className="w-[220px] rounded-md border bg-background px-3 py-1.5 text-xs text-foreground outline-none focus:ring-1 focus:ring-accent-blue/40 max-sm:w-[150px]"
            />
            {onRefresh && (
              <button
                onClick={() => void onRefresh()}
                disabled={refreshing}
                className="rounded-md border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
              >
                {refreshing ? 'Refreshing...' : 'Refresh'}
              </button>
            )}
          </div>
        </div>

        <SummaryCard
          summary={summary}
          actionCount={counts.action}
          updateCount={counts.updates}
          handledCount={counts.handled}
          draftCount={counts.drafts}
        />

        <div className="flex flex-wrap gap-1.5 rounded-lg border bg-card p-1.5">
          <QueueButton active={mode === 'action'} label="Needs Me" count={counts.action} onClick={() => setMode('action')} />
          <QueueButton active={mode === 'updates'} label="Updates" count={counts.updates} onClick={() => setMode('updates')} />
          <QueueButton active={mode === 'handled'} label="Handled" count={counts.handled} onClick={() => setMode('handled')} />
          <QueueButton active={mode === 'all'} label="All" count={allEmails.length} onClick={() => setMode('all')} />
        </div>

        {visibleEmails.length === 0 ? (
          <div className="rounded-lg border bg-card p-10 text-center transition-colors duration-200">
            <p className="text-sm font-medium text-foreground">{getEmptyTitle(mode, search)}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {mode === 'action'
                ? 'No reply or decision items are waiting in Forge.'
                : 'Nothing matches this view right now.'}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {visibleEmails.map((email) => (
              <ActionCard
                key={email._id}
                email={email}
                onAction={onAction}
                onSendDraft={onSendDraft}
                onCreateTask={onCreateTask}
              />
            ))}
          </div>
        )}

        <ActionLog actions={actions} />
      </div>
    </div>
  );
}

function QueueButton({
  active,
  label,
  count,
  onClick,
}: {
  active: boolean;
  label: string;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
        active
          ? 'bg-foreground text-background'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground'
      }`}
    >
      {label} <span className="tabular-nums">{count}</span>
    </button>
  );
}

function getEmptyTitle(mode: QueueMode, search: string): string {
  if (search.trim()) return 'No matching emails';
  if (mode === 'action') return 'No email needs you right now';
  if (mode === 'updates') return 'No useful updates waiting';
  if (mode === 'handled') return 'No handled email yet';
  return 'No email data yet';
}

function isPendingEmail(email: EmailItem): boolean {
  return email.status === 'pending' || email.status === 'reviewed';
}

function isActionEmail(email: EmailItem): boolean {
  if (email.classification === 'action_item') return true;
  if (email.draftResponse) return true;
  return ['reply', 'follow_up', 'delegate', 'flag'].includes(email.recommendedAction);
}

function sortImportantFirst(a: EmailItem, b: EmailItem): number {
  const draftDelta = Number(Boolean(b.draftResponse)) - Number(Boolean(a.draftResponse));
  if (draftDelta !== 0) return draftDelta;
  const priorityDelta = a.priority - b.priority;
  if (priorityDelta !== 0) return priorityDelta;
  return (b.receivedAt ?? b.createdAt) - (a.receivedAt ?? a.createdAt);
}

function sortNewestFirst(a: EmailItem, b: EmailItem): number {
  return (b.receivedAt ?? b.createdAt) - (a.receivedAt ?? a.createdAt);
}

function getTodayDateInput(): string {
  const now = new Date();
  const localDate = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return localDate.toISOString().slice(0, 10);
}

function getEmailTaskColumnTarget(dueDate: string): EmailTaskColumnTarget {
  return dueDate === getTodayDateInput()
    ? EMAIL_TASK_COLUMNS.today
    : EMAIL_TASK_COLUMNS.notStarted;
}

function findTaskColumn<T extends { name: string }>(
  columns: T[],
  aliases: string[]
): T | undefined {
  const normalizedAliases = new Set(
    aliases.map((alias) => alias.trim().toLowerCase())
  );
  return columns.find((column) =>
    normalizedAliases.has(column.name.trim().toLowerCase())
  );
}

function findSupabaseTaskColumn(
  columns: SupabaseTaskColumn[],
  aliases: string[]
): SupabaseTaskColumn | undefined {
  return findTaskColumn(columns, aliases);
}

function toSupabaseDueAt(value: string): string {
  return new Date(`${value}T00:00:00`).toISOString();
}

function getEmailTaskPriority(priority: number): 'low' | 'medium' | 'high' {
  if (priority <= 1) return 'high';
  if (priority === 2) return 'medium';
  return 'low';
}

function compactLine(value?: string): string | undefined {
  const text = value?.replace(/\s+/g, ' ').trim();
  return text || undefined;
}

function limitText(value: string, maxLength: number): string {
  return value.length > maxLength
    ? `${value.slice(0, maxLength - 3).trim()}...`
    : value;
}

function getEmailTaskTitle(email: EmailItem): string {
  const explicitTitle = compactLine(email.actionTitle);
  if (explicitTitle) return limitText(explicitTitle, 120);

  const subject = compactLine(email.subject);
  if (email.draftResponse && subject) return limitText(`Reply: ${subject}`, 120);
  if (subject) return limitText(subject, 120);

  const sender = compactLine(email.senderName) ?? compactLine(email.senderEmail);
  return sender ? `Handle email from ${sender}` : 'Handle email';
}

function getEmailSourceBody(email: EmailItem): string | undefined {
  return (
    email.originalBody?.trim() ||
    email.bodyExcerpt?.trim() ||
    email.summary?.trim() ||
    undefined
  );
}

function getEmailTaskTags(email: EmailItem): string[] {
  const tags = ['email'];
  if (email.draftResponse) tags.push('reply');
  if (email.classification === 'action_item') tags.push('needs-alex');
  return tags;
}

function getGmailThreadUrl(threadId?: string): string | undefined {
  if (!threadId) return undefined;
  return `https://mail.google.com/mail/u/0/#inbox/${encodeURIComponent(threadId)}`;
}

function buildEmailTaskDescription(
  email: EmailItem,
  dueDate: string,
  draft: string
): string {
  const sender = [compactLine(email.senderName), compactLine(email.senderEmail)]
    .filter(Boolean)
    .join(' ');
  const sections = [
    'Created from Forge email triage.',
    sender ? `From: ${sender}` : undefined,
    compactLine(email.subject) ? `Subject: ${compactLine(email.subject)}` : undefined,
    `Due: ${dueDate}`,
    compactLine(email.actionRequirement)
      ? `Recommended move:\n${email.actionRequirement?.trim()}`
      : undefined,
    compactLine(email.summary) ? `Forge read:\n${email.summary?.trim()}` : undefined,
    draft.trim() ? `Draft response:\n${draft.trim()}` : undefined,
    getEmailSourceBody(email) ? `Original email:\n${getEmailSourceBody(email)}` : undefined,
    getGmailThreadUrl(email.threadId) ? `Gmail:\n${getGmailThreadUrl(email.threadId)}` : undefined,
  ].filter(Boolean);

  return sections.join('\n\n');
}

function updateEmailStatus(state: EmailState, id: string, status: EmailStatus): EmailState {
  const applyStatus = (email: EmailItem) =>
    email._id === id ? { ...email, status } : email;

  return {
    ...state,
    emails:
      status === 'pending'
        ? state.emails.map(applyStatus)
        : state.emails.filter((email) => email._id !== id),
    allEmails: state.allEmails.map(applyStatus),
  };
}

function toEpoch(value: string | null | undefined): number {
  return value ? new Date(value).getTime() : Date.now();
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function textField(record: Record<string, unknown> | null, keys: string[]): string | undefined {
  if (!record) return undefined;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function extractOriginalBody(email: SupabaseEmailItem): string | undefined {
  const sourcePayload = asRecord(email.source_payload);
  const input = asRecord(sourcePayload?.input);
  return (
    textField(input, ['full_body', 'fullBody', 'body_text', 'bodyText', 'body_plain', 'bodyPlain', 'body']) ??
    textField(sourcePayload, ['full_body', 'fullBody', 'body_text', 'bodyText', 'body_plain', 'bodyPlain', 'body'])
  );
}

function extractOriginalBodySource(email: SupabaseEmailItem): string | undefined {
  const sourcePayload = asRecord(email.source_payload);
  const input = asRecord(sourcePayload?.input);
  return (
    textField(sourcePayload, ['full_body_source', 'fullBodySource', 'body_source', 'bodySource']) ??
    textField(input, ['full_body_source', 'fullBodySource', 'body_source', 'bodySource'])
  );
}

function extractActionTitle(email: SupabaseEmailItem): string | undefined {
  const sourcePayload = asRecord(email.source_payload);
  const input = asRecord(sourcePayload?.input);
  return (
    textField(sourcePayload, ['action_title', 'actionTitle', 'task_title', 'taskTitle']) ??
    textField(input, ['action_title', 'actionTitle', 'task_title', 'taskTitle'])
  );
}

function extractActionRequirement(email: SupabaseEmailItem): string | undefined {
  const sourcePayload = asRecord(email.source_payload);
  const input = asRecord(sourcePayload?.input);
  return (
    textField(sourcePayload, [
      'action_requirement',
      'actionRequirement',
      'task_requirement',
      'taskRequirement',
      'next_step',
      'nextStep',
    ]) ??
    textField(input, [
      'action_requirement',
      'actionRequirement',
      'task_requirement',
      'taskRequirement',
      'next_step',
      'nextStep',
    ])
  );
}

function extractMeetingNotesUrl(email: SupabaseEmailItem): string | undefined {
  const sourcePayload = asRecord(email.source_payload);
  const input = asRecord(sourcePayload?.input);
  return (
    textField(sourcePayload, [
      'meeting_notes_url',
      'meetingNotesUrl',
      'google_doc_url',
      'googleDocUrl',
      'drive_url',
      'driveUrl',
    ]) ??
    textField(input, [
      'meeting_notes_url',
      'meetingNotesUrl',
      'google_doc_url',
      'googleDocUrl',
      'drive_url',
      'driveUrl',
    ])
  );
}

function extractAttioRecordUrl(email: SupabaseEmailItem): string | undefined {
  const sourcePayload = asRecord(email.source_payload);
  const input = asRecord(sourcePayload?.input);
  return (
    textField(sourcePayload, ['attio_record_url', 'attioRecordUrl']) ??
    textField(input, ['attio_record_url', 'attioRecordUrl'])
  );
}

function normalizeRecommendedAction(email: SupabaseEmailItem): string {
  if (email.recommended_action) return email.recommended_action;
  if (email.classification === 'log_only') return 'archive';
  if (email.classification === 'tiding') return 'review';
  return 'review';
}

function normalizeSupabaseEmail(
  email: SupabaseEmailItem,
  draftsByEmailId: Map<string, Draft>
): EmailItem {
  const draft = draftsByEmailId.get(email.id);
  return {
    _id: email.id,
    accountEmail: email.account_email ?? undefined,
    threadId: email.thread_id ?? undefined,
    messageId: email.message_id ?? undefined,
    senderName: email.sender_name ?? undefined,
    senderEmail: email.sender_email ?? undefined,
    subject: email.subject ?? undefined,
    summary: email.summary ?? email.body_excerpt ?? undefined,
    bodyExcerpt: email.body_excerpt ?? undefined,
    originalBody: extractOriginalBody(email),
    originalBodySource: extractOriginalBodySource(email),
    meetingNotesUrl: extractMeetingNotesUrl(email),
    attioRecordUrl: extractAttioRecordUrl(email),
    actionTitle: extractActionTitle(email),
    actionRequirement: extractActionRequirement(email),
    context: email.context ?? undefined,
    classification: email.classification,
    recommendedAction: normalizeRecommendedAction(email),
    draftResponse: draft?.body,
    priority: email.priority,
    status: email.status,
    createdAt: toEpoch(email.created_at),
    receivedAt: toEpoch(email.received_at ?? email.created_at),
  };
}

function normalizeSupabaseAction(action: SupabaseEmailAction): EmailAction {
  return {
    _id: action.id,
    emailItemId: action.email_item_id ?? '',
    actionType: action.action_type,
    description: action.description,
    createdAt: toEpoch(action.created_at),
  };
}
