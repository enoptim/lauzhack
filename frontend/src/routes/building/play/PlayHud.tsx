// Explore's top strip, like a game's HUD: the year, a timeline with every stop so far, and the three numbers
// that matter, large enough to read from the back of the room. Numbers glide to their new value as time passes.
import { CalendarClock, Megaphone, TrendingUp, TriangleAlert, Wrench } from 'lucide-react';
import type { SessionState } from '@/api/types';
import { cn } from '@/lib/utils';
import AnimatedNumber from '@/routes/results/AnimatedNumber';
import { chfShort, gained, signedChf } from './format';
import type { Stop } from './usePlay';

export const STOP_ICONS = {
  failure: Wrench,
  event_announced: Megaphone,
  event_started: CalendarClock,
  new_flag: TriangleAlert,
  price_jump: TrendingUp,
} as const;

function Timeline({ state, stops }: { state: SessionState; stops: Stop[] }) {
  const years = Array.from({ length: state.horizon }, (_, k) => k + 1);
  return (
    <ol aria-label={`Year ${state.t} of ${state.horizon}`} className="flex w-full items-end gap-1">
      {years.map(year => {
        const stop = stops.find(s => s.t === year);
        const Icon = stop ? STOP_ICONS[stop.reasons[0]?.type ?? 'failure'] : null;
        const failure = stop?.reasons.some(r => r.type === 'failure');
        const past = year <= state.t;
        return (
          <li key={year} className="flex min-w-0 flex-1 flex-col items-center gap-1" title={stop ? `Year ${year}: ${stop.reasons.map(r => r.title).join('; ')}` : `Year ${year}`}>
            <span className={cn('grid size-5 place-items-center rounded-full', Icon ? (failure ? 'bg-destructive/12 text-destructive' : 'bg-primary/12 text-primary') : '')}>
              {Icon && <Icon aria-hidden="true" className="size-3" />}
            </span>
            <span className={cn('h-1.5 w-full rounded-full transition-colors duration-500', past ? 'bg-primary' : 'bg-[var(--r-track)]',
              year === state.t && !state.ended && 'ring-2 ring-primary/25')} />
            <span className={cn('text-[11px] tabular-nums', year === state.t ? 'font-semibold text-foreground' : 'text-muted-foreground')}>{year}</span>
          </li>
        );
      })}
    </ol>
  );
}

function Kpi({ label, value, format, note, tone, flashKey }: {
  label: string; value: number; format: (v: number) => string; note: string; tone?: 'good' | 'bad'; flashKey: string;
}) {
  return (
    <div key={flashKey} className="play-flash flex min-w-0 flex-col gap-0.5 px-4 py-1.5 first:pl-0 @[72rem]/hud:min-w-[11.5rem] @[72rem]/hud:first:pl-4">
      <dt className="truncate text-xs text-muted-foreground">{label}</dt>
      <dd className={cn('truncate text-[22px] leading-8 font-semibold tracking-tight @[48rem]/hud:text-[26px]',
        tone === 'good' && 'text-[var(--positive)]', tone === 'bad' && 'text-destructive')}>
        <AnimatedNumber value={value} format={format} ms={900} />
      </dd>
      <dd className="truncate text-xs text-muted-foreground">{note}</dd>
    </div>
  );
}

export default function PlayHud({ state, stops, which }: { state: SessionState; stops: Stop[]; which: string | null }) {
  const row = state.history.at(-1);
  const money = row ? gained(row) : 0;
  const change = row?.kwh_baseline ? (row.kwh / row.kwh_baseline - 1) * 100 : 0;
  const flash = `${state.session_id}|${state.t}|${state.decisions.length}`;
  return (
    <section aria-label="This run" className="@container/hud shrink-0 border-b border-[var(--r-line)] bg-background">
      <div className="grid grid-cols-[auto_minmax(10rem,1fr)] items-center gap-x-6 gap-y-2 px-5 py-3 @[72rem]/hud:grid-cols-[auto_minmax(12rem,1fr)_auto]">
      <div className="flex flex-col">
        <span className="text-xs text-muted-foreground">{which}</span>
        <span className="text-[26px] leading-8 font-semibold tracking-tight tabular-nums">
          {state.ended ? 'The end' : state.t === 0 ? 'Today' : <>Year <AnimatedNumber value={state.t} format={v => String(Math.round(v))} ms={700} /></>}
          <span className="text-base font-normal text-muted-foreground"> / {state.horizon} years</span>
        </span>
      </div>
      <Timeline state={state} stops={stops} />
      <dl className="col-span-2 grid grid-cols-3 divide-x divide-[var(--r-divider)] border-t border-[var(--r-divider)] pt-2 @[72rem]/hud:col-span-1 @[72rem]/hud:border-t-0 @[72rem]/hud:pt-0">
        <Kpi flashKey={`m${flash}`} label="Money vs doing nothing" value={money} format={signedChf}
          note={row ? 'So far, purchases included' : 'Nothing has happened yet'} tone={money > 500 ? 'good' : money < -500 ? 'bad' : undefined} />
        <Kpi flashKey={`e${flash}`} label="Electricity per year" value={change} format={v => Math.abs(v) < 0.5 ? '±0%' : `${v < 0 ? '−' : '+'}${Math.abs(v).toFixed(0)}%`}
          note="Compared with doing nothing" tone={change < -0.5 ? 'good' : change > 0.5 ? 'bad' : undefined} />
        <Kpi flashKey={`r${flash}`} label="Savings reserve" value={row?.cash_closing ?? 0} format={chfShort}
          note={row ? `Doing nothing: ${chfShort(row.cash_closing_baseline)}` : 'Shown after year 1'} />
      </dl>
      </div>
    </section>
  );
}
