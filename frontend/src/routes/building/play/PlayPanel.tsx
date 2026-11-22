// The right-hand panel in Explore: change equipment now, and your path so far (kept as a plan if you like).
// What happened at each stop shows in a card over the building; the year and numbers in the strip above it.
import { ArrowRight, BookmarkPlus, ChevronDown, Lock, RotateCcw, TriangleAlert, X } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import type { SessionSwap } from '@/api/types';
import { Alert, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { FLOOR_COUNT } from '@/data/building';
import { cn } from '@/lib/utils';
import { levelName } from '../PlanPins';
import ChangeNow from './ChangeNow';
import { groupLabels, optionName, whenLabel, whereLabel } from './format';
import type { PathPlan } from './usePathPlan';
import type { Play } from './usePlay';
import WhatHappened from './WhatHappened';

const levels: (number | null)[] = [null, ...Array.from({ length: FLOOR_COUNT + 1 }, (_, index) => FLOOR_COUNT - 1 - index)];
const shortLevel = (level: number | null) => level === null ? 'All' : level === 0 ? 'G' : level === -1 ? 'B' : String(level);

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

function PlanList({ play, path }: { play: Play; path: PathPlan }) {
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
      <div className="flex h-8 items-center justify-between gap-2">
        <h2 id="game-plan-heading" className="text-sm font-semibold">Your path</h2>
        {path.plan ? (
          <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            <span className="size-2 shrink-0 rounded-[3px]" style={{ background: path.plan.color }} />
            <span className="truncate">Kept as {path.plan.name}</span>
          </span>
        ) : path.canSave && (
          <Button size="xs" variant="outline" disabled={path.full} onClick={path.save} title={path.full ? 'Six plans already: remove one in Results first.' : undefined}>
            <BookmarkPlus data-icon="inline-start" /> Keep as a plan
          </Button>
        )}
      </div>
      {path.plan && <p className="-mt-1 text-xs text-muted-foreground">Every move you make updates this plan in Building and Results.</p>}
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

type Props = {
  play: Play;
  path: PathPlan;
  floor: number | null;
  onFloorChange: (floor: number | null) => void;
  selectedGroup: string | null;
  onSelectGroup: (group: string | null) => void;
};

/** The right-hand panel while a run is on: change anything now, your path so far, and the button that moves time on. */
export default function PlayPanel({ play, path, floor, onFloorChange, selectedGroup, onSelectGroup }: Props) {
  const { state, catalog, busy, error } = play;
  const [more, setMore] = useState(false);
  const stop = state ? `${state.session_id}|${state.t}` : '';
  useEffect(() => setMore(false), [stop]);
  if (!state) return null;
  // While a stop asks for a decision, other changes fold into one row, so the decision stands out.
  const folded = state.reasons.length > 0 && !more && !selectedGroup;
  return (
    <aside aria-label="Explore" className="flex min-h-0 min-w-0 flex-col border-t border-[var(--r-line)] bg-[var(--r-panel)] md:border-t-0 md:border-l">
      <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-[var(--r-divider)] px-5">
        <h2 className="text-sm font-semibold">{state.ended ? 'Done' : 'Your moves'}</h2>
        <Button variant="ghost" size="xs" className="text-muted-foreground hover:text-foreground" onClick={play.restart}>
          <RotateCcw data-icon="inline-start" /> Start over
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-6 p-5 pb-8 md:overflow-y-auto md:overscroll-contain md:[scrollbar-gutter:stable]">
        {error && <Alert variant="destructive"><TriangleAlert /><AlertTitle>{error}</AlertTitle></Alert>}
        {!state.ended && state.t === 0 && state.reasons.length === 0 && (
          <p className="rounded-lg border border-dashed border-[var(--r-line)] p-3 text-sm text-pretty text-muted-foreground">
            Make changes today if you like, then press <span className="font-medium text-foreground">Start the clock</span>.
            The years run until something happens.
          </p>
        )}
        {!state.ended && state.reasons.length > 0 && (
          <WhatHappened state={state} catalog={catalog} busy={busy !== null} onDecide={play.decide} />
        )}
        {!state.ended && folded && (
          <button type="button" onClick={() => setMore(true)}
            className="flex h-10 shrink-0 items-center justify-between rounded-lg border border-dashed border-[var(--r-line)] px-3 text-sm font-medium text-muted-foreground hover:border-foreground/30 hover:text-foreground">
            Change something else <ChevronDown aria-hidden="true" className="size-4" />
          </button>
        )}
        {!state.ended && !folded && (selectedGroup ? (
          <ChangeNow key={`${selectedGroup}|${floor}`} state={state} catalog={catalog} group={selectedGroup} floor={floor}
            busy={busy !== null} onDecide={play.decide} onClose={() => onSelectGroup(null)} />
        ) : (
          <section aria-labelledby="change-heading" className="flex shrink-0 flex-col gap-3">
            <h2 id="change-heading" className="text-sm font-semibold">{state.reasons.length > 0 ? "Change something else" : "Change something now"}</h2>
            <Segments label="Floor" options={levels} value={floor} onChange={onFloorChange} text={shortLevel} />
            <div className="grid grid-cols-2 gap-1.5">
              {viewGroups(floor).map(group => (
                <Button key={group} variant="outline" className="justify-start bg-card" onClick={() => onSelectGroup(group)}>{groupLabels[group]}</Button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">{levelName(floor)}. Or click an outlined part in 3D.</p>
          </section>
        ))}
        <PlanList play={play} path={path} />
      </div>

      <footer className="flex shrink-0 flex-col gap-2 border-t border-[var(--r-divider)] px-5 py-4">
        {state.ended ? (
          <Button size="lg" className="h-11 w-full justify-between text-base" onClick={path.seeResults}>
            See it across 200 futures <ArrowRight data-icon="inline-end" />
          </Button>
        ) : (
          <Button size="lg" className="h-11 w-full justify-between text-base" disabled={busy !== null} onClick={play.next}>
            {state.t === 0 ? 'Start the clock' : 'Continue'}
            <span className="flex items-center gap-2">
              <kbd className="grid h-5 place-items-center rounded border border-white/30 px-1.5 font-mono text-[11px] text-primary-foreground/80">Space</kbd>
              {busy === 'next' ? <Spinner /> : <ArrowRight />}
            </span>
          </Button>
        )}
      </footer>
    </aside>
  );
}
