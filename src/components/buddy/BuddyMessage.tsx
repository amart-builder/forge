'use client';

import type { BuddyTurnView } from './BuddyProvider';
import PendingDeleteCard from './PendingDeleteCard';
import ReceiptChips from './ReceiptChips';
import SessionLinkCard from './SessionLinkCard';

export default function BuddyMessage({ turn, thinking, onRetry }: {
  turn: BuddyTurnView;
  thinking?: boolean;
  onRetry: (text: string) => void;
}) {
  const isConfirmedDelete = /^CONFIRM_DELETE\b/.test(turn.user_text);
  return (
    <article className="space-y-2">
      <div className="ml-auto w-fit max-w-[86%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-accent-blue px-3.5 py-2.5 text-sm leading-relaxed text-white">
        {isConfirmedDelete ? 'Confirmed delete' : turn.user_text}
      </div>
      <div className="mr-auto max-w-[92%] rounded-2xl rounded-bl-md bg-muted px-3.5 py-2.5 text-sm leading-relaxed text-foreground">
        {turn.assistant_text ? (
          <p className="whitespace-pre-wrap">{turn.assistant_text}</p>
        ) : thinking ? (
          <p className="buddy-thinking text-muted-foreground">thinking…</p>
        ) : turn.state === 'running' ? (
          <p className="text-muted-foreground">Working…</p>
        ) : (
          <p className="text-muted-foreground">Buddy was interrupted.</p>
        )}
        {turn.state === 'failed' && (
          <button
            type="button"
            className="mt-2 text-xs font-semibold text-accent-blue transition-transform duration-150 ease-out hover:underline hover:underline-offset-2 active:scale-[0.97] motion-reduce:transform-none"
            onClick={() => onRetry(turn.user_text)}
          >
            Retry
          </button>
        )}
        {turn.state !== 'running' && turn.receipts && (
          <>
            <ReceiptChips changes={turn.receipts.changes} />
            {turn.receipts.pendingDeletes.map((pending, index) => (
              <PendingDeleteCard key={`${pending.table}:${pending.id}:${index}`} turnId={turn.id} pending={pending} />
            ))}
            {turn.receipts.sessions?.map((session) => (
              <SessionLinkCard key={session.sessionId} session={session} />
            ))}
          </>
        )}
      </div>
    </article>
  );
}
