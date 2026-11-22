import { CalendarClock, ChevronDown, ChevronUp, Megaphone, TrendingUp, TriangleAlert, Wrench } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '@/api/client';
import type {
  Catalog, FailureReaction, GroupReaction, PauseReason, PlaySwap, SessionPreview, SessionState,
} from '@/api/types';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { chf, groupLabels, optionName, whenLabel } from './format';

const ICONS = {
  failure: Wrench,
  event_announced: Megaphone,
  event_started: CalendarClock,
  new_flag: TriangleAlert,
  price_jump: TrendingUp,
} as const;

const TIERS = ['current', 'budget', 'mid', 'premium', 'upgrade'];

type Props = {
  state: SessionState;
  catalog: Catalog | null;
  busy: boolean;
  onDecide: (swaps: PlaySwap[]) => void;
};

/** Why the clock stopped here, in plain words: what kind of moment this is and why it is worth a decision. */
function why(reason: PauseReason): { kind: string; text: string } {
  const d = reason.details;
  switch (reason.type) {
    case 'failure':
      return { kind: 'Breakdown · you must choose',
        text: 'Whatever goes in now stays for 15 years or more. That makes this the cheapest moment to upgrade: you only pay the difference to the same model.' };
    case 'event_announced':
      return { kind: 'News · time to prepare',
        text: `${String(d.description ?? '')} You can get ready now, or wait and react later.`.trim() };
    case 'event_started':
      return { kind: 'It starts now', text: String(d.description ?? '') || 'This changes how the building is used from now on.' };
    case 'price_jump': {
      const from = Number(d.price_from_chf_kwh), to = Number(d.price_to_chf_kwh);
      const prices = Number.isFinite(from) && Number.isFinite(to) ? `It goes from CHF ${from.toFixed(2)} to CHF ${to.toFixed(2)} per kWh. ` : '';
      return { kind: 'Price jump', text: `${prices}Every kWh you save is now worth more, so energy upgrades pay for themselves faster.` };
    }
    case 'new_flag':
      if (d.flag === 'desk_shortfall') return { kind: 'Warning · a limit was hit', text: 'There are more people than desks. Laptops with docking stations let people share desks.' };
      if (d.flag === 'ventilation_over_capacity') return { kind: 'Warning · a limit was hit', text: 'Not enough fresh air for the people on this floor: rooms get stuffy and CO₂ goes up.' };
      return { kind: 'Warning · money', text: 'Your spending has pushed the building reserve below its minimum.' };
  }
}

const perYear = (value: number) => value === 0 ? 'same running cost' : value > 0 ? `saves ${chf(value)}/yr` : `costs ${chf(-value)}/yr more`;

/** One option, as a row you pick: name on the left, what it costs now and saves each year on the right. */
function ChoiceRow({ name, note, cost, saving, checked, disabled, onPick }: {
  name: string; note?: string; cost: string; saving: string; checked: boolean; disabled: boolean; onPick: () => void;
}) {
  return (
    <li>
      <button type="button" role="radio" aria-checked={checked} disabled={disabled || checked} onClick={onPick} title={name}
        className={cn('grid w-full grid-cols-[1rem_minmax(0,1fr)_auto] items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-default',
          checked ? 'border-primary/60 bg-primary/6' : 'bg-card hover:border-foreground/25 disabled:opacity-60')}>
        <span aria-hidden="true" className={cn('grid size-4 place-items-center rounded-full border', checked ? 'border-primary' : 'border-foreground/30')}>
          {checked && <span className="size-2 rounded-full bg-primary" />}
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="line-clamp-2 text-sm leading-5 font-medium text-pretty">{name}</span>
          {note && <span className="truncate text-xs text-muted-foreground">{note}</span>}
        </span>
        <span className="flex flex-col items-end">
          <span className="text-sm font-medium whitespace-nowrap tabular-nums">{cost}</span>
          <span className="text-xs whitespace-nowrap text-muted-foreground tabular-nums">{saving}</span>
        </span>
      </button>
    </li>
  );
}

