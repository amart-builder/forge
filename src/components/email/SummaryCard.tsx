'use client';

interface SummaryCardProps {
  summary: string;
  actionCount: number;
  updateCount: number;
  handledCount: number;
  draftCount: number;
}

export default function SummaryCard({
  summary,
  actionCount,
  updateCount,
  handledCount,
  draftCount,
}: SummaryCardProps) {
  return (
    <div className="bg-card rounded-lg border p-5 transition-colors duration-200">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] text-muted-foreground mb-1 uppercase tracking-wide">
            Latest triage
          </p>
          <p className="text-sm text-foreground">{summary}</p>
        </div>
        {actionCount > 0 && (
          <div className="rounded-md bg-accent-red/10 px-2.5 py-1 text-[11px] font-semibold text-accent-red">
            {actionCount} need Alex
          </div>
        )}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-5">
        <Stat label="Need Alex" value={actionCount} color="text-accent-red" />
        <Stat label="Updates" value={updateCount} color="text-accent-orange" />
        <Stat label="Drafts" value={draftCount} color="text-accent-blue" />
        <Stat label="Handled" value={handledCount} color="text-accent-green" />
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
