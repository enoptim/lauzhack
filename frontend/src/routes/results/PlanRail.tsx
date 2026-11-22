import { ArrowLeft, Eye, EyeOff } from 'lucide-react';
import { Link } from 'react-router';
import { cn } from '@/lib/utils';
import AnimatedNumber from './AnimatedNumber';
import { chfShort } from './format';
import { groupLabels } from './labels';
import { num, SectionLabel, Swatch } from './parts';
import { installedOption, optionName, where, type ResultsModel } from './useResultsModel';

/** Width of the value column, so every plan's number ends on the same edge. */
const VALUE_W = 'w-[4.25rem]';

/** One shared scale for every range strip, always including 0 (doing nothing). */
function useScale(m: ResultsModel) {
  let lo = 0;
  let hi = 0;
  for (const line of m.planLines) {
    if (!line) continue;
    lo = Math.min(lo, line.low[m.horizon] ?? 0);
    hi = Math.max(hi, line.high[m.horizon] ?? 0);
  }
  const pad = (hi - lo) * 0.04 || 1;
  lo -= pad;
  hi += pad;
  return (value: number) => ((value - lo) / (hi - lo)) * 100;
}

/**
 * Where 8 in 10 futures land at the horizon: a soft band from low to high, a dot at the middle future,
 * and a thin tick at 0 so the viewer sees at once whether the plan ends above or below doing nothing.
 */
function RangeStrip({ x, color, low, middle, high }: {
  x: (value: number) => number; color: string; low?: number; middle?: number; high?: number;
}) {
  const ready = low !== undefined && middle !== undefined && high !== undefined;
  // Only transforms move: the band is a full-width bar shifted and scaled, the marks ride on full-width layers.
  const move = 'transition-transform duration-[450ms] ease-[var(--r-ease-out)] motion-reduce:transition-none';
  const layer = cn('pointer-events-none absolute inset-0', move);
  return (
    <span aria-hidden="true" className="relative block h-1.5 w-full rounded-full bg-[var(--r-track)]">
      <span className={layer} style={{ transform: `translateX(${x(0)}%)` }}>
        <span className="absolute -top-0.5 left-0 h-2.5 w-px -translate-x-1/2 bg-muted-foreground/60" />
      </span>
      {ready && (
        <>
          <span className={cn('absolute inset-0 origin-left rounded-[2px]', move)}
            style={{ transform: `translateX(${x(low)}%) scaleX(${Math.max(0.005, (x(high) - x(low)) / 100)})`, background: `color-mix(in oklab, ${color} 25%, transparent)` }} />
          <span className={layer} style={{ transform: `translateX(${x(middle)}%)` }}>
            <span className="absolute top-1/2 left-0 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-1 ring-[var(--r-panel)]" style={{ background: color }} />
          </span>
        </>
      )}
    </span>
  );
}

/**
 * The left column: the plans. Pick one to see it in detail, hide the others from the chart,
 * and read what the chosen plan changes.
 */