/** A breakdown: every option for the broken units. The same model goes in unless you pick another. */
function Replacements({ reaction, state, catalog, busy, onDecide }: Props & { reaction: FailureReaction }) {
  const same = reaction.options.find(option => option.like_for_like) ?? reaction.options[0];
  const items = new Set(same.swaps.map(swap => swap.item_id));
  const decided = [...state.plan.planned].reverse().find(d => d.year === state.t && d.item_id && items.has(d.item_id));
  const chosen = decided?.option ?? same.option_id;
  const options = [...reaction.options].sort((a, b) =>
    Number(b.like_for_like) - Number(a.like_for_like) || TIERS.indexOf(a.tier) - TIERS.indexOf(b.tier));
  return (
    <div className="flex flex-col gap-2">
      {reaction.planned_later.length > 0 && (
        <p className="text-xs text-muted-foreground">
          You had planned {reaction.planned_later.map(d => `${optionName(catalog, d.group, d.option)} for the ${whenLabel(d.year, state.t)}`).join(', ')}.
          Choosing now replaces that.
        </p>
      )}
      <p className="px-1 text-right text-xs text-muted-foreground">Compared with the same model</p>
      <ul role="radiogroup" aria-label="What goes in now" className="flex flex-col gap-1.5">
        {options.map(option => {
          const extra = option.preview.extra_capex_chf - same.preview.extra_capex_chf;
          const yearly = -((option.preview.delta_operating_cost ?? 0) - (same.preview.delta_operating_cost ?? 0));
          return (
            <ChoiceRow key={option.option_id} name={option.name} note={option.like_for_like ? 'Same model' : undefined}
              cost={option.like_for_like ? 'Base price' : Math.abs(extra) < 50 ? 'Same price' : extra > 0 ? `+${chf(extra)}` : `${chf(-extra)} cheaper`}
              saving={option.like_for_like ? 'Running cost as today' : perYear(yearly)}
              checked={option.option_id === chosen} disabled={busy} onPick={() => onDecide(option.swaps)} />
          );
        })}
      </ul>
    </div>
  );
}

