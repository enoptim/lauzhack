import { useId, useMemo, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import type { Assumption, AssumptionLabel } from '@/api/types';
import { cn } from '@/lib/utils';
import { num } from './parts';

/** A closed-by-default list of every number the engine uses: value, range, source, and whether it is our guess. */

const LABELS: Record<AssumptionLabel, string> = { fact: 'From data', research: 'From a study', guess: 'Our estimate', result: 'Worked out' };
const CATEGORIES: Record<string, string> = {
  financial: 'Money', solar: 'Solar', physics: 'Building physics', people: 'People', coupling: 'People and air',
  future: 'The future', prices: 'Prices', energy: 'Energy',
};

function fmt(value: number, unit: string) {
  const pct = unit.startsWith('fraction') || unit === 'share' || unit.startsWith('prob');
  if (pct) return `${Math.round(value * 1000) / 10}%${unit.endsWith('/yr') ? ' a year' : ''}`;
  const n = Math.abs(value) >= 1000 ? Math.round(value).toLocaleString('en-CH').replace(/,/g, '’') : String(Math.round(value * 1000) / 1000);
  return unit ? `${n} ${unit}` : n;
}

export default function AllAssumptions({ items }: { items: Assumption[] | null }) {
  const [open, setOpen] = useState(false);
  const panel = useId();
  const groups = useMemo(() => {
    const map = new Map<string, Assumption[]>();
    for (const a of items ?? []) map.set(a.category, [...(map.get(a.category) ?? []), a]);
    return [...map];
  }, [items]);
  const guesses = (items ?? []).filter(a => a.label === 'guess').length;

  return (
    <div className="flex shrink-0 flex-col py-2.5">
      <button type="button" aria-expanded={open} aria-controls={panel} onClick={() => setOpen(o => !o)}
        className="flex h-7 w-full items-center gap-1.5 rounded-md text-left text-[13px] font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/60">
        <ChevronRight aria-hidden="true" className={cn('size-3.5 transition-transform duration-150 motion-reduce:transition-none', open && 'rotate-90')} />
        All assumptions
        {items && <span className="text-xs font-normal text-muted-foreground">{items.length}, {guesses} are our estimates</span>}
      </button>
      <div id={panel} hidden={!open} className="mt-1 flex flex-col gap-3">
        {!items ? <p className="text-xs text-muted-foreground">Loading…</p> : groups.map(([category, list]) => (
          <section key={category} aria-label={CATEGORIES[category] ?? category}>
            <h3 className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{CATEGORIES[category] ?? category}</h3>
            <ul className="flex flex-col divide-y divide-[var(--r-divider)]">
              {list.map(a => (
                <li key={a.key} className="flex flex-col gap-0.5 py-1.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-xs text-foreground">{a.description || a.key}</span>
                    <span className={cn(num, 'shrink-0 text-xs font-medium text-foreground')}>{fmt(a.value, a.unit)}</span>
                  </div>
                  <p className="text-xs leading-4 text-muted-foreground">
                    {a.low !== a.high ? `Range ${fmt(a.low, '')} to ${fmt(a.high, a.unit)}. ` : 'Fixed. '}
                    <span className={cn('font-medium', a.label === 'guess' && 'text-foreground')}>{LABELS[a.label]}</span>
                    {a.source ? `: ${a.source}` : ''}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
