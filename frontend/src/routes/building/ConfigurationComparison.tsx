import { useEffect, useState } from 'react';
import { api } from '@/api/client';
import type { Scenario, SimulateResult } from '@/api/types';
import { configurationName, type SavedConfiguration } from './configurations';

interface Plan {
  name: string;
  scenario: Scenario;
}

const number = new Intl.NumberFormat('en-CH', { maximumFractionDigits: 1 });
const money = new Intl.NumberFormat('en-CH', { style: 'currency', currency: 'CHF', maximumFractionDigits: 0 });

const metrics: { label: string; value: (result: SimulateResult, isCurrent: boolean) => string }[] = [
  { label: 'Energy use (kWh)', value: ({ snapshot }) => number.format(snapshot.building.kwh_year) },
  { label: 'Energy cost', value: ({ snapshot }) => money.format(snapshot.building.costs_chf.energy) },
  { label: 'Meeting room CO₂ (ppm)', value: ({ snapshot }) => number.format(snapshot.building.outcomes.meeting_co2_ppm) },
  { label: 'Summer overheating (°C)', value: ({ snapshot }) => number.format(snapshot.building.outcomes.summer_overheating_degc) },
  { label: 'Desk capacity', value: ({ snapshot }) => number.format(snapshot.building.desk_capacity) },
  { label: 'Extra upfront cost', value: ({ finance }) => money.format(finance.capex_year0) },
  { label: 'Operating cost savings', value: ({ finance }) => {
    const year = finance.years[0];
    return year ? money.format(year.operating_cost_baseline - year.operating_cost) : '—';
  } },
  { label: 'Cash payback', value: ({ finance }, isCurrent) => isCurrent ? '—'
    : finance.payback_cash === null ? 'Not within the simulation period' : `${number.format(finance.payback_cash)} years` },
];

export default function ConfigurationComparison({ configurations }: { configurations: SavedConfiguration[] }) {
  const [plans] = useState<Plan[]>(() => [
    { name: 'Current setup', scenario: [] },
    ...configurations.map(({ scenario }, index) => ({ name: configurationName(index + 1), scenario }))
      .filter(({ scenario }) => scenario.length > 0),
  ]);
  const [results, setResults] = useState<(SimulateResult | null)[] | null>(null);
  const [attempt, setAttempt] = useState(0);

  function retry() {
    setResults(null);
    setAttempt(previous => previous + 1);
  }

  useEffect(() => {
    let ignore = false;
    void Promise.allSettled(plans.map(({ scenario }) => api.simulate({ scenario }))).then(outcomes => {
      if (!ignore) setResults(outcomes.map(outcome => outcome.status === 'fulfilled' ? outcome.value : null));
    });
    return () => { ignore = true; };
  }, [plans, attempt]);

  return !results ? <p role="status" className="text-sm text-muted-foreground">Running simulations…</p> : (
    <div className="flex min-h-0 min-w-0 flex-col gap-3">
      {results.some(result => !result) && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 text-sm">
          <p role="alert">Could not simulate: {plans.filter((_, index) => !results[index]).map(plan => plan.name).join(', ')}.</p>
          <button type="button" onClick={retry} className="underline underline-offset-4">Try again</button>
        </div>
      )}
      {results.some(Boolean) && (
        <div role="region" aria-label="Configuration comparison" tabIndex={0} className="min-h-0 overflow-auto rounded-lg border focus-visible:outline-2 focus-visible:outline-ring">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Simulated outcomes by configuration</caption>
            <thead className="bg-muted">
              <tr>
                <th scope="col" className="min-w-40 px-3 py-2">Measure</th>
                {plans.map(({ name }) => <th scope="col" key={name} className="min-w-36 px-3 py-2">{name}</th>)}
              </tr>
            </thead>
            <tbody>
              {metrics.map(({ label, value }) => (
                <tr key={label} className="border-t">
                  <th scope="row" className="px-3 py-2 font-medium">{label}</th>
                  {plans.map(({ name }, index) => {
                    const result = results[index];
                    return <td key={name} className="px-3 py-2 tabular-nums">{result ? value(result, index === 0) : '—'}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