/** News or a warning: optional upgrades for the most relevant equipment, each with its cost. */
function Suggestions({ reaction, state, catalog, busy, onDecide }: Props & { reaction: GroupReaction }) {
  const [main] = reaction.groups;
  const [previews, setPreviews] = useState<Record<string, SessionPreview>>({});
  const swapFor = (option: string): PlaySwap => ({ group: main.group, option, year: 'now',
    ...(main.floor !== null ? { floor: main.floor } : {}) });
  const key = `${state.session_id}|${state.t}|${JSON.stringify(state.decisions)}|${main?.group}|${main?.floor}`;
  useEffect(() => {
    if (!main) return;
    let stale = false;
    Promise.all(main.options.map(option => api.sessionPreview(state.session_id, swapFor(option))
      .then(preview => [option, preview] as const)))
      .then(entries => { if (!stale) setPreviews(Object.fromEntries(entries)); })
      .catch(() => undefined);
    return () => { stale = true; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!main) return null;
  const inPlan = (option: string) => [...state.plan.done, ...state.plan.planned]
    .some(d => d.group === main.group && d.option === option && (main.floor === null || d.floor === main.floor));
  return (
    <div className="flex flex-col gap-2">
    <ul className="flex flex-col gap-1.5">
      {main.options.map(option => {
        const preview = previews[option];
        return (
          <ChoiceRow key={option} name={`${groupLabels[main.group] ?? main.group}: ${optionName(catalog, main.group, option)}`}
            note={inPlan(option) ? 'In your plan' : 'Click to add it now'}
            cost={preview ? chf(preview.extra_capex_chf) : '…'} saving={preview ? perYear(-(preview.delta_operating_cost ?? 0)) : ''}
            checked={inPlan(option)} disabled={busy} onPick={() => onDecide([swapFor(option)])} />
        );
      })}
    </ul>
    </div>
  );
}

function stakeOf(reaction: FailureReaction | GroupReaction | undefined): number {
  if (reaction?.type !== 'failure') return 0;
  const same = reaction.options.find(o => o.like_for_like) ?? reaction.options[0];
  return Math.max(0, ...reaction.options.map(o => (same.preview.delta_operating_cost ?? 0) - (o.preview.delta_operating_cost ?? 0)));
}

/** Breakdowns first: they need an answer. */
function ordered(state: SessionState) {
  return state.reasons.map((reason, index) => ({ reason, index, reaction: state.reactions.find(r => r.reason === index) }))
    .sort((a, b) => Number(b.reason.type === 'failure') - Number(a.reason.type === 'failure'));
}

/** The card over the building: only what happened and why it matters. You act in the panel. */
export function Story({ state }: { state: SessionState }) {
  const items = ordered(state);
  return (
    <ul className="flex flex-col gap-2.5">
      {items.length > 1 && <li className="sr-only">{items.length} things happened</li>}
      {items.map(({ reason, reaction }, k) => {
        const Icon = ICONS[reason.type];
        const failure = reason.type === 'failure';
        const { kind, text } = why(reason);
        const stake = stakeOf(reaction);
        if (k > 0) {
          return (
            <li key={`${reason.type}-${reason.title}`} className="flex items-center gap-2 text-sm">
              <Icon aria-hidden className={cn('size-4 shrink-0', failure ? 'text-destructive' : 'text-primary')} />
              <span className="min-w-0 truncate" title={reason.title}>{reason.title}</span>
            </li>
          );
        }
        return (
          <li key={`${reason.type}-${reason.title}`} className="mb-1.5 flex items-start gap-3">
            <span className={cn('grid size-8 shrink-0 place-items-center rounded-lg', failure ? 'bg-destructive/10 text-destructive' : 'bg-primary/10 text-primary')}>
              <Icon className="size-4" aria-hidden />
            </span>
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className={cn('text-xs font-medium', failure ? 'text-destructive' : 'text-primary')}>{kind}</span>
              <h3 className="text-[15px] leading-6 font-semibold text-pretty">{reason.title}</h3>
              {k === 0 && text && <p className="text-sm text-pretty text-muted-foreground">{text}</p>}
              {k === 0 && stake >= 100 && <p className="text-sm font-medium">The best option saves up to {chf(stake)} a year.</p>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** The panel's "Decide now": options for each breakdown; related upgrades for news fold away. */
export default function WhatHappened(props: Props) {
  const items = ordered(props.state).filter(item => item.reaction);
  if (!items.length) return null;
  return (
    <section aria-labelledby="decide-heading" className="flex shrink-0 flex-col gap-4">
      <h2 id="decide-heading" className="text-sm font-semibold">Decide now</h2>
      {items.map(({ reason, reaction }) => (
        <Decision key={`${reason.type}-${reason.title}`} {...props} reason={reason} reaction={reaction!} />
      ))}
    </section>
  );
}

function Decision({ reason, reaction, ...props }: Props & { reason: PauseReason; reaction: FailureReaction | GroupReaction }) {
  const [open, setOpen] = useState(false);
  const failure = reaction.type === 'failure';
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className={cn('min-w-0 text-[13px] font-medium text-pretty', failure ? 'text-foreground' : 'text-muted-foreground')}>
          {failure ? `Replace: ${reason.title.replace(/ reached end of life.*$/, '')}` : reason.title.replace(/ \(year \d+\)$/, '')}
        </h3>
        {!failure && (
          <Button variant="ghost" size="xs" className="shrink-0 text-muted-foreground" aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? 'Hide' : 'Related upgrades'} {open ? <ChevronUp data-icon="inline-end" /> : <ChevronDown data-icon="inline-end" />}
          </Button>
        )}
      </div>
      {reaction.type === 'failure' && <Replacements {...props} reaction={reaction} />}
      {open && reaction.type !== 'failure' && <Suggestions {...props} reaction={reaction} />}
    </div>
  );
}
