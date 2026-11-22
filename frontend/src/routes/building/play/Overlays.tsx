// Cards that sit over the 3D building in Explore, the way a strategy game shows them: a start card, a card for
// each stop (what happened and what you can do), and an end card. The building stays visible around them.
import { ArrowRight, ChartSpline, ChevronDown, Hourglass, RotateCcw, Wrench } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import type { SessionState } from '@/api/types';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';
import AnimatedNumber from '@/routes/results/AnimatedNumber';
import type { Plan } from '@/twin/plans';
import { chf, chfShort, gained, signedChf } from './format';
import type { PathPlan } from './usePathPlan';
import { Story } from './WhatHappened';

const card = 'play-pop flex flex-col rounded-xl border bg-card shadow-[0_1px_2px_oklch(0_0_0/0.06),0_16px_40px_-16px_oklch(0.3_0.02_60/0.35)]';

function Backdrop({ children }: { children: ReactNode }) {
  return <div className="absolute inset-0 z-10 grid place-items-center overflow-y-auto bg-background/45 p-4 backdrop-blur-[2px]">{children}</div>;
}

function Choice<T extends string | number>({ label, options, value, onChange }: {
  label: string; options: { value: T; text: string }[]; value: T; onChange: (value: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="grid gap-0.5 rounded-lg bg-secondary p-0.5 shadow-[inset_0_0_0_1px_var(--border)]"
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map(option => (
        <button key={String(option.value)} type="button" role="radio" aria-checked={option.value === value} onClick={() => onChange(option.value)}
          className={cn('h-9 truncate rounded-md px-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-ring',
            option.value === value ? 'bg-card text-foreground shadow-[0_1px_2px_oklch(0_0_0/0.08),inset_0_0_0_1px_var(--border)]' : 'text-muted-foreground hover:text-foreground')}>
          {option.text}
        </button>
      ))}
    </div>
  );
}

const STEPS = [
  { icon: Hourglass, title: 'Time runs', text: 'Year after year. It stops only when there is a decision worth making.' },
  { icon: Wrench, title: 'You decide', text: 'A breakdown, news or a price jump: pick what to do.' },
  { icon: ChartSpline, title: 'See how you did', text: 'Against doing nothing, and against 200 other futures.' },
];

export const LENGTHS = [5, 10, 15] as const;

export function StartCard({ plan, busy, onStart }: {
  /** The plan being edited, offered as a starting point when it has changes. */
  plan: Plan;
  busy: boolean;
  onStart: (years: number, withPlan: boolean) => void;
}) {
  const [years, setYears] = useState<number>(10);
  const [withPlan, setWithPlan] = useState(false);
  const hasPlan = plan.scenario.length > 0;
  return (
    <Backdrop>
      <section aria-labelledby="start-heading" className={cn(card, 'w-full max-w-[34rem] gap-6 p-7')}>
        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium tracking-wide text-primary uppercase">Explore</span>
          <h1 id="start-heading" className="text-[28px] leading-9 font-semibold tracking-tight text-balance">Live through the building’s next {years} years</h1>
          <p className="text-sm text-pretty text-muted-foreground">Every run draws a new future. What has happened can’t be undone.</p>
        </div>
        <ol className="grid grid-cols-3 gap-3">
          {STEPS.map(({ icon: Icon, title, text }, k) => (
            <li key={title} className="flex flex-col gap-2 rounded-lg bg-secondary/60 p-3">
              <span className="flex items-center gap-2">
                <span className="grid size-7 place-items-center rounded-md bg-card text-primary shadow-[inset_0_0_0_1px_var(--border)]"><Icon aria-hidden="true" className="size-4" /></span>
                <span className="text-xs text-muted-foreground tabular-nums">{k + 1}</span>
              </span>
              <span className="text-sm font-semibold">{title}</span>
              <span className="text-xs text-pretty text-muted-foreground">{text}</span>
            </li>
          ))}
        </ol>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold">How long</h2>
            <Choice label="How long" value={years} onChange={setYears} options={LENGTHS.map(y => ({ value: y, text: `${y} years` }))} />
          </div>
          {hasPlan && (
            <div className="flex flex-col gap-2">
              <h2 className="text-sm font-semibold">Start with</h2>
              <Choice label="Start with" value={withPlan ? 'plan' : 'none'} onChange={v => setWithPlan(v === 'plan')}
                options={[{ value: 'none', text: 'Nothing planned' }, { value: 'plan', text: plan.name }]} />
              {withPlan && <p className="text-xs text-muted-foreground">Its changes are already decided. You can still change them at every stop.</p>}
            </div>
          )}
        </div>
        <Button size="lg" className="h-11 w-full justify-between text-base" disabled={busy} onClick={() => onStart(years, withPlan && hasPlan)}>
          Start exploring
          {busy ? <Spinner data-icon="inline-end" /> : <ArrowRight data-icon="inline-end" />}
        </Button>
      </section>
    </Backdrop>
  );
}

