'use client';

import { useQuery, useMutation } from 'convex/react';
import { api } from '../../../convex/_generated/api';
import { Id } from '../../../convex/_generated/dataModel';
import SummaryCard from './SummaryCard';
import ActionCard, { type EmailItem } from './ActionCard';
import ActionLog, { type EmailAction } from './ActionLog';

export default function EmailView() {
  const pendingEmails = useQuery(api.emails.list, { status: 'pending' });
  const allEmails = useQuery(api.emails.list, {});
  const actions = useQuery(api.emailActions.list);
  const summaryValue = useQuery(api.appState.get, { key: 'email_triage_summary' });

  const updateEmail = useMutation(api.emails.update);
  const sendEmail = useMutation(api.emails.send);

  const loading =
    pendingEmails === undefined ||
    allEmails === undefined ||
    actions === undefined ||
    summaryValue === undefined;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-muted-foreground text-sm">Loading email...</div>
      </div>
    );
  }

  const emails = pendingEmails as EmailItem[];
  const summary = summaryValue ?? 'No triage data yet.';

  const counts = {
    pending: allEmails.filter((e) => e.status === 'pending').length,
    actioned: allEmails.filter((e) => e.status === 'actioned').length,
    dismissed: allEmails.filter((e) => e.status === 'dismissed').length,
  };

  async function handleAction(id: Id<'emailItems'>, action: string) {
    await updateEmail({ id, status: action });
  }

  async function handleSend(id: Id<'emailItems'>) {
    await sendEmail({ id });
  }

  function handleDraftChange(id: Id<'emailItems'>, draft: string) {
    updateEmail({ id, draftResponse: draft });
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-3xl mx-auto py-6 px-4 space-y-6">
        <SummaryCard
          summary={summary}
          pendingCount={counts.pending}
          actionedCount={counts.actioned}
          dismissedCount={counts.dismissed}
        />

        {emails.length === 0 ? (
          <div className="bg-card rounded-xl border border-border p-10 text-center transition-colors duration-200">
            <p className="text-muted-foreground">
              Your inbox is clear. The email handler runs 3x daily during work hours.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {emails.map((email) => (
              <ActionCard
                key={email._id}
                email={email}
                onAction={handleAction}
                onSend={handleSend}
                onDraftChange={handleDraftChange}
              />
            ))}
          </div>
        )}

        <ActionLog actions={actions as EmailAction[]} />
      </div>
    </div>
  );
}
