import { ArrowRight } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { api } from '@/api/client';
import type { Scenario, SimulateResult } from '@/api/types';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { configurationName, type SavedConfiguration } from './configurations';
import type { EquipmentSwap } from './equipment';

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

export default function ConfigurationComparison({ saved, draft }: { saved: SavedConfiguration[]; draft: ReadonlyMap<string, EquipmentSwap> }) {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [results, setResults] = useState<(SimulateResult | null)[] | null>(null);
  const navigate = useNavigate();

  /** Open the full results for the draft, or the newest saved configuration, behind a short simulating screen. */
  function openResults() {
    const scenario = draft.size ? Array.from(draft.values()) : saved.at(-1)?.scenario ?? [];
    navigate(`/results?config=${encodeURIComponent(JSON.stringify({ scenario }))}`, { state: { intro: true } });
  }

  function simulate() {
    setResults(null);
    setPlans([
      { name: 'Current setup', scenario: [] },
      ...saved.map(({ id, scenario }) => ({ name: configurationName(id), scenario })),
      ...(draft.size ? [{ name: 'Unsaved draft', scenario: Array.from(draft.values()) }] : []),
    ]);
  }

  useEffect(() => {
    if (!plans.length) return;
    let ignore = false;
    void Promise.allSettled(plans.map(({ scenario }) => api.simulate({ scenario }))).then(outcomes => {
      if (!ignore) setResults(outcomes.map(outcome => outcome.status === 'fulfilled' ? outcome.value : null));
    });
    return () => { ignore = true; };
  }, [plans]);

  return (
    <Dialog>
      <button type="button" onClick={openResults}
        className="flex min-h-10 items-center justify-between gap-2 rounded-lg bg-primary px-4 py-2 text-left text-sm font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
        {draft.size ? 'Simulate this plan' : saved.length ? 'Simulate the last saved plan' : 'Simulate current setup'}
        <ArrowRight aria-hidden="true" className="size-4 shrink-0" />
      </button>
      {(saved.length > 0 || draft.size > 0) && (
        <DialogTrigger asChild>
          <button type="button" onClick={simulate} className="self-start text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground">
            Quick table: compare all plans
          </button>
        </DialogTrigger>
      )}
      <DialogContent className="max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)] sm:max-w-5xl">
        <DialogHeader className="pr-5">
          <DialogTitle>Simulation results</DialogTitle>
          <DialogDescription>Energy, air quality and operating costs are for the first year. Savings are measured against the current setup.</DialogDescription>
        </DialogHeader>
        {!results ? <p role="status" className="text-sm text-muted-foreground">Running simulations…</p> : (
          <div className="flex min-h-0 min-w-0 flex-col gap-3">
            {results.some(result => !result) && (
              <div className="flex shrink-0 flex-wrap items-center gap-2 text-sm">
                <p role="alert">Could not simulate: {plans.filter((_, index) => !results[index]).map(plan => plan.name).join(', ')}.</p>
                <button type="button" onClick={simulate} className="underline underline-offset-4">Try again</button>
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
        )}
      </DialogContent>
    </Dialog>
  );
}
