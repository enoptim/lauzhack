// The right-hand panel in play mode: the year, what happened, what you can do, and your plan.
// Same frame as the inspector (header, scrolling body, footer button), so switching modes feels like one screen.
import { ArrowRight, Dices, Lock, Play as PlayIcon, RotateCcw, TriangleAlert, X } from 'lucide-react';
import type { ReactNode } from 'react';
import type { SessionState, SessionSwap } from '@/api/types';
import { Alert, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { FLOOR_COUNT } from '@/data/building';
import { cn } from '@/lib/utils';
import ChangeNow from './ChangeNow';
import { chf, chfShort, groupLabels, mwh, optionName, signedChf, whenLabel, whereLabel } from './format';
import PlayChart from './PlayChart';
import { DEMO_FUTURE, type Play } from './usePlay';
import WhatHappened from './WhatHappened';

const floors = Array.from({ length: FLOOR_COUNT + 1 }, (_, index) => FLOOR_COUNT - 1 - index);
const floorName = (floor: number) => floor === -1 ? 'Basement' : floor === 0 ? 'Ground floor' : `Floor ${floor}`;

/** Equipment you can change from each view. The whole-building view offers everything, for the whole building. */
function viewGroups(floor: number | null): string[] {
  if (floor === null) return ['lighting', 'ventilation', 'solar_pv', 'blinds', 'computers', 'monitors', 'coffee', 'water_heater', 'servers'];
  if (floor === -1) return ['water_heater', 'servers'];
  return floor === FLOOR_COUNT - 1 ? ['lighting', 'monitors', 'computers', 'coffee'] : ['lighting', 'monitors', 'computers'];
}

type Props = {
  play: Play;
  floor: number | null;
  onFloorChange: (floor: number | null) => void;
  selectedGroup: string | null;
  onSelectGroup: (group: string | null) => void;
};

function YearBar({ t, horizon }: { t: number; horizon: number }) {
  return (
    <ol className="flex gap-0.5" aria-label={`Year ${t} of ${horizon}`}>
      {Array.from({ length: horizon }, (_, k) => k + 1).map(year => (
        <li key={year} title={`Year ${year}`} className={cn('h-1.5 flex-1 rounded-full', year <= t ? 'bg-primary' : 'bg-muted')} />
      ))}
    </ol>
  );
}

function Numbers({ state }: { state: SessionState }) {
  const row = state.history.at(-1);
  if (!row) return null;
  const change = row.kwh_baseline ? (row.kwh / row.kwh_baseline - 1) * 100 : 0;
  const items = [
    ['Money vs doing nothing', signedChf(row.cumulative_cash_cf), 'so far, purchases included'],
    [`Electricity in year ${row.year}`, mwh(row.kwh), Math.abs(change) < 0.5 ? 'same as doing nothing' : `${change < 0 ? '' : '+'}${change.toFixed(0)}% vs doing nothing`],
    ['Building reserve', chf(row.cash_closing), `doing nothing: ${chfShort(row.cash_closing_baseline)}`],
  ];
  return (
    <dl className="grid shrink-0 grid-cols-[auto_1fr] items-baseline gap-x-3 gap-y-1.5 text-sm">
      {items.map(([label, value, note]) => (
        <div key={label} className="contents">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="text-right"><span className="font-semibold tabular-nums">{value}</span><br /><span className="text-xs text-muted-foreground">{note}</span></dd>
        </div>
      ))}
    </dl>
  );
}

function PlanList({ play }: { play: Play }) {
  const { state, catalog, busy } = play;
  if (!state) return null;
  const row = (swap: SessionSwap, action: ReactNode, k: number) => (
    <li key={k} className="flex items-start gap-2 text-xs">
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="font-medium">{groupLabels[swap.group] ?? swap.group}: {optionName(catalog, swap.group, swap.option)}</span>
        <span className="text-muted-foreground">{whereLabel(catalog, swap)} · {whenLabel(swap.year, state.t)}</span>
      </div>
      {action}
    </li>
  );
  return (
    <section aria-labelledby="plan-heading" className="flex flex-col gap-2">
      <h2 id="plan-heading" className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">Your plan</h2>
      {state.plan.done.length + state.plan.planned.length === 0 ? (
        <p className="text-xs text-muted-foreground">No changes yet. Click equipment in 3D to change it.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {state.plan.done.map((swap, k) => row(swap, <Lock className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-label="Done, can't change" />, k))}
          {!state.ended && state.plan.planned.map((swap, k) => row(swap,
            <Button size="icon-xs" variant="ghost" disabled={busy !== null} aria-label="Remove from the plan" onClick={() => play.removePlanned(k)}><X /></Button>,
            1000 + k))}
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
    <section className="flex flex-col gap-2 rounded-lg border bg-card p-4">
      <h2 className="font-semibold">15 years done</h2>
      <p className="text-3xl font-semibold tabular-nums">{signedChf(last.cumulative_cash_cf)}</p>
      <p className="text-xs text-muted-foreground">
        Gained compared with doing nothing in the same 15 years, after paying for your changes. In today’s money: {signedChf(r.npv_cash)}.
        Reserve at the end: {chf(r.reserve_at_end)} (doing nothing: {chf(r.reserve_at_end_doing_nothing)}).
      </p>
    </section>
  );
}

export default function PlayPanel({ play, floor, onFloorChange, selectedGroup, onSelectGroup }: Props) {
  const { state, catalog, busy, error } = play;
  const groups = viewGroups(floor);

  return (
    <aside aria-label="Play through the next 15 years" className="flex min-h-0 min-w-0 flex-col border-t bg-background md:border-t-0 md:border-l">
      <header className="flex shrink-0 items-center justify-between gap-2 border-b px-5 py-4">
        <h1 className="text-xl font-semibold tracking-tight">BC Building</h1>
        <Select value={floor === null ? 'all' : String(floor)} onValueChange={value => onFloorChange(value === 'all' ? null : Number(value))}>
          <SelectTrigger aria-label="Floor" className="w-36 max-w-[55%]"><SelectValue /></SelectTrigger>
          <SelectContent position="popper" align="end" className="w-(--radix-select-trigger-width)">
            <SelectGroup>
              <SelectItem value="all">Whole building</SelectItem>
              {floors.map(level => <SelectItem key={level} value={String(level)}>{floorName(level)}</SelectItem>)}
            </SelectGroup>
          </SelectContent>
        </Select>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-5 p-5 md:overflow-y-auto md:overscroll-contain md:[scrollbar-gutter:stable]">
        {error && <Alert variant="destructive"><TriangleAlert /><AlertTitle>{error}</AlertTitle></Alert>}
        {!state ? (
          <section className="flex flex-col gap-2">
            <h2 className="text-lg font-semibold">Play the next 15 years</h2>
            <p className="text-sm text-muted-foreground">
              Your plan runs year by year. When something happens, like a breakdown, news or a price shock, the game
              stops and you decide. What has happened can’t be undone. At the end you see how your choices compare
              with doing nothing.
            </p>
          </section>
        ) : (
          <>
            <section className="flex flex-col gap-2">
              <p className="text-lg font-semibold">
                {state.ended ? 'The end' : state.t === 0 ? 'Today' : `End of year ${state.t}`}
                {!state.ended && <span className="font-normal text-muted-foreground"> of {state.horizon}</span>}
              </p>
              <YearBar t={state.t} horizon={state.horizon} />
            </section>
            {state.ended && <End state={state} />}
            <Numbers state={state} />
            {state.history.length > 0 && (
              <PlayChart history={state.history} horizon={state.horizon} now={state.t} ended={state.ended} className="h-40 shrink-0" />
            )}
            {!state.ended && (
              <WhatHappened state={state} catalog={catalog} busy={busy !== null} onDecide={play.decide} />
            )}
            {!state.ended && (selectedGroup ? (
              <ChangeNow key={`${selectedGroup}|${floor}`} state={state} catalog={catalog} group={selectedGroup} floor={floor}
                busy={busy !== null} onDecide={play.decide} onClose={() => onSelectGroup(null)} />
            ) : (
              <section aria-labelledby="change-heading" className="flex flex-col gap-2">
                <h2 id="change-heading" className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                  Change something · {floor === null ? 'Whole building' : floorName(floor)}
                </h2>
                <div className="flex flex-wrap gap-1.5">
                  {groups.map(group => (
                    <Button key={group} size="sm" variant="outline" onClick={() => onSelectGroup(group)}>{groupLabels[group]}</Button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">Or click outlined equipment in 3D.</p>
              </section>
            ))}
            <PlanList play={play} />
          </>
        )}
      </div>

      <footer className="flex shrink-0 flex-col gap-2 border-t bg-background px-5 py-4">
        {!state ? (
          <>
            <Button size="lg" className="w-full" disabled={busy !== null} onClick={() => play.start(DEMO_FUTURE)}>
              {busy === 'start' ? <Spinner data-icon="inline-start" /> : <PlayIcon data-icon="inline-start" />}
              Play the demo story
            </Button>
            <Button variant="ghost" size="sm" disabled={busy !== null} onClick={() => play.start({ seed: Math.floor(Math.random() * 1e6) })}>
              <Dices data-icon="inline-start" />
              Or a surprise future
            </Button>
          </>
        ) : state.ended ? (
          <Button size="lg" className="w-full" variant="outline" onClick={play.restart}>
            <RotateCcw data-icon="inline-start" />
            Play again
          </Button>
        ) : (
          <Button size="lg" className="w-full" disabled={busy !== null} onClick={play.next}>
            {busy === 'next' && <Spinner data-icon="inline-start" />}
            {state.t === 0 ? 'Start the clock' : 'Continue'}
            <ArrowRight data-icon="inline-end" />
          </Button>
        )}
      </footer>
    </aside>
  );
}
