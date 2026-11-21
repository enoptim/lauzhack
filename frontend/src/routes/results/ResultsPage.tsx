import { ArrowLeft, Pause, Play, TriangleAlert } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import type { Catalog, SimulateResult, Swap } from '@/api/types';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { cn } from '@/lib/utils';
import { readConfig } from './config';
import { chf, chfShort, kwh, pricePerKwh, years } from './format';
import KeyAssumptions from './KeyAssumptions';
import { flagText, groupLabels, isContextFlag, seriesColor, whatIfLabels } from './labels';
import MoneyBreakdown from './MoneyBreakdown';
import MoneyChart from './MoneyChart';
import { useEngine, WHAT_IFS, type WhatIf } from './useEngine';

const PRICE_KEY = 'electricity_price_chf_kwh';
const TODAY_PRICE = 0.2;

function swapText(swap: Swap, catalog: Catalog | null) {
  const option = catalog?.groups[swap.group]?.find(item => item.option_id === swap.option);
  const where = swap.floor !== undefined ? (swap.floor === 0 ? 'ground floor' : `floor ${swap.floor}`) : 'whole building';
  return `${option?.name ?? groupLabels[swap.group] ?? swap.group} · ${where}`;
}

/** Years in which the plan leaves the savings account below its minimum and below doing nothing. */
function belowMinimumRange(plan: SimulateResult): [number, number] | null {
  const flag = plan.finance.flags.find(item => item.type === 'reserve_below_minimum');
  const minimum = typeof flag?.minimum === 'number' ? flag.minimum : null;
  if (minimum === null) return null;
  const hit = plan.finance.years.filter(y => y.cash_closing < minimum && y.cash_closing < y.cash_closing_baseline).map(y => y.year);
  if (!hit.length) return null;
  let end = hit[0];
  while (hit.includes(end + 1)) end += 1;
  return [hit[0], end];
}

