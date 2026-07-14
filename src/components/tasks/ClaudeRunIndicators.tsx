'use client';

import type { DayPlanExecutionRunStatus } from '@/lib/day-plan/types';
import { claudeResumeUrl, executionRunStatusLabel } from '@/lib/day-plan/presentation';

// Non-interactive status pill. Rendered as a <span> so it can live inside a <button>
// (downstream node, shelf entry) without nesting interactive controls.
export function RunStatusChip({
  status,
  className = '',
}: {
  status: DayPlanExecutionRunStatus;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full border border-accent-blue/40 bg-accent-blue/10 px-2 py-0.5 text-[0.6875rem] font-medium leading-none text-foreground ${className}`}
    >
      {executionRunStatusLabel(status)}
    </span>
  );
}

// Opens the resulting Claude session in the desktop app via its custom protocol. Custom
// protocols have no completion callback, so this never mutates run state and never claims
// the app opened.
export function OpenInClaudeCode({
  sessionId,
  title,
  className = '',
}: {
  sessionId: string;
  title?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={`min-h-9 shrink-0 rounded-lg border border-accent-blue/50 bg-accent-blue/10 px-3 text-xs font-semibold text-foreground transition-[background-color,transform] duration-150 ease-[var(--ease-out-forge)] hover:bg-accent-blue/20 active:scale-[0.97] motion-reduce:transform-none motion-reduce:transition-none ${className}`}
      aria-label={title ? `Open ${title} in Claude Code` : 'Open in Claude Code'}
      onClick={() => {
        window.location.href = claudeResumeUrl(sessionId);
      }}
    >
      Open in Claude Code
    </button>
  );
}
