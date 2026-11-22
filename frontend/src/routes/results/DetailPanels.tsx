import { TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
import { chances, chfShort } from './format';
import { flagText } from './labels';
import MoneyBreakdown from './MoneyBreakdown';
import { SectionLabel, num, Skeleton } from './parts';
import type { ResultsModel } from './useResultsModel';

/** Ten dots: how many futures in 10 have an emergency breakdown. */
function Dots({ share, color }: { share: number; color: string }) {
  const filled = Math.round(share * 10);
  return (
    <span aria-hidden="true" className="flex shrink-0 gap-1">
      {Array.from({ length: 10 }, (_, k) => (
        <span key={k} className="size-2 rounded-full transition-[background-color,box-shadow] duration-150 motion-reduce:transition-none"
          style={k < filled ? { background: color } : { boxShadow: 'inset 0 0 0 1.5px color-mix(in oklch, var(--muted-foreground) 45%, transparent)' }} />
      ))}
    </span>
  );
}

/** "Pays for itself in 7 of 10 futures by year 15", with plain words at the ends. */
function paidBackText(share: number, horizon: number) {
  const tenths = Math.round(share * 10);
  if (share >= 1) return `Pays for itself by year ${horizon} in every future`;
  if (share <= 0) return `Pays for itself by year ${horizon} in no future`;
  if (tenths === 0) return `Pays for itself by year ${horizon} in fewer than 1 of 10 futures`;
  if (tenths === 10) return `Pays for itself by year ${horizon} in more than 9 of 10 futures`;
  return `Pays for itself in ${tenths} of 10 futures by year ${horizon}`;
}

/** The bottom of the middle column: where the money comes from, and how sure we are. */
export default function DetailPanels({ m }: { m: ResultsModel }) {
  const color = m.colorOf(m.selected);
  const riskRows = m.riskYear && m.risk ? [
    { who: 'Doing nothing', share: m.riskYear.nothing, bill: m.risk.emergency_chf_mean_baseline, color: 'var(--warning)' },
    { who: m.multi ? `With ${m.plans[m.selected]?.name ?? 'the plan'}` : 'With the upgrade', share: m.riskYear.plan, bill: m.risk.emergency_chf_mean, color },
  ] : null;
  const warningCount = m.flags.length;

  return (
    // Two columns only when each gets enough room for its bars (measured on the middle column, not the window).
    <div className="@container border-t border-[var(--r-divider)]">
      <div className="grid @[52rem]:grid-cols-2">
      <section aria-labelledby="money-from" className="flex min-w-0 flex-col gap-4 px-5 py-6 @min-[40rem]/results:px-8">
        <div className="flex flex-col gap-1">
          <SectionLabel id="money-from">Where the money comes from</SectionLabel>
          <p className="max-w-[62ch] text-xs text-pretty text-muted-foreground">
            Average of {m.futuresN} futures, in today’s money. A franc in year 10 is worth less than one today, and equipment left
            at the end counts as value, so these add up to a different total than the chart.
          </p>
          {Math.abs(m.residual) >= 50_000 && m.residual < 0 && (
            <p className="max-w-[62ch] text-xs text-pretty text-muted-foreground">
              Doing nothing would also leave <span className={cn(num, 'whitespace-nowrap')}>{chfShort(-m.residual)}</span> more equipment value at the end.
            </p>
          )}
        </div>
        {m.breakdown
          ? <MoneyBreakdown breakdown={m.breakdown} staffEffects={m.staffEffects} color={color} busy={m.busy} />
          : <div className="flex flex-col gap-2">{Array.from({ length: 5 }, (_, k) => <Skeleton key={k} className="h-5" />)}</div>}
      </section>

      <section aria-labelledby="how-sure"
        className="flex min-w-0 flex-col gap-4 border-t border-[var(--r-divider)] px-5 py-6 @min-[40rem]/results:px-8 @[52rem]:border-t-0 @[52rem]:border-l">
        <SectionLabel id="how-sure">How sure are we?</SectionLabel>

        {/* The answer first: in how many futures the plan has paid for itself. */}
        {m.paidBackShare !== null ? (
          <div className={cn('grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-4 transition-opacity duration-200 motion-reduce:transition-none', m.busy && 'opacity-60')}>
            <span className="flex h-6 items-center"><Dots share={m.paidBackShare} color={color} /></span>
            <p className="text-[15px] leading-6 font-medium text-pretty">{paidBackText(m.paidBackShare, m.horizon)}</p>
          </div>
        ) : <Skeleton className="h-6" />}

        <div className="flex flex-col gap-3 border-t border-[var(--r-divider)] pt-4">
          <div className="flex flex-col gap-1">
            <h3 className="text-[13px] font-medium">Emergency breakdowns in the next {m.horizon} years</h3>
            <p className="max-w-[62ch] text-xs text-pretty text-muted-foreground">
              Old equipment this plan replaces breaks and must be replaced in a hurry, at 15% extra cost.
            </p>
          </div>
          {riskRows ? (
            <ul className={cn('flex flex-col gap-3 transition-opacity duration-200 motion-reduce:transition-none', m.busy && 'opacity-60')}>
              {riskRows.map(row => (
                <li key={row.who} className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-4">
                  <span className="flex h-5 items-center"><Dots share={row.share} color={row.color} /></span>
                  <span className="flex min-w-0 flex-col">
                    <span className="text-[13px] leading-5 text-muted-foreground">{row.who}</span>
                    <span className="block text-[13px] leading-5 font-medium first-letter:uppercase">{chances(row.share, m.futuresN)}</span>
                    <span className="text-xs text-muted-foreground">
                      Average emergency bill{m.horizon !== 15 && ' over 15 years'} <span className={cn(num, 'whitespace-nowrap')}>{chfShort(row.bill)}</span>
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="flex flex-col gap-3"><Skeleton className="h-9" /><Skeleton className="h-9" /></div>
          )}
        </div>

        <div className="flex flex-col gap-3 border-t border-[var(--r-divider)] pt-4">
          <h3 className="flex items-baseline gap-2 text-[13px] font-medium">
            Warnings
            {warningCount > 0 && <span className={cn(num, 'text-xs text-muted-foreground')}>{warningCount}</span>}
          </h3>
          {warningCount === 0
            ? <p className="text-[13px] text-muted-foreground">No warnings for this plan.</p>
            : (
              <ul className={cn('flex flex-col gap-2 transition-opacity duration-200 motion-reduce:transition-none', m.busy && 'opacity-60')}>
                {m.flags.map(flag => {
                  const shown = m.playYear === null || flag.year === undefined || flag.year <= m.playYear;
                  return (
                    <li key={`${flag.type}-${flag.year}`}
                      className={cn('flex items-start gap-2.5 text-[13px] leading-5 transition-[opacity,translate] duration-500 ease-out motion-reduce:transition-none',
                        !shown && 'translate-y-1 opacity-0')}>
                      <TriangleAlert className="mt-[3px] size-3.5 shrink-0 text-warning" aria-hidden="true" />
                      <span className="text-pretty">
                        {flag.year !== undefined && <span className="font-semibold">{flag.year === 0 ? 'Today' : `Year ${flag.year}`}: </span>}
                        {flagText(flag)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          {/* Not warnings about this plan: background facts, so they are not counted. */}
          {m.contextFlags.length > 0 && (
            <div className="flex flex-col gap-1">
              <p className="text-xs font-medium text-muted-foreground">For context</p>
              <ul className={cn('flex flex-col gap-1 transition-opacity duration-200 motion-reduce:transition-none', m.busy && 'opacity-60')}>
                {m.contextFlags.map(flag => (
                  <li key={flag.type} className="text-xs leading-5 text-pretty text-muted-foreground">
                    {flag.year !== undefined && `Year ${flag.year}: `}{flagText(flag)}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </section>
      </div>
    </div>
  );
}
