'use client';

interface SummaryCardProps {
  summary: string;
  pendingCount: number;
  actionedCount: number;
  dismissedCount: number;
}

export default function SummaryCard({
  summary,
  pendingCount,
  actionedCount,
  dismissedCount,
}: SummaryCardProps) {
  return (
    <div className="bg-white rounded-xl border border-border p-6 shadow-sm">
      <p className="text-sm text-muted-foreground mb-1">
        Here&apos;s what happened since you last checked
      </p>
      <p className="text-foreground mb-4">{summary}</p>
      <div className="flex items-center gap-6">
        <Stat label="Pending" value={pendingCount} color="text-accent-orange" />
        <Stat label="Actioned" value={actionedCount} color="text-accent-green" />
        <Stat label="Dismissed" value={dismissedCount} color="text-muted-foreground" />
      </div>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className={`text-lg font-semibold ${color}`}>{value}</span>
      <span className="text-sm text-muted-foreground">{label}</span>
    </div>
  );
}
