import type { NpvBreakdown } from '@/api/types';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { chfShort } from './format';
import { breakdownLabels } from './labels';

/** One bar per source of value, growing left (cost) or right (gain) from a shared zero line. */
export default function MoneyBreakdown({ breakdown, staffEffects }: { breakdown: NpvBreakdown; staffEffects: boolean }) {
  const rows = Object.entries(breakdown)
    .filter(([, value]) => Math.abs(value) >= 500)
    .map(([key, value]) => ({ key, value, ...(breakdownLabels[key] ?? { label: key, guess: false }) }))
    .sort((a, b) => Number(a.guess) - Number(b.guess) || b.value - a.value);
  const max = Math.max(...rows.map(row => Math.abs(row.value)), 1);

  return (
    <ul className="flex flex-col gap-3">
      {rows.map(row => {
        const counted = staffEffects || !row.guess;
        const width = `${(Math.abs(row.value) / max) * 50}%`;
        return (
          <li key={row.key} className={cn('grid grid-cols-[minmax(9rem,12rem)_1fr_5.5rem] items-center gap-3 text-sm', !counted && 'opacity-45')}>
            <span className="flex items-center gap-2">
              {row.label}
              {row.guess && <Badge variant="outline" className="font-normal">guess</Badge>}
            </span>
            <span className="relative h-6">
              <span className="absolute inset-y-0 left-1/2 w-px bg-border" />
              <span
                className={cn('absolute inset-y-1 rounded-[4px] transition-[width,left] duration-500 ease-out',
                  row.value >= 0 ? 'left-1/2' : 'right-1/2')}
                style={{
                  width,
                  background: row.guess
                    ? 'repeating-linear-gradient(135deg, var(--chart-1) 0 3px, color-mix(in oklch, var(--chart-1) 30%, transparent) 3px 7px)'
                    : row.value >= 0 ? 'var(--chart-1)' : 'color-mix(in oklch, var(--foreground) 55%, transparent)',
                }}
              />
            </span>
            <span className="text-right font-medium tabular-nums">
              {counted ? chfShort(row.value) : 'not counted'}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
