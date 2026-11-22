import type { NpvBreakdown } from '@/api/types';
import { cn } from '@/lib/utils';
import { chfShort } from './format';
import { breakdownLabels } from './labels';
import { num } from './parts';

// One grid for all rows, so the label column is only as wide as the longest label and the bars get the rest.
const GRID = 'grid grid-cols-[minmax(0,max-content)_minmax(6rem,1fr)_max-content] gap-x-4';

/**
 * One bar per source of value, growing left (cost) or right (gain) from a shared zero line,
 * No total: it would be a second, discounted headline next to the chart's. Guesses (people effects, not cash) are hatched and only counted when switched on.
 */
export default function MoneyBreakdown({ breakdown, staffEffects, color, busy }: {
  breakdown: NpvBreakdown;
  staffEffects: boolean;
  /** The selected plan's colour: gains are drawn in it. */
  color: string;
  busy?: boolean;
}) {
  const rows = Object.entries(breakdown)
    .filter(([, value]) => Math.abs(value) >= 500)
    .map(([key, value]) => ({ key, value, ...(breakdownLabels[key] ?? { label: key, guess: false }) }))
    .sort((a, b) => Number(a.guess) - Number(b.guess) || b.value - a.value);
  if (rows.length === 0) return <p className="text-[13px] text-muted-foreground">No money moves: this plan changes nothing.</p>;
  const counted = rows.filter(row => staffEffects || !row.guess);
  // The zero line sits where the counted gains and costs both fit: bars use the whole track, on one shared scale.
  const maxGain = Math.max(0, ...counted.map(row => row.value));
  const maxCost = Math.max(0, ...counted.map(row => -row.value));
  const span = Math.max(maxGain + maxCost, 1);
  const zero = (maxCost / span) * 100;
  const cost = 'color-mix(in oklch, var(--foreground) 55%, transparent)';
  const move = 'transition-transform duration-[450ms] ease-[var(--r-ease-out)] motion-reduce:transition-none';

  return (
    <div className={cn('flex flex-col transition-opacity duration-200 motion-reduce:transition-none', busy && 'opacity-60')}>
      <ul className={GRID}>
        {rows.map(row => {
          const isCounted = staffEffects || !row.guess;
          const gain = row.value >= 0;
          // Bars only move by transform: scaled from the zero line, then shifted to it.
          const scale = Math.max(Math.abs(row.value) / span, 0.002);
          const transform = gain
            ? `translateX(${zero}%) scaleX(${scale})`
            : `translateX(${zero - 100}%) scaleX(${scale})`;
          return (
            <li key={row.key} className={cn('col-span-3 grid h-7 grid-cols-subgrid items-center text-[13px] transition-opacity duration-150 motion-reduce:transition-none', !isCounted && 'opacity-45')}>
              <span className="flex min-w-0 items-baseline gap-2">
                <span className="truncate">{row.label}</span>
                {row.guess && <span className="shrink-0 text-xs text-muted-foreground">guess</span>}
              </span>
              <span className="relative h-full" aria-hidden="true">
                <span className={cn('absolute inset-0', move)} style={{ transform: `translateX(${zero}%)` }}>
                  <span className="absolute inset-y-0 left-0 w-px bg-[var(--r-line)]" />
                </span>
                {isCounted && (
                  <span
                    className={cn('absolute inset-x-0 top-1/2 -mt-1.5 h-3', move, gain ? 'origin-left' : 'origin-right')}
                    style={{
                      transform,
                      // Hatching for guesses: vertical stripes, sized so they stay 5px apart after the scale.
                      background: row.guess
                        ? `linear-gradient(90deg, ${color} 0 40%, color-mix(in oklch, ${color} 22%, transparent) 40% 100%) 0 0 / ${5 / scale}px 100% repeat-x`
                        : gain ? color : cost,
                    }}
                  />
                )}
              </span>
              <span className={cn('text-right', isCounted ? cn(num, 'text-foreground') : 'text-xs text-muted-foreground')}>
                {isCounted ? chfShort(row.value) : 'not counted'}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