export default function PlanRail({ m }: { m: ResultsModel }) {
  const x = useScale(m);
  const valueTone = cn('transition-opacity duration-150', m.busy && 'opacity-60');

  return (
    <div className="flex h-full min-h-full flex-col px-4 pt-3 pb-4">
      <div className="flex h-8 items-center justify-between gap-2">
        <Link to="/" onClick={m.editShownPlan} title="Back to the building, editing the plan shown here"
          className="-ml-2 inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[13px] text-muted-foreground transition-colors duration-150 outline-none hover:bg-card/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60">
          <ArrowLeft className="size-3.5" aria-hidden="true" />
          Change the plan
        </Link>
        {m.isDemo && <span className="text-xs text-muted-foreground">Demo plan</span>}
      </div>

      <div className="mt-5 flex items-baseline justify-between">
        <SectionLabel id="plans-label">Plans</SectionLabel>
        <span className="text-xs text-muted-foreground">In {m.horizon} years</span>
      </div>

      <ul aria-labelledby="plans-label" className="-mx-2 mt-1 flex flex-col gap-0.5">
        {/* The zero line on the chart. */}
        <li className="flex flex-col justify-center gap-1.5 rounded-md px-2 py-1.5" title="Doing nothing is the zero line on the chart">
          <span className="flex h-5 items-center gap-2">
            <span aria-hidden="true" className="size-2.5 shrink-0 rounded-[3px] border border-dashed border-muted-foreground/70" />
            <span className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground">Doing nothing</span>
            <span className={cn(num, VALUE_W, 'text-right text-[13px] text-muted-foreground')}>CHF 0</span>
          </span>
          <span className="pl-[18px]"><RangeStrip x={x} color="var(--muted-foreground)" low={0} middle={0} high={0} /></span>
        </li>

        {m.plans.map((plan, i) => {
          const line = m.planLines[i];
          const on = i === m.selected;
          const off = !on && m.hidden.has(i);
          const color = m.colorOf(i);
          const end = line?.middle[m.horizon];
          return (
            <li key={i} className={cn('group relative transition-opacity duration-150', off && 'opacity-50')}
              onMouseEnter={() => m.setHovered(i)} onMouseLeave={() => m.setHovered(null)}>
              <button type="button" aria-current={on ? 'true' : undefined}
                // A mouse click doesn't keep focus: otherwise pressing 1–6 next makes Chrome ring the clicked row.
                onClick={event => { m.selectPlan(i); if (event.detail > 0) event.currentTarget.blur(); }}
                title={i < 6 ? `Press ${i + 1} to choose this plan` : undefined}
                onFocus={event => { if (event.currentTarget.matches(':focus-visible')) m.setHovered(i); }}
                onBlur={event => { if (!event.currentTarget.closest('li')?.matches(':hover')) m.setHovered(null); }}
                className={cn('flex w-full flex-col justify-center gap-1.5 rounded-md px-2 py-1.5 text-left outline-none',
                  'transition-[background-color,box-shadow] duration-150 focus-visible:ring-2 focus-visible:ring-ring/60',
                  on ? 'bg-card shadow-[0_0_0_1px_var(--r-line)]' : 'hover:bg-card/60')}>
                <span className="flex h-5 items-center gap-2">
                  {/* The eye button takes the swatch's place on hover, so nothing else moves. */}
                  <Swatch color={color} className={cn('transition-opacity duration-150', !on && (off ? 'opacity-0' : 'group-hover:opacity-0 group-has-[:focus-visible]:opacity-0'))} />
                  <span className={cn('min-w-0 flex-1 truncate text-[13px]', on ? 'font-medium text-foreground' : 'text-foreground/85')}>{plan.name}</span>
                  <span className={cn(num, VALUE_W, 'shrink-0 text-right text-[13px]', on ? 'font-medium text-foreground' : 'text-foreground/85', valueTone)}>
                    {end === undefined ? '…' : <AnimatedNumber value={end} format={chfShort} />}
                  </span>
                </span>
                {/* Keys 1–6 choose a plan: the number sits under the swatch, in empty space, on hover or keyboard focus. */}
                {i < 6 && (
                  <kbd aria-hidden="true" className={cn(num, 'pointer-events-none absolute bottom-0.5 left-2 w-2.5 text-center font-sans text-xs leading-4 text-muted-foreground opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-has-[:focus-visible]:opacity-100')}>
                    {i + 1}
                  </kbd>
                )}
                <span className={cn('block pl-[18px]', valueTone)}>
                  <RangeStrip x={x} color={color} low={line?.low[m.horizon]} middle={end} high={line?.high[m.horizon]} />
                </span>
                <span className="sr-only">
                  {end === undefined ? 'Loading.' : `Middle future in ${m.horizon} years: ${chfShort(end)}.`}
                  {line && ` 8 in 10 futures between ${chfShort(line.low[m.horizon])} and ${chfShort(line.high[m.horizon])}.`}
                  {off && ' Hidden from the chart.'}
                </span>
              </button>
              {!on && (
                <button type="button" onClick={event => { m.toggleHidden(i); if (event.detail > 0) event.currentTarget.blur(); }}
                  aria-label={off ? `Show ${plan.name} on the chart` : `Hide ${plan.name} from the chart`}
                  title={off ? 'Show on the chart' : 'Hide from the chart'}
                  className={cn('absolute top-1.5 left-[3px] flex size-5 items-center justify-center rounded text-muted-foreground outline-none',
                    'transition-[opacity,color] duration-150 hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/60',
                    off ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-has-[:focus-visible]:opacity-100')}>
                  {off ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                </button>
              )}
            </li>
          );
        })}
      </ul>

      {/* Where plans and assumptions share one column (the assistant is open), the plan list stays short so the assumptions stay in view. */}
      <div className="mt-6 border-t border-[var(--r-divider)] pt-4 @min-[56rem]/results:@max-[76rem]/results:hidden">
        <SectionLabel>In this plan</SectionLabel>
        {m.chosen.length === 0 ? (
          <p className="mt-2 text-[13px] text-muted-foreground">No changes: this is today’s building.</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-3">
            {m.chosen.map((swap, k) => (
              <li key={`${swap.group}-${swap.floor ?? 'all'}-${k}`} className="flex flex-col gap-0.5">
                <span className="text-xs text-muted-foreground">{groupLabels[swap.group] ?? swap.group} · {where(swap)}</span>
                <span className="text-[13px] leading-5 text-pretty">
                  <span className="text-muted-foreground line-through decoration-1">{installedOption(m.catalog, swap) ?? 'Today’s setup'}</span>
                  <span aria-hidden="true" className="mx-1.5 text-muted-foreground">→</span>
                  <span className="sr-only"> becomes </span>
                  <span className="font-medium text-foreground">{optionName(m.catalog, swap.group, swap.option) ?? swap.option}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="mt-auto pt-8 @min-[56rem]/results:@max-[76rem]/results:hidden text-xs leading-5 text-pretty text-muted-foreground">
        The building is real. The numbers are our assumptions.
      </p>
    </div>
  );
}