/** What happened at this stop, as a short story over the building. Choices are made in the panel on the right. */
export function EventCard({ state }: { state: SessionState }) {
  const [open, setOpen] = useState(true);
  const when = state.t === 0 ? 'Today' : `Year ${state.t}`;
  const failure = state.reasons.some(r => r.type === 'failure');
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        className="play-pop absolute top-3 right-3 z-10 flex h-10 max-w-[min(26rem,calc(100%-1.5rem))] items-center gap-2 rounded-lg border bg-card px-3 text-sm font-medium shadow-[0_4px_12px_-6px_oklch(0.3_0.02_60/0.3)] hover:bg-secondary">
        <span className={cn('size-2 shrink-0 rounded-full', failure ? 'bg-destructive' : 'bg-primary')} />
        <span className="truncate">{when}: {state.reasons[0]?.title}</span>
        <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
      </button>
    );
  }
  return (
    <section aria-label={`What happened: ${when}`}
      className={cn(card, 'absolute top-3 right-3 z-10 max-h-[calc(100%-1.5rem)] w-[min(26rem,calc(100%-1.5rem))] gap-4 p-5')}>
      <span className="text-xs font-medium text-muted-foreground">{when} · the clock stopped</span>
      <div className="min-h-0 overflow-y-auto overscroll-contain"><Story state={state} /></div>
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-muted-foreground">{failure ? 'Choose a replacement on the right.' : 'Act on the right, or just continue.'}</span>
        <Button variant="outline" onClick={() => setOpen(false)}>Got it</Button>
      </div>
    </section>
  );
}

export function EndCard({ state, path, onAgain }: { state: SessionState; path: PathPlan; onAgain: () => void }) {
  const r = state.result;
  const last = state.history.at(-1);
  if (!r || !last) return null;
  const total = gained(last);
  return (
    <Backdrop>
      <section aria-labelledby="end-heading" className={cn(card, 'w-full max-w-[34rem] gap-5 p-7')}>
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium tracking-wide text-primary uppercase">{state.horizon} years done</span>
          <h1 id="end-heading" className="text-sm text-muted-foreground">Compared with doing nothing, after paying for your changes</h1>
          <p className={cn('text-[44px] leading-tight font-semibold tracking-tight', total > 500 ? 'text-[var(--positive)]' : total < -500 ? 'text-destructive' : 'text-foreground')}>
            <AnimatedNumber value={total} format={signedChf} ms={1200} />
          </p>
        </div>
        <dl className="grid grid-cols-3 divide-x border-y py-3 text-sm">
          <div className="flex flex-col gap-0.5 pr-3"><dt className="text-xs text-muted-foreground">Changes made</dt><dd className="text-lg font-semibold tabular-nums">{r.decisions}</dd></div>
          <div className="flex flex-col gap-0.5 px-3"><dt className="text-xs text-muted-foreground">Reserve at the end</dt><dd className="text-lg font-semibold tabular-nums">{chfShort(r.reserve_at_end)}</dd></div>
          <div className="flex flex-col gap-0.5 pl-3"><dt className="text-xs text-muted-foreground">Doing nothing</dt><dd className="text-lg font-semibold tabular-nums">{chfShort(r.reserve_at_end_doing_nothing)}</dd></div>
        </dl>
        <p className="text-sm text-pretty text-muted-foreground">
          That is one future: a story. Results tests the same path in 200 futures, to show the odds.
          {Math.abs(last.residual_value ?? 0) >= 1000 && ` Your new equipment is still worth ${chf(last.residual_value)} on top.`}
        </p>
        <div className="flex flex-col gap-2">
          <Button size="lg" className="h-11 w-full justify-between text-base" onClick={path.seeResults}>
            See it across 200 futures <ArrowRight data-icon="inline-end" />
          </Button>
          <Button size="lg" variant="outline" className="h-11 w-full justify-between" onClick={onAgain}>
            Play a new future <RotateCcw data-icon="inline-end" />
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          {path.plan ? <>Kept as the plan <span className="font-medium text-foreground">{path.plan.name}</span>. Find it in Building and Results.</>
            : path.canSave ? 'Your path is kept as a plan when you open Results.' : 'You made no changes, so there is no plan to keep.'}
        </p>
      </section>
    </Backdrop>
  );
}