export default function ResultsPage() {
  const [params] = useSearchParams();
  const read = readConfig(params);
  const scenario = useMemo(() => read?.config.scenario ?? [], [params]); // eslint-disable-line react-hooks/exhaustive-deps

  const [price, setPrice] = useState(read?.config.overrides[PRICE_KEY] ?? TODAY_PRICE);
  const [whatIfs, setWhatIfs] = useState<WhatIf[]>([]);
  const [staffEffects, setStaffEffects] = useState(false);
  const [playYear, setPlayYear] = useState<number | null>(null);

  const overrides = useMemo(() => ({ ...(read?.config.overrides ?? {}), [PRICE_KEY]: price }), [price, params]); // eslint-disable-line react-hooks/exhaustive-deps
  const engine = useEngine(scenario, overrides, whatIfs);
  const runs = engine.runs.data;
  const plan = runs?.plan;
  const horizon = plan?.finance.years.length ?? 15;

  useEffect(() => {
    if (playYear === null) return;
    if (playYear >= horizon) { const done = setTimeout(() => setPlayYear(null), 900); return () => clearTimeout(done); }
    const next = setTimeout(() => setPlayYear(playYear + 1), 380);
    return () => clearTimeout(next);
  }, [playYear, horizon]);

  if (read === null) {
    return (
      <main className="mx-auto flex max-w-3xl flex-col gap-4 px-6 py-12">
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertTitle>The configuration in the page address is broken.</AlertTitle>
          <AlertDescription>Go back to the building and click Simulate again.</AlertDescription>
        </Alert>
        <Link to="/" className="text-sm underline underline-offset-4">Back to the building</Link>
      </main>
    );
  }

  if (engine.runs.error && !plan) {
    return (
      <main className="mx-auto flex max-w-3xl flex-col gap-4 px-6 py-12">
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertTitle>The simulation is not answering.</AlertTitle>
          <AlertDescription>Start it with <code className="font-mono">make dev</code>, then reload this page.</AlertDescription>
        </Alert>
      </main>
    );
  }

  const finance = plan?.finance;
  const npv = finance ? (staffEffects ? finance.npv_economic : finance.npv_cash) : 0;
  const payback = finance ? (staffEffects ? finance.payback_economic : finance.payback_cash) : null;
  const breakeven = engine.breakeven.data?.npv_cash;
  const visibleUntil = playYear ?? horizon;
  const flags = (finance?.flags ?? []).filter(flag => !isContextFlag(flag));
  const contextFlags = (finance?.flags ?? []).filter(isContextFlag);
  const today = plan?.snapshot_baseline.building;
  const after = plan?.snapshot.building;

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-4 py-8 md:px-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <Link to="/" className="flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-4" /> Change the plan
          </Link>
          <h1 className="text-xl font-semibold tracking-tight text-balance">
            {scenario.length ? scenario.map(swap => swapText(swap, engine.catalog.data)).join(' + ') : 'No changes'}
          </h1>
          <p className="text-sm text-muted-foreground">
            {finance ? `${chf(finance.capex_year0)} up front` : 'Calculating…'}
            {read.isDemo && ' · demo plan'}
          </p>
        </div>
        <Button variant="outline" size="lg" onClick={() => setPlayYear(playYear === null ? 1 : null)} disabled={!plan}>
          {playYear === null ? <Play data-icon="inline-start" /> : <Pause data-icon="inline-start" />}
          {playYear === null ? 'Play 15 years' : `Year ${playYear}`}
        </Button>
      </header>

      <section aria-label="Verdict" className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex max-w-2xl flex-col gap-2">
          {finance ? (
            <>
              <p className="text-4xl font-semibold tracking-tight text-balance md:text-5xl">
                {npv >= 0 ? 'Gains' : 'Loses'} <span className={cn(npv < 0 && 'text-warning')}>{chfShort(Math.abs(npv))}</span> over {horizon} years
              </p>
              <p className="text-lg text-muted-foreground text-pretty">
                {staffEffects ? 'Counting money and the value of better work and fewer sick days.' : 'Money only: purchase, energy and upkeep.'}
                {!staffEffects && breakeven?.value != null && breakeven.pays_off === 'above' &&
                  ` Pays off if electricity costs more than ${pricePerKwh(breakeven.value)}.`}
                {!staffEffects && breakeven?.pays_off === 'always' && ' Pays off at any electricity price.'}
              </p>
            </>
          ) : <Skeleton className="h-24 w-full max-w-xl" />}
        </div>
      </section>

      <dl aria-label="Today and after" className="-mt-2 grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border md:grid-cols-4">
        {[
          { label: 'Energy bill, year 1', before: today && chfShort(today.costs_chf.energy), now: after && chfShort(after.costs_chf.energy) },
          { label: 'Energy use, year 1', before: today && kwh(today.kwh_year), now: after && kwh(after.kwh_year) },
          { label: 'CO₂ in meeting rooms', before: today && `${Math.round(today.outcomes.meeting_co2_ppm)} ppm`, now: after && `${Math.round(after.outcomes.meeting_co2_ppm)} ppm` },
          { label: 'Pays back in', before: null, now: finance ? years(payback) : null },
        ].map(stat => (
          <div key={stat.label} className="flex flex-col gap-1 bg-card px-5 py-4">
            <dt className="text-sm text-muted-foreground">{stat.label}</dt>
            <dd className="flex flex-wrap items-baseline gap-x-2 tabular-nums">
              <span className="whitespace-nowrap text-2xl font-semibold tracking-tight">{stat.now ?? '…'}</span>
              {stat.before && <span className="whitespace-nowrap text-sm text-muted-foreground">today {stat.before}</span>}
            </dd>
          </div>
        ))}
      </dl>

      <section aria-label="Money over time" className="flex flex-col gap-5 rounded-xl border bg-card p-4 shadow-[0_1px_2px_oklch(0_0_0/0.04),0_8px_24px_-12px_oklch(0.3_0.05_277/0.12)] md:p-6">
        <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-4">
          <div className="flex flex-col gap-1">
            <h2 className="text-base font-semibold">Money compared with doing nothing</h2>
            <p className="text-sm text-muted-foreground">What could happen? Switch on a what-if to add its line.</p>
          </div>
          <ToggleGroup type="multiple" variant="outline" value={whatIfs} onValueChange={(value: string[]) => setWhatIfs(WHAT_IFS.filter(id => value.includes(id)))}>
            {WHAT_IFS.map(id => (
              <ToggleGroupItem key={id} value={id} className="gap-2 px-3">
                <span className="size-2 rounded-[2px]" style={{ background: seriesColor[id] }} />
                {whatIfLabels[id]}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>

        <div className="flex flex-wrap items-center gap-x-10 gap-y-4 border-y py-4">
          <label className="flex min-w-72 flex-1 items-center gap-4 text-sm">
            <span className="shrink-0 text-muted-foreground">Electricity price</span>
            <Slider min={0.1} max={0.45} step={0.01} value={[price]} onValueChange={([value]) => setPrice(value)} className="max-w-80" aria-label="Electricity price" />
            <span className="w-32 font-medium tabular-nums">{pricePerKwh(price)}</span>
            {Math.abs(price - TODAY_PRICE) > 0.001 && (
              <button type="button" className="text-muted-foreground underline underline-offset-4 hover:text-foreground" onClick={() => setPrice(TODAY_PRICE)}>Reset</button>
            )}
          </label>
          <label className="flex items-center gap-3 text-sm">
            <Switch checked={staffEffects} onCheckedChange={setStaffEffects} />
            <span>Count staff effects <span className="text-muted-foreground">(depends on guesses)</span></span>
          </label>
        </div>

        {runs ? (
          <MoneyChart
            runs={runs} whatIfs={whatIfs} staffEffects={staffEffects}
            fan={engine.futures.data?.summary.plan?.fan.cash ?? null}
            visibleUntil={visibleUntil} belowMinimum={plan ? belowMinimumRange(plan) : null}
            animate={playYear === null}
          />
        ) : <Skeleton className="h-[26rem] w-full" />}

        <p className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted-foreground">
          <span className="flex items-center gap-2"><span className="h-0.5 w-5 rounded bg-chart-1" />Solid line: money only</span>
          <span className="flex items-center gap-2"><span className="h-0.5 w-5 rounded border-t-2 border-dashed border-chart-1" />Dashed line: depends on guesses about staff</span>
          {!staffEffects && <span className="flex items-center gap-2"><span className="h-3 w-5 rounded-sm bg-chart-1/10" />Shaded band: range over 200 possible futures{engine.futures.loading && ' (updating…)'}</span>}
        </p>
      </section>

      <div className="grid gap-8 lg:grid-cols-2">
        <section aria-label="Where the money comes from" className="flex flex-col gap-4 rounded-xl border bg-card p-4 md:p-6">
          <div className="flex flex-col gap-1">
            <h2 className="text-base font-semibold">Where the money comes from</h2>
            <p className="text-sm text-muted-foreground">Over {horizon} years, in today’s francs.</p>
          </div>
          {finance ? <MoneyBreakdown breakdown={finance.npv_breakdown} staffEffects={staffEffects} /> : <Skeleton className="h-40 w-full" />}
        </section>

        <div className="flex flex-col gap-8">
          <section aria-label="Warnings" className="flex flex-col gap-3 rounded-xl border bg-card p-4 md:p-6">
            <h2 className="text-base font-semibold">Warnings</h2>
            {flags.length === 0 && contextFlags.length === 0 && <p className="text-sm text-muted-foreground">No warnings for this plan.</p>}
            <ul className="flex flex-col gap-2">
              {flags.map(flag => {
                const shown = playYear === null || flag.year === undefined || flag.year <= playYear;
                return (
                  <li key={`${flag.type}-${flag.year}`} className={cn('flex items-start gap-3 rounded-lg bg-warning/8 px-3 py-2.5 text-sm transition-opacity duration-500', !shown && 'opacity-0')}>
                    <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
                    <span>{flag.year !== undefined && <span className="font-semibold">Year {flag.year}: </span>}{flagText(flag)}</span>
                  </li>
                );
              })}
              {contextFlags.map(flag => (
                <li key={flag.type} className="px-3 text-sm text-muted-foreground">{flag.year !== undefined && `Year ${flag.year}: `}{flagText(flag)}</li>
              ))}
            </ul>
          </section>

          <section aria-label="Assumptions that matter most" className="flex flex-col gap-4 rounded-xl border bg-card p-4 md:p-6">
            <div className="flex flex-col gap-1">
              <h2 className="text-base font-semibold">What moves the result most</h2>
              <p className="text-sm text-muted-foreground">The 15-year result with staff effects, from the low to the high value of each assumption.</p>
            </div>
            {engine.tornado.data && engine.assumptions.data
              ? <KeyAssumptions tornado={engine.tornado.data} assumptions={engine.assumptions.data} />
              : <Skeleton className="h-48 w-full" />}
          </section>
        </div>
      </div>

      <footer className="text-sm text-muted-foreground">The building is real. The numbers are our assumptions.</footer>
    </main>
  );
}
