import { CalendarClock, Check, Megaphone, TrendingUp, TriangleAlert, Wrench } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '@/api/client';
import type {
  Catalog, FailureReaction, GroupReaction, PauseReason, PlaySwap, SessionPreview, SessionState,
} from '@/api/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { chf, groupLabels, optionName, signedChf, whenLabel } from './format';
import OptionRow from './OptionRow';

const ICONS = {
  failure: Wrench,
  event_announced: Megaphone,
  event_started: CalendarClock,
  new_flag: TriangleAlert,
  price_jump: TrendingUp,
} as const;

const TIERS = ['current', 'budget', 'mid', 'premium', 'upgrade'];

/** "lighting", "coffee machines", but "3D printers": lower case inside a sentence, except the acronym. */
const inSentence = (group: string) => {
  const label = groupLabels[group] ?? group;
  return label.startsWith('3D') ? label : label.toLowerCase();
};

type Props = {
  state: SessionState;
  catalog: Catalog | null;
  busy: boolean;
  onDecide: (swaps: PlaySwap[]) => void;
};

function explanation(reason: PauseReason): string | null {
  if (reason.type === 'failure') return 'It stopped working. Pick what goes in now: this is an emergency purchase, so it costs a little more.';
  if (reason.type === 'event_announced' || reason.type === 'event_started') return String(reason.details.description ?? '') || null;
  if (reason.type === 'new_flag' && reason.details.flag === 'reserve_below_minimum') {
    return 'Your spending has pushed the building reserve below its minimum.';
  }
  return null;
}

/** A breakdown: every option for the broken units, compared with buying the same model again. */
function Replacements({ reaction, state, catalog, busy, onDecide }: Props & { reaction: FailureReaction }) {
  const same = reaction.options.find(option => option.like_for_like) ?? reaction.options[0];
  const items = new Set(same.swaps.map(swap => swap.item_id));
  // The option going in now: the newest decision for these units at this moment, or the same model.
  const decided = [...state.plan.planned].reverse().find(d => d.year === state.t && d.item_id && items.has(d.item_id));
  const chosen = decided?.option ?? same.option_id;
  const options = [...reaction.options].sort((a, b) =>
    Number(b.like_for_like) - Number(a.like_for_like) || TIERS.indexOf(a.tier) - TIERS.indexOf(b.tier));
  return (
    <div className="flex flex-col gap-2">
      {reaction.planned_later.length > 0 && (
        <p className="text-sm text-muted-foreground">
          You had planned {reaction.planned_later.map(d => `${optionName(catalog, d.group, d.option)} for the ${whenLabel(d.year, state.t)}`).join(', ')}.
          Choosing now replaces that.
        </p>
      )}
      <ul className="flex flex-col gap-2">
        {options.map(option => {
          const extra = option.preview.extra_capex_chf - same.preview.extra_capex_chf;
          const yearly = -((option.preview.delta_operating_cost ?? 0) - (same.preview.delta_operating_cost ?? 0));
          const isChosen = option.option_id === chosen;
          return (
            <li key={option.option_id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border bg-background p-2.5">
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  {option.name}
                  {option.like_for_like && <Badge variant="secondary">Same model</Badge>}
                </span>
                <span className="text-xs text-muted-foreground">
                  {option.like_for_like ? 'What goes in if you just continue.'
                    : `${signedChf(extra)} up front vs the same model · ${yearly >= 0 ? `saves ${chf(yearly)} a year` : `costs ${chf(-yearly)} more a year`}`}
                </span>
              </div>
              {isChosen ? (
                <Badge><Check data-icon="inline-start" />Chosen</Badge>
              ) : (
                <Button size="sm" variant="outline" disabled={busy} onClick={() => onDecide(option.swaps)}>Choose</Button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** News or a warning: options for the most relevant equipment, each with its cost, to add now. */
function Suggestions({ reaction, state, catalog, busy, onDecide }: Props & { reaction: GroupReaction }) {
  const [main, ...others] = reaction.groups;
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
      <ul className="flex flex-col gap-2">
        {main.options.map(option => (
          <OptionRow key={option} title={`${groupLabels[main.group] ?? main.group}: ${optionName(catalog, main.group, option)}`}
            preview={previews[option]} inPlan={inPlan(option)} busy={busy} onAdd={() => onDecide([swapFor(option)])} />
        ))}
      </ul>
      {others.length > 0 && (
        <p className="text-sm text-muted-foreground">
          Also worth a look: {[...new Set(others.map(g => inSentence(g.group)))].join(', ')}.
        </p>
      )}
    </div>
  );
}

export default function WhatHappened(props: Props) {
  const { state } = props;
  if (state.t === 0 && state.reasons.length === 0) {
    return (
      <p className="shrink-0 text-sm text-pretty text-muted-foreground">
        Nothing has happened yet. Change equipment if you like, then press Start the clock: the years run until something happens.
      </p>
    );
  }
  return (
    <section aria-labelledby="happened-heading" className="flex shrink-0 flex-col gap-3">
      <h2 id="happened-heading" className="text-sm font-semibold">What happened</h2>
      {state.reasons.map((reason, index) => {
        const Icon = ICONS[reason.type];
        const reaction = state.reactions.find(r => r.reason === index);
        const text = explanation(reason);
        return (
          <div key={`${reason.type}-${reason.title}`} className="flex flex-col gap-2 rounded-lg border bg-card p-3">
            <div className="flex gap-2.5">
              <Icon className={reason.type === 'failure' ? 'mt-0.5 size-4 shrink-0 text-destructive' : 'mt-0.5 size-4 shrink-0 text-primary'} aria-hidden />
              <div className="flex flex-col gap-0.5">
                <h3 className="text-sm font-medium text-pretty">{reason.title}</h3>
                {text && <p className="text-xs text-pretty text-muted-foreground">{text}</p>}
              </div>
            </div>
            {reaction?.type === 'failure' && <Replacements {...props} reaction={reaction} />}
            {reaction && reaction.type !== 'failure' && <Suggestions {...props} reaction={reaction} />}
          </div>
        );
      })}
      {(state.routine?.length ?? 0) > 0 && (
        <p className="text-xs text-pretty text-muted-foreground">
          Also worn out since the last stop and replaced like-for-like:{' '}
          {[...new Set(state.routine!.map(r => inSentence(r.group)))].join(', ')}.
        </p>
      )}
    </section>
  );
}
