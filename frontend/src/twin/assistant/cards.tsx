// Cards under the assistant's replies: the optimization it proposes (to confirm), and the plan it found.
// Every number comes from the API; this file only formats them.
import { Box, ChartSpline, Check, Play, TriangleAlert } from 'lucide-react';
import { chfShort } from '../format';
import { groupedChanges } from '../plans';
import type { ReactNode } from 'react';
import type {
  Catalog, ChatOptimization, ChatProposal, ChatScenario, MetricName, OptimizationProblem, ProblemConstraint,
} from '@/api/types';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';

const metricText: Record<MetricName, { label: string; unit: 'CHF' | 'kWh' | 'years' | 'ppm' | '°C' | 'days' | '' }> = {
  upfront_cost_chf: { label: 'upfront cost', unit: 'CHF' },
  extra_cost_vs_like_for_like_chf: { label: 'extra cost vs like-for-like', unit: 'CHF' },
  running_cost_chf_year: { label: 'running cost per year', unit: 'CHF' },
  energy_bill_chf_year: { label: 'energy bill per year', unit: 'CHF' },
  electricity_kwh_year: { label: 'electricity per year', unit: 'kWh' },
  npv_cash_chf: { label: 'value over 15 years', unit: 'CHF' },
  npv_economic_chf: { label: 'value incl. health and productivity', unit: 'CHF' },
  payback_years: { label: 'payback time', unit: 'years' },
  lowest_reserve_chf: { label: 'lowest building reserve', unit: 'CHF' },
  office_co2_ppm: { label: 'office CO₂', unit: 'ppm' },
  meeting_co2_ppm: { label: 'meeting-room CO₂', unit: 'ppm' },
  classroom_co2_ppm: { label: 'classroom CO₂', unit: 'ppm' },
  summer_overheating_degc: { label: 'summer overheating', unit: '°C' },
  sick_days: { label: 'sick days per person', unit: 'days' },
  comfort_score: { label: 'comfort score', unit: '' },
  warnings: { label: 'warnings', unit: '' },
  new_warnings: { label: 'new warnings', unit: '' },
};

// Doing nothing costs nothing up front and gains nothing, so "today" means nothing for these.
const noTodayValue = new Set<MetricName>(['upfront_cost_chf', 'extra_cost_vs_like_for_like_chf', 'npv_cash_chf', 'npv_economic_chf', 'payback_years', 'warnings', 'new_warnings']);

const flagText: Record<string, string> = {
  over_budget: 'Over budget',
  reserve_below_minimum: 'Reserve below minimum',
  ventilation_over_capacity: 'Ventilation over capacity',
  desk_shortfall: 'Not enough desks',
};

const number = (value: number, digits = 0) =>
  value.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: 0 });

function withUnit(value: number, unit: string) {
  if (unit === 'CHF') return `CHF ${number(Math.round(value / 100) * 100)}`;
  if (unit === 'kWh') return `${number(Math.round(value / 100) * 100)} kWh`;
  if (unit === 'years' || unit === '°C' || unit === 'days') return `${number(value, 1)} ${unit}`;
  return unit ? `${number(value)} ${unit}` : number(value, 1);
}

function limitText(c: ProblemConstraint) {
  const { label, unit } = metricText[c.metric];
  if (c.metric === 'warnings' && c.max === 0) return 'No warnings (over budget, reserve too low, …)';
  if (c.metric === 'new_warnings' && c.max === 0) return 'No new warnings (over budget, reserve too low, …)';
  const bound = c.max !== undefined ? c.max : c.min;
  const Label = label[0].toUpperCase() + label.slice(1);
  if (c.from_change_pct !== undefined && bound !== undefined) {
    const pct = c.from_change_pct;
    const side = pct < 0 ? 'below' : 'above';
    const atLeast = (c.max !== undefined) === (pct < 0);
    return `${Label} ${atLeast ? 'at least' : 'at most'} ${number(Math.abs(pct), 1)}% ${side} today (${c.max !== undefined ? 'at most' : 'at least'} ${withUnit(bound, unit)})`;
  }
  const parts = [];
  if (c.max !== undefined) parts.push(`at most ${withUnit(c.max, unit)}`);
  if (c.min !== undefined) parts.push(`at least ${withUnit(c.min, unit)}`);
  return `${Label} ${parts.join(' and ')}`;
}

/** A short name for a plan the assistant found, e.g. "Lowest electricity per year". */
export function planName(scenario: ChatScenario, optimization: ChatOptimization | null | undefined) {
  if (optimization) {
    const { metric, sense } = optimization.problem.objective;
    return `${sense === 'max' ? 'Highest' : 'Lowest'} ${metricText[metric].label.replace(/ per (year|person)$/, '')}`;
  }
  // The trade-off curve's balanced package: a name short enough for the pulse and the plan list.
  if (scenario.title === 'Balanced choice from the trade-off curve') return 'Balanced package';
  return scenario.title.length > 44 ? `${scenario.title.slice(0, 43)}…` : scenario.title;
}

