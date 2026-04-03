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
    <div className="bg-card rounded-lg border p-5 transition-colors duration-200">
      <p className="text-[11px] text-muted-foreground mb-1 uppercase tracking-wide">
        Summary
      </p>
      <p className="text-sm text-foreground mb-3">{summary}</p>
      <div className="flex items-center gap-5">
        <Stat label="Pending" value={pendingCount} color="text-accent-orange" />
        <Stat label="Actioned" value={actionedCount} color="text-accent-green" />
        <Stat label="Dismissed" value={dismissedCount} color="text-muted-foreground" />
      </div>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className={`text-base font-semibold tabular-nums ${color}`}>{value}</span>
      <span className="text-[11px] text-muted-foreground">{label}</span>
    </div>
  );
}
