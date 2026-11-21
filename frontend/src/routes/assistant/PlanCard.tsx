// Cards under the assistant's replies: the optimization it proposes (to confirm), and the plan it found.
// Every number comes from the API; this file only formats them.
import { ArrowRightIcon, CheckIcon, PlayIcon, TriangleAlertIcon } from 'lucide-react';
import type {
  Catalog, ChatOptimization, ChatProposal, ChatScenario, MetricName, OptimizationProblem, ProblemConstraint,
} from '@/api/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';

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

function payback(years: number | null) {
  if (years === null) return 'Never, in cash';
  if (years === 0) return 'From day one';
  return withUnit(years, 'years');
}

function limitText(c: ProblemConstraint) {
  const { label, unit } = metricText[c.metric];
  if (c.metric === 'warnings' && c.max === 0) return 'no warnings (over budget, reserve too low, …)';
  if (c.metric === 'new_warnings' && c.max === 0) return 'no new warnings (over budget, reserve too low, …)';
  const bound = c.max !== undefined ? c.max : c.min;
  if (c.from_change_pct !== undefined && bound !== undefined) {
    const pct = c.from_change_pct;
    const side = pct < 0 ? 'below' : 'above';
    const atLeast = (c.max !== undefined) === (pct < 0);
    return `${label} ${atLeast ? 'at least' : 'at most'} ${number(Math.abs(pct), 1)}% ${side} today (${c.max !== undefined ? 'at most' : 'at least'} ${withUnit(bound, unit)})`;
  }
  const parts = [];
  if (c.max !== undefined) parts.push(`at most ${withUnit(c.max, unit)}`);
  if (c.min !== undefined) parts.push(`at least ${withUnit(c.min, unit)}`);
  return `${label} ${parts.join(' and ')}`;
}

function GoalLines({ problem, today, catalog }: {
  problem: OptimizationProblem;
  today?: ChatProposal['today'];
  catalog: Catalog | null;
}) {
  const { metric, sense } = problem.objective;
  const optionName = (id: string) =>
    Object.values(catalog?.groups ?? {}).flat().find(option => option.option_id === id)?.name ?? id;
  const groupName = (group: string) => group.replaceAll('_', ' ');
  const now = (m: MetricName) => {
    const value = today?.[m];
    return value === undefined || value === null || noTodayValue.has(m) ? '' : ` (today: ${withUnit(value, metricText[m].unit)})`;
  };
  const lines: [string, string][] = [
    ['Goal', `${sense === 'max' ? 'highest' : 'lowest'} ${metricText[metric].label}${now(metric)}`],
    ...(problem.constraints ?? []).map((c): [string, string] => [
      'Limit', `${limitText(c)}${c.from_change_pct === undefined ? now(c.metric) : ''}`]),
    ...(problem.locked ?? []).map((l): [string, string] => [
      'Keep as today', `${groupName(l.group)}${l.floor === undefined ? '' : ` on floor ${l.floor}`}`]),
    ...Object.entries(problem.allowed ?? {}).map(([group, ids]): [string, string] => [
      `Only for ${groupName(group)}`, ids.map(optionName).join(', ')]),
  ];
  if (problem.per_floor) lines.push(['Search', 'floor by floor']);
  return (
    <ul className="flex flex-col gap-1">
      {lines.map(([label, text]) => (
        <li key={label + text}><span className="font-medium text-foreground">{label}:</span> {text}</li>
      ))}
    </ul>
  );
}

export type ProposalState = 'open' | 'running' | 'ran' | 'replaced';

export function ProposalCard({ proposal, state, catalog, onRun }: {
  proposal: ChatProposal;
  state: ProposalState;
  catalog: Catalog | null;
  onRun: () => void;
}) {
  return (
    <Card className="w-full gap-3 py-4">
      <CardHeader className="px-4">
        <CardTitle>Proposed optimization</CardTitle>
        <CardDescription>Nothing has run yet. Check the goal and limits, then run it or tell me what to change.</CardDescription>
      </CardHeader>
      <CardContent className="px-4 text-sm text-muted-foreground">
        <GoalLines problem={proposal.problem} today={proposal.today} catalog={catalog} />
      </CardContent>
      <CardFooter className="gap-2 px-4">
        {state === 'open' && (
          <Button size="sm" onClick={onRun}>
            <PlayIcon data-icon="inline-start" />
            Run optimization
          </Button>
        )}
        {state === 'running' && (
          <Button size="sm" disabled>
            <Spinner data-icon="inline-start" />
            Running…
          </Button>
        )}
        {state === 'ran' && <Badge variant="secondary"><CheckIcon data-icon="inline-start" />Ran</Badge>}
        {state === 'replaced' && <p className="text-xs text-muted-foreground">Replaced by a newer proposal.</p>}
      </CardFooter>
    </Card>
  );
}

export function PlanCard({ scenario, optimization, onShow }: {
  scenario: ChatScenario;
  optimization: ChatOptimization | null | undefined;
  onShow: (plan: ChatScenario) => void;
}) {
  const s = scenario.summary;
  const figures = [
    ['Upfront cost', withUnit(s.upfront_cost_chf, 'CHF')],
    ['Energy bill per month', `${withUnit(s.energy_bill_chf_month.today, 'CHF')} → ${withUnit(s.energy_bill_chf_month.scenario, 'CHF')}`],
    ['Payback', payback(s.payback_years)],
    [`Value over ${s.horizon_years} years`, withUnit(s.npv_chf, 'CHF')],
  ];
  const flagTypes = [...new Set(s.flags.map(flag => flag.type))];
  return (
    <Card className="w-full gap-3 py-4">
      <CardHeader className="px-4">
        <CardTitle>{scenario.title}</CardTitle>
        {optimization && (optimization.all_limits_met ? (
          <CardDescription><Badge variant="secondary"><CheckIcon data-icon="inline-start" />All limits met</Badge></CardDescription>
        ) : (
          <CardDescription className="flex flex-col items-start gap-1">
            <Badge variant="outline"><TriangleAlertIcon data-icon="inline-start" />Not every limit could be met</Badge>
            {optimization.limits_missed.map(v => {
              const c = optimization.problem.constraints?.find(x => x.metric === v.metric);
              const { unit } = metricText[v.metric];
              return (
                <span key={v.metric}>
                  Missed: {c ? limitText(c) : metricText[v.metric].label}. This plan: {v.value === null ? 'none' : withUnit(v.value, unit)}.
                </span>
              );
            })}
          </CardDescription>
        ))}
      </CardHeader>
      <CardContent className="flex flex-col gap-3 px-4">
        <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1">
          {figures.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="text-right whitespace-nowrap tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
        {flagTypes.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {flagTypes.map(type => {
              const first = s.flags.find(flag => flag.type === type)?.year;
              return (
                <Badge key={type} variant="outline">
                  <TriangleAlertIcon data-icon="inline-start" />
                  {flagText[type] ?? type}{first ? ` from year ${first}` : ''}
                </Badge>
              );
            })}
          </div>
        )}
        <p className="text-xs text-muted-foreground">Model estimates from our assumptions.</p>
      </CardContent>
      <CardFooter className="px-4">
        <Button size="sm" onClick={() => onShow(scenario)}>
          Show results
          <ArrowRightIcon data-icon="inline-end" />
        </Button>
      </CardFooter>
    </Card>
  );
}
