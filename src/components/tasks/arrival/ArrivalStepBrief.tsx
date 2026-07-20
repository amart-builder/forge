import type { PublicMorningBrief } from '@/lib/day-plan/brief';

export default function ArrivalStepBrief({
  recap,
  narrative,
  watchItems,
  briefWriting,
}: {
  recap?: string;
  narrative: string;
  watchItems: PublicMorningBrief['watchItems'];
  briefWriting: boolean;
}) {
  return (
    <section className="mx-auto w-full max-w-[85rem] space-y-8 px-6 py-8 sm:px-10" aria-label="The brief">
      <div className="space-y-6">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Your morning brief</h2>
          {recap && (
            <div className="mt-6 space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Since the last close
              </p>
              <p className="text-pretty text-base leading-relaxed text-foreground sm:text-lg">{recap}</p>
            </div>
          )}
        </div>

        <p className="text-pretty text-base leading-relaxed text-foreground sm:text-lg">{narrative}</p>

        {briefWriting && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
            <span className="inline-flex items-center gap-1" aria-hidden="true">
              {[0, 1, 2].map((dot) => (
                <span
                  key={dot}
                  className="size-1.5 rounded-full bg-current opacity-35 motion-safe:animate-pulse"
                  style={{ animationDelay: `${dot * 180}ms` }}
                />
              ))}
            </span>
            Your brief is being written…
          </p>
        )}

        {watchItems.length > 0 && (
          <div className="space-y-4 border-t border-border/60 pt-6" aria-label="Watching for you">
            <h2 className="text-sm font-semibold text-foreground">Watching for you</h2>
            {watchItems.map((watch, index) => (
              <p key={index} className="text-pretty text-sm leading-relaxed text-muted-foreground">
                <span className="font-medium text-foreground">{watch.label}.</span>{' '}
                {watch.evidence}
              </p>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
