// The plan the assistant recommends, and the goal and limits it used. Every number comes from the API;
// this file only formats them.
import { ArrowRightIcon, TriangleAlertIcon } from 'lucide-react';
import type { Catalog, ChatScenario, MetricName, OptimizationProblem, ProblemConstraint } from '@/api/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';

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
};

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
  const parts = [];
  if (c.max !== undefined) parts.push(`at most ${withUnit(c.max, unit)}`);
  if (c.min !== undefined) parts.push(`at least ${withUnit(c.min, unit)}`);
  return `${label} ${parts.join(' and ')}`;
}

function Goal({ problem, catalog }: { problem: OptimizationProblem; catalog: Catalog | null }) {
  const { metric, sense } = problem.objective;
  const optionName = (id: string) =>
    Object.values(catalog?.groups ?? {}).flat().find(option => option.option_id === id)?.name ?? id;
  const groupName = (group: string) => group.replaceAll('_', ' ');
  const lines = [
    `Goal: ${sense === 'max' ? 'highest' : 'lowest'} ${metricText[metric].label}.`,
    ...(problem.constraints ?? []).map(c => `Limit: ${limitText(c)}.`),
    ...(problem.locked ?? []).map(l => `Kept as today: ${groupName(l.group)}${l.floor === undefined ? '' : ` on floor ${l.floor}`}.`),
    ...Object.entries(problem.allowed ?? {}).map(([group, ids]) => `Only for ${groupName(group)}: ${ids.map(optionName).join(', ')}.`),
  ];
  return (
    <ul className="flex flex-col gap-0.5">
      {lines.map(line => <li key={line}>{line}</li>)}
    </ul>
  );
}

export default function PlanCard({ scenario, problem, catalog, onShow }: {
  scenario: ChatScenario | null | undefined;
  problem: OptimizationProblem | null | undefined;
  catalog: Catalog | null;
  onShow: (plan: ChatScenario) => void;
}) {
  if (!scenario && !problem) return null;
  const s = scenario?.summary;
  const figures = s ? [
    ['Upfront cost', withUnit(s.upfront_cost_chf, 'CHF')],
    ['Energy bill per month', `${withUnit(s.energy_bill_chf_month.today, 'CHF')} → ${withUnit(s.energy_bill_chf_month.scenario, 'CHF')}`],
    ['Payback', payback(s.payback_years)],
    [`Value over ${s.horizon_years} years`, withUnit(s.npv_chf, 'CHF')],
  ] : [];
  return (
    <Card className="w-full gap-3 py-4">
      <CardHeader className="px-4">
        <CardTitle>{scenario?.title ?? 'What I optimized for'}</CardTitle>
        {problem && <CardDescription><Goal problem={problem} catalog={catalog} /></CardDescription>}
      </CardHeader>
      {s && (
        <CardContent className="flex flex-col gap-3 px-4">
          <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1">
            {figures.map(([label, value]) => (
              <div key={label} className="contents">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="text-right whitespace-nowrap tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
          {s.flags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {[...new Set(s.flags.map(flag => flag.type))].map(type => {
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
      )}
      {scenario && (
        <CardFooter className="px-4">
          <Button size="sm" onClick={() => onShow(scenario)}>
            Show results
            <ArrowRightIcon data-icon="inline-end" />
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}
