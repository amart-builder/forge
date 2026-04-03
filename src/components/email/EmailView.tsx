'use client';

import { useState, useEffect, useCallback } from 'react';
import SummaryCard from './SummaryCard';
import ActionCard, { type EmailItem } from './ActionCard';
import ActionLog, { type EmailAction } from './ActionLog';

interface AppStateRow {
  key: string;
  value: string;
}

export default function EmailView() {
  const [emails, setEmails] = useState<EmailItem[]>([]);
  const [actions, setActions] = useState<EmailAction[]>([]);
  const [summary, setSummary] = useState('');
  const [counts, setCounts] = useState({ pending: 0, actioned: 0, dismissed: 0 });
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const [emailsRes, actionsRes, allEmailsRes] = await Promise.all([
        fetch('/api/emails?status=pending'),
        fetch('/api/email-actions'),
        fetch('/api/emails'),
      ]);

      const [emailsData, actionsData, allEmailsData] = await Promise.all([
        emailsRes.json(),
        actionsRes.json(),
        allEmailsRes.json(),
      ]);

      setEmails(emailsData.emails ?? []);
      setActions(actionsData.actions ?? []);

      const all: EmailItem[] = allEmailsData.emails ?? [];
      setCounts({
        pending: all.filter((e) => e.status === 'pending').length,
        actioned: all.filter((e) => e.status === 'actioned').length,
        dismissed: all.filter((e) => e.status === 'dismissed').length,
      });

      // Fetch summary from app_state via the status endpoint or inline
      const statusRes = await fetch('/api/status');
      const statusData = await statusRes.json();
      const summaryRow = (statusData.state as AppStateRow[] | undefined)?.find(
        (s: AppStateRow) => s.key === 'email_triage_summary'
      );
      setSummary(summaryRow?.value ?? 'No triage data yet.');
    } catch (err) {
      console.error('Failed to fetch email data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  async function handleAction(id: string, action: string) {
    await fetch(`/api/emails/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: action }),
    });
    // Refetch to update counts and lists
    await fetchData();
  }

  async function handleSend(id: string) {
    await fetch(`/api/emails/${id}/send`, { method: 'POST' });
    await fetchData();
  }

  function handleDraftChange(id: string, draft: string) {
    fetch(`/api/emails/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ draft_response: draft }),
    });
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-muted-foreground text-sm">Loading email...</div>
      </div>
    );
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
                key={email.id}
                email={email}
                onAction={handleAction}
                onSend={handleSend}
                onDraftChange={handleDraftChange}
              />
            ))}
          </div>
        )}

        <ActionLog actions={actions} />
      </div>
    </div>
  );
}