function Rows({ rows }: { rows: [string, ReactNode, string?][] }) {
  return (
    <dl className="grid grid-cols-[minmax(4.5rem,auto)_1fr] gap-x-4 gap-y-2 text-sm">
      {rows.map(([label, value, note], index) => (
        <div key={`${label}-${index}`} className="contents">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="min-w-0 text-pretty">
            {value}
            {note && <span className="block text-xs text-muted-foreground">{note}</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function GoalRows({ problem, today, catalog }: {
  problem: OptimizationProblem;
  today?: ChatProposal['today'];
  catalog: Catalog | null;
}) {
  const { metric, sense } = problem.objective;
  const optionName = (id: string) =>
    Object.values(catalog?.groups ?? {}).flat().find(option => option.option_id === id)?.name ?? id;
  const groupName = (group: string) => {
    const words = group.replaceAll('_', ' ');
    return words[0].toUpperCase() + words.slice(1);
  };
  const now = (m: MetricName) => {
    const value = today?.[m];
    return value === undefined || value === null || noTodayValue.has(m) ? undefined : `Today ${withUnit(value, metricText[m].unit)}`;
  };
  const rows: [string, ReactNode, string?][] = [
    ['Goal', `${sense === 'max' ? 'Highest' : 'Lowest'} ${metricText[metric].label}`, now(metric)],
    ...(problem.constraints ?? []).map((c): [string, ReactNode, string?] => [
      'Limit', limitText(c), c.from_change_pct === undefined ? now(c.metric) : undefined]),
    ...(problem.locked ?? []).map((l): [string, ReactNode] => [
      'Keep', `${groupName(l.group)}${l.floor === undefined ? '' : ` on floor ${l.floor}`}, as today`]),
    ...Object.entries(problem.allowed ?? {}).map(([group, ids]): [string, ReactNode] => [
      'Only', `${groupName(group)}: ${ids.map(optionName).join(', ')}`]),
  ];
  if (problem.per_floor) rows.push(['Search', 'Floor by floor']);
  return <Rows rows={rows} />;
}

export type ProposalState = 'open' | 'running' | 'ran' | 'replaced';

/** "In 3D now" and "In Results now": the same quiet pressed look, hovered or not. */
const nowStyle = 'bg-secondary text-muted-foreground shadow-none hover:bg-secondary hover:text-muted-foreground';

const cardClass = 'w-full overflow-hidden rounded-xl border bg-card shadow-[0_1px_2px_oklch(0_0_0/0.04),0_6px_16px_-10px_oklch(0.3_0.02_60/0.18)]';

export function ProposalCard({ proposal, state, catalog, onRun }: {
  proposal: ChatProposal;
  state: ProposalState;
  catalog: Catalog | null;
  onRun: () => void;
}) {
  return (
    <section aria-label="Optimization to check" className={cn(cardClass, state === 'replaced' && 'opacity-60')}>
      <header className="flex items-baseline justify-between gap-3 px-4 pt-3.5 pb-3">
        <h3 className="text-sm font-semibold">Optimization to check</h3>
        <span className="text-xs text-muted-foreground">
          {state === 'open' ? 'Nothing has run yet' : state === 'running' ? 'Running' : state === 'ran' ? 'Ran' : 'Replaced below'}
        </span>
      </header>
      <div className="px-4 pb-3.5">
        <GoalRows problem={proposal.problem} today={proposal.today} catalog={catalog} />
      </div>
      {(state === 'open' || state === 'running') && (
        <footer className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t bg-muted/40 px-4 py-3">
          <Button size="sm" onClick={onRun} disabled={state === 'running'}>
            {state === 'running' ? <Spinner data-icon="inline-start" /> : <Play data-icon="inline-start" />}
            {state === 'running' ? 'Testing plans…' : 'Run optimization'}
          </Button>
          {state === 'open' && <span className="text-xs text-muted-foreground">or say what to change</span>}
        </footer>
      )}
      {state === 'ran' && (
        <footer className="flex items-center gap-1.5 border-t px-4 py-2.5 text-xs text-muted-foreground">
          <Check aria-hidden="true" className="size-3.5 text-positive" /> Ran on exactly these goal and limits
        </footer>
      )}
    </section>
  );
}

export function PlanCard({ scenario, catalog, optimization, kept, shown, onShow, onCompare }: {
  scenario: ChatScenario;
  catalog: Catalog | null;
  optimization: ChatOptimization | null | undefined;
  /** The plan this became, once kept: its name and colour. */
  kept: { name: string; color: string | null } | null;
  /** Where this plan is on screen right now, if anywhere. */
  shown: 'building' | 'results' | null;
  onShow: () => void;
  onCompare: () => void;
}) {
  const s = scenario.summary;
  const flagTypes = [...new Set(s.flags.map(flag => flag.type))];
  const bill = s.energy_bill_chf_month;
  const changes = scenario.scenario.length;
  const rows = groupedChanges(scenario.scenario, catalog);
  // Worn-out units must be replaced anyway, so only the part above a like-for-like replacement is extra.
  const extra = s.extra_cost_vs_like_for_like_chf;
  const dueAnyway = extra <= 0 ? 'No more than replacing the worn-out units like for like'
    : extra < s.upfront_cost_chf * 0.9 ? `${chfShort(extra)} more than replacing worn-out units like for like` : undefined;
  return (
    <section aria-label={`Plan: ${kept?.name ?? scenario.title}`} className={cardClass}>
      <header className="flex items-start gap-2.5 px-4 pt-3.5 pb-3">
        <span aria-hidden="true" className="mt-1.5 size-2 shrink-0 rounded-full"
          style={kept?.color ? { background: kept.color } : { boxShadow: 'inset 0 0 0 1.5px var(--primary)' }} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h3 className="text-sm font-semibold text-pretty">{kept?.name ?? scenario.title}</h3>
          <p className="text-xs text-muted-foreground">
            {/* Counted like the plan list: one change per kind of equipment and floor. */}
            {changes} {changes === 1 ? 'change' : 'changes'}
          </p>
        </div>
        {optimization && (
          <span className={cn('flex shrink-0 items-center gap-1 text-xs font-medium', optimization.all_limits_met ? 'text-positive' : 'text-warning')}>
            {optimization.all_limits_met ? <Check aria-hidden="true" className="size-3.5" /> : <TriangleAlert aria-hidden="true" className="size-3.5" />}
            {optimization.all_limits_met ? 'All limits met' : 'A limit is missed'}
          </span>
        )}
      </header>

      {optimization && !optimization.all_limits_met && (
        <ul className="mx-4 mb-3 flex flex-col gap-1 rounded-lg bg-warning/6 px-3 py-2 text-xs">
          {optimization.limits_missed.map(v => {
            const c = optimization.problem.constraints?.find(x => x.metric === v.metric);
            return (
              <li key={v.metric}>
                Missed: {c ? limitText(c) : metricText[v.metric].label}. This plan: {v.value === null ? 'none' : withUnit(v.value, metricText[v.metric].unit)}.
              </li>
            );
          })}
        </ul>
      )}

      <ul aria-label="What changes" className="mx-4 mb-3 flex flex-col gap-1.5 border-l pl-3 text-sm">
        {rows.slice(0, 4).map(row => (
          <li key={`${row.group}-${row.option}`} className="flex flex-col leading-snug">
            <span><span className="font-medium">{row.label}</span> <span className="text-muted-foreground">→</span> {row.name}</span>
            <span className="text-xs text-muted-foreground">{row.where}</span>
          </li>
        ))}
        {rows.length > 4 && <li className="text-xs text-muted-foreground">and {rows.length - 4} more</li>}
      </ul>

      <div className="border-t px-4 pt-3 pb-3">
        <Rows rows={[
          ['Upfront', <span className="font-medium tabular-nums">{chfShort(s.upfront_cost_chf)}</span>, dueAnyway],
          // A year, like the pulse and Results (the assistant reports it per month).
          ['Energy bill', <span className="tabular-nums"><span className="font-medium">{chfShort(bill.scenario * 12)}</span> a year</span>, `Today ${chfShort(bill.today * 12)}`],
          ['Saves', <span className="tabular-nums"><span className="font-medium">{chfShort(s.running_cost_saving_chf_year)}</span> a year</span>, 'On energy, upkeep and supplies'],
        ]} />
        <p className="mt-3 text-xs text-muted-foreground text-pretty">Year 1, from the building model. When it pays back, and how that varies across 200 futures, is in Results.</p>
        {flagTypes.length > 0 && (
          <ul className="mt-3 flex flex-wrap gap-1.5">
            {flagTypes.map(type => {
              const first = s.flags.find(flag => flag.type === type)?.year;
              return (
                <li key={type} className="flex items-center gap-1 rounded-md bg-warning/8 px-2 py-0.5 text-xs">
                  <TriangleAlert aria-hidden="true" className="size-3 text-warning" />
                  {flagText[type] ?? type}{first ? ` from year ${first}` : ''}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <footer className="flex flex-wrap items-center gap-2 border-t bg-muted/40 px-4 py-3">
        <Button size="sm" variant="outline" onClick={onShow} aria-pressed={shown === 'building'} className={cn(shown === 'building' && nowStyle)}>
          {shown === 'building' ? <Check data-icon="inline-start" /> : <Box data-icon="inline-start" />}
          {shown === 'building' ? 'In 3D now' : 'Show in 3D'}
        </Button>
        <Button size="sm" variant="outline" onClick={onCompare} aria-pressed={shown === 'results'} className={cn(shown === 'results' && nowStyle)}>
          {shown === 'results' ? <Check data-icon="inline-start" /> : <ChartSpline data-icon="inline-start" />}
          {shown === 'results' ? 'In Results now' : 'Compare in Results'}
        </Button>
      </footer>
    </section>
  );
}
