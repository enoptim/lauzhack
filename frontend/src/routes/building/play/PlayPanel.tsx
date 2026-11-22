// The right-hand panel in Play: start a game, then the year, what happened, what you can do, and your plan.
// It uses the plan inspector's frame (header row, scrolling body, footer button), so Play feels like the same building.
import { ArrowRight, Lock, RotateCcw, TriangleAlert, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import type { SessionState, SessionSwap } from '@/api/types';
import { Alert, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { FLOOR_COUNT } from '@/data/building';
import { cn } from '@/lib/utils';
import { PLAN_COLORS } from '@/twin/plans';
import { levelName } from '../PlanPins';
import ChangeNow from './ChangeNow';
import { chf, chfShort, gained, groupLabels, mwh, optionName, signedChf, whenLabel, whereLabel } from './format';
import PlayChart from './PlayChart';
import { DEMO_FUTURE, type Play } from './usePlay';
import WhatHappened from './WhatHappened';

const levels: (number | null)[] = [null, ...Array.from({ length: FLOOR_COUNT + 1 }, (_, index) => FLOOR_COUNT - 1 - index)];
const shortLevel = (level: number | null) => level === null ? 'All' : level === 0 ? 'G' : level === -1 ? 'B' : String(level);
const LENGTHS = [5, 10, 15] as const;

/** Equipment you can change from each view. The whole-building view offers everything, for the whole building. */
function viewGroups(floor: number | null): string[] {
  if (floor === null) return ['lighting', 'ventilation', 'solar_pv', 'blinds', 'computers', 'monitors', 'coffee', 'water_heater', 'servers'];
  if (floor === -1) return ['water_heater', 'servers'];
  return floor === FLOOR_COUNT - 1 ? ['lighting', 'monitors', 'computers', 'coffee'] : ['lighting', 'monitors', 'computers'];
}

/** A row of small segments, styled like the floor picker. */
function Segments<T extends string | number | null>({ label, options, value, onChange, text }: {
  label: string; options: readonly T[]; value: T; onChange: (value: T) => void; text: (value: T) => string;
}) {
  return (
    <div role="radiogroup" aria-label={label}
      className="grid gap-0.5 rounded-lg bg-secondary p-0.5 shadow-[inset_0_0_0_1px_var(--border)]"
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map(option => {
        const checked = option === value;
        return (
          <button key={String(option)} type="button" role="radio" aria-checked={checked} onClick={() => onChange(option)}
            className={cn('h-8 rounded-md px-1 text-sm font-medium tabular-nums transition-colors focus-visible:outline-2 focus-visible:outline-ring',
              checked ? 'bg-card text-foreground shadow-[0_1px_2px_oklch(0_0_0/0.08),inset_0_0_0_1px_var(--border)]' : 'text-muted-foreground hover:text-foreground')}>
            {text(option)}
          </button>
        );
      })}
    </div>
  );
}

function YearBar({ t, horizon }: { t: number; horizon: number }) {
  return (
    <ol className="flex shrink-0 gap-0.5" aria-label={`Year ${t} of ${horizon}`}>
      {Array.from({ length: horizon }, (_, k) => k + 1).map(year => (
        <li key={year} title={`Year ${year}`} className={cn('h-1.5 flex-1 rounded-full', year <= t ? 'bg-primary' : 'bg-muted')} />
      ))}
    </ol>
  );
}

/** Three numbers for the year just ended, the same way "The building today" shows them. */
function Numbers({ state }: { state: SessionState }) {
  const row = state.history.at(-1);
  if (!row) return null;
  const change = row.kwh_baseline ? (row.kwh / row.kwh_baseline - 1) * 100 : 0;
  const items: [string, string, string][] = [
    ['Money vs doing nothing', signedChf(gained(row)), 'So far, purchases included'],
    [`Electricity, year ${row.year}`, mwh(row.kwh), Math.abs(change) < 0.5 ? 'Same as doing nothing' : `${change < 0 ? '' : '+'}${change.toFixed(0)}% vs doing nothing`],
    ['Savings reserve', chfShort(row.cash_closing), `Doing nothing: ${chfShort(row.cash_closing_baseline)}`],
  ];
  return (
    <dl className="flex shrink-0 flex-col divide-y text-sm">
      {items.map(([label, value, note]) => (
        <div key={label} className="flex items-baseline justify-between gap-3 py-2 first:pt-0">
          <dt className="flex flex-col"><span className="text-muted-foreground">{label}</span><span className="text-xs text-muted-foreground">{note}</span></dt>
          <dd className="font-semibold tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function PlanList({ play }: { play: Play }) {
  const { state, catalog, busy } = play;
  if (!state) return null;
  const row = (swap: SessionSwap, action: ReactNode, key: string) => (
    <li key={key} className="flex items-start gap-2 text-xs">
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="font-medium">{groupLabels[swap.group] ?? swap.group}: {optionName(catalog, swap.group, swap.option)}</span>
        <span className="text-muted-foreground">{whereLabel(catalog, swap)} · {whenLabel(swap.year, state.t)}</span>
      </div>
      {action}
    </li>
  );
  return (
    <section aria-labelledby="game-plan-heading" className="flex shrink-0 flex-col gap-2">
      <h2 id="game-plan-heading" className="text-sm font-semibold">Your plan</h2>
      {state.plan.done.length + state.plan.planned.length === 0 ? (
        <p className="text-xs text-muted-foreground">No changes yet. Click equipment in 3D, or pick it above.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {state.plan.done.map((swap, k) => row(swap, <Lock className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-label="Done, can't change" />, `d${k}`))}
          {!state.ended && state.plan.planned.map((swap, k) => row(swap,
            <Button size="icon-xs" variant="ghost" disabled={busy !== null} aria-label="Remove from the plan" onClick={() => play.removePlanned(k)}><X /></Button>,
            `p${k}`))}
        </ul>
      )}
    </section>
  );
}

function End({ state }: { state: SessionState }) {
  const r = state.result;
  const last = state.history.at(-1);
  if (!r || !last) return null;
  return (
    <section className="flex shrink-0 flex-col gap-1 rounded-lg border bg-card p-4">
      <h2 className="text-sm font-semibold">{state.horizon} years done</h2>
      <p className="text-3xl font-semibold tracking-tight tabular-nums">{signedChf(gained(last))}</p>
      <p className="text-xs text-pretty text-muted-foreground">
        Gained compared with doing nothing in the same {state.horizon} years, after paying for your changes.
        {Math.abs(last.residual_value ?? 0) >= 1000 && ` Your new equipment is still worth ${chfShort(last.residual_value)} on top.`}
        {' '}Reserve at the end: {chf(r.reserve_at_end)} (doing nothing: {chf(r.reserve_at_end_doing_nothing)}).
      </p>
    </section>
  );
}

type Props = {
  play: Play;
  floor: number | null;
  onFloorChange: (floor: number | null) => void;
  selectedGroup: string | null;
  onSelectGroup: (group: string | null) => void;
};

export default function PlayPanel({ play, floor, onFloorChange, selectedGroup, onSelectGroup }: Props) {
  const { state, catalog, busy, error } = play;
  const navigate = useNavigate();
  const [years, setYears] = useState<(typeof LENGTHS)[number]>(10);
  const [story, setStory] = useState<'demo' | 'surprise'>('demo');

  function start() {
    play.start(story === 'demo' ? DEMO_FUTURE : { seed: Math.floor(Math.random() * 1e6) }, years);
  }

  /** Results, with the game as a plan and the future it played shown first. */
  function seeHowYouDid() {
    if (!state) return;
    const config = { plans: [{ name: 'Your path', scenario: state.decisions, color: PLAN_COLORS[0] }], selected: 0,
                     events: [], game: state.session_id, horizon: state.horizon };
    navigate(`/results?config=${encodeURIComponent(JSON.stringify(config))}`, { state: { intro: true } });
  }

  const title = !state ? 'Explore the next years' : state.ended ? 'The end' : state.t === 0 ? 'Today' : `End of year ${state.t}`;

  return (
    <aside aria-label="Explore" className="flex min-h-0 min-w-0 flex-col border-t bg-background md:border-t-0 md:border-l">
      <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b px-4">
        <h2 className="text-sm font-semibold">
          {title}{state && !state.ended && <span className="font-normal text-muted-foreground"> of {state.horizon}</span>}
        </h2>
        {state && (
          <button type="button" onClick={play.restart} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <RotateCcw aria-hidden="true" className="size-3.5" /> Start over
          </button>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 p-4 pb-8 md:overflow-y-auto md:[mask-image:linear-gradient(to_bottom,black_calc(100%-1.5rem),transparent)] md:overscroll-contain md:[scrollbar-gutter:stable]">
        {error && <Alert variant="destructive"><TriangleAlert /><AlertTitle>{error}</AlertTitle></Alert>}
        {!state ? (
          <>
            <p className="text-sm text-pretty text-muted-foreground">
              Live through the building’s next years. Your plan runs until something happens, like a breakdown, news or a
              price shock. Then you decide. What has happened can’t be undone. At the end you see how your choices did,
              against doing nothing and against 200 other possible futures.
            </p>
            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold">How long</h3>
              <Segments label="How long" options={LENGTHS} value={years} onChange={setYears} text={y => `${y} years`} />
            </section>
            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold">Which future</h3>
              <Segments label="Which future" options={['demo', 'surprise'] as const} value={story} onChange={setStory}
                text={s => (s === 'demo' ? 'The demo story' : 'A surprise')} />
              <p className="text-xs text-muted-foreground">
                {story === 'demo' ? 'A new lab, a ventilation breakdown, a heatwave and a price spike. The same every time.'
                  : 'One random future: prices, events and breakdowns drawn like in Results.'}
              </p>
            </section>
          </>
        ) : (
          <>
            <YearBar t={state.t} horizon={state.horizon} />
            {state.ended && <End state={state} />}
            <Numbers state={state} />
            {state.history.length > 0 && (
              <PlayChart history={state.history} horizon={state.horizon} now={state.t} ended={state.ended} className="h-36 shrink-0" />
            )}
            {!state.ended && <WhatHappened state={state} catalog={catalog} busy={busy !== null} onDecide={play.decide} />}
            {!state.ended && (selectedGroup ? (
              <ChangeNow key={`${selectedGroup}|${floor}`} state={state} catalog={catalog} group={selectedGroup} floor={floor}
                busy={busy !== null} onDecide={play.decide} onClose={() => onSelectGroup(null)} />
            ) : (
              <section aria-labelledby="change-heading" className="flex shrink-0 flex-col gap-2">
                <h2 id="change-heading" className="text-sm font-semibold">Change something now</h2>
                <Segments label="Floor" options={levels} value={floor} onChange={onFloorChange} text={shortLevel} />
                <div className="flex flex-wrap gap-1.5">
                  {viewGroups(floor).map(group => (
                    <Button key={group} size="sm" variant="outline" onClick={() => onSelectGroup(group)}>{groupLabels[group]}</Button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">{levelName(floor)}. Or click an outlined part in 3D.</p>
              </section>
            ))}
            <PlanList play={play} />
          </>
        )}
      </div>

      <footer className="flex shrink-0 flex-col gap-2 border-t bg-background px-4 py-3.5">
        {!state ? (
          <Button size="lg" className="w-full justify-between" disabled={busy !== null} onClick={start}>
            Start exploring
            {busy === 'start' ? <Spinner data-icon="inline-end" /> : <ArrowRight data-icon="inline-end" />}
          </Button>
        ) : state.ended ? (
          <Button size="lg" className="w-full justify-between" onClick={seeHowYouDid}>
            See how you did
            <ArrowRight data-icon="inline-end" />
          </Button>
        ) : (
          <Button size="lg" className="w-full justify-between" disabled={busy !== null} onClick={play.next}>
            {state.t === 0 ? 'Start the clock' : 'Continue'}
            {busy === 'next' ? <Spinner data-icon="inline-end" /> : <ArrowRight data-icon="inline-end" />}
          </Button>
        )}
      </footer>
    </aside>
  );
}
