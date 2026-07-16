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
    <section className="mx-auto w-full max-w-[60rem] space-y-8 px-6 py-8 sm:px-10 min-[1500px]:max-w-[76rem]" aria-label="The brief">
      <div className="mx-auto max-w-[70ch] space-y-6 min-[1500px]:max-w-none min-[1500px]:columns-2 min-[1500px]:gap-12 min-[1500px]:[orphans:3] min-[1500px]:[widows:3]">
        <div className="min-[1500px]:[break-after:avoid-column] min-[1500px]:[break-inside:avoid-column]">
          <h2 className="text-sm font-semibold text-foreground">Your morning brief</h2>
          {recap && (
            <div className="mt-6 space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Since the last close
              </p>
              <p className="text-base leading-relaxed text-foreground sm:text-lg min-[1500px]:text-pretty">{recap}</p>
            </div>
          )}
        </div>

        <p className="text-base leading-relaxed text-foreground sm:text-lg min-[1500px]:text-pretty">{narrative}</p>

        {briefWriting && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground min-[1500px]:[break-inside:avoid-column]" role="status">
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
          <div className="space-y-3 pt-2 min-[1500px]:[break-inside:avoid-column]" aria-label="Watching for you">
            <h2 className="text-sm font-semibold text-foreground">Watching for you</h2>
            {watchItems.map((watch, index) => (
              <p key={index} className="text-sm leading-relaxed text-muted-foreground min-[1500px]:text-pretty">
                <span className="font-medium text-foreground">{watch.label}.</span>{' '}
                {watch.evidence} Last seen: {watch.lastSeenState}
              </p>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
