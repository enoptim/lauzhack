import { ArrowLeft, ArrowRight, Pause, Play, TriangleAlert } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import type { Catalog, Swap } from '@/api/types';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { cn } from '@/lib/utils';
import { readConfig } from './config';
import { chf, chfShort, kwh, pricePerKwh, years } from './format';
import { flagText, groupLabels, isContextFlag, seriesColor, whatIfDetails, whatIfLabels } from './labels';
import MoneyBreakdown from './MoneyBreakdown';
import MoneyChart, { crossing, totals } from './MoneyChart';
import { useEngine, WHAT_IFS, type WhatIf } from './useEngine';

const PRICE_KEY = 'electricity_price_chf_kwh';
const TODAY_PRICE = 0.2;
const PRICE_MIN = 0.1;
const PRICE_MAX = 0.45;
const HORIZONS = [5, 10, 15] as const;
const MS_PER_YEAR = 450;

function optionName(catalog: Catalog | null, group: string, optionId: string | undefined) {
  return catalog?.groups[group]?.find(item => item.option_id === optionId)?.name;
}

/** What is installed today for a swap's group (and floor), by the most common option. */
function installedOption(catalog: Catalog | null, swap: Swap) {
  const items = (catalog?.items ?? []).filter(item => item.group === swap.group
    && (swap.floor === undefined || item.serves_floor === swap.floor));
  const counts = new Map<string, number>();
  for (const item of items) counts.set(item.option_id, (counts.get(item.option_id) ?? 0) + item.units);
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  return optionName(catalog, swap.group, top);
}

const where = (swap: Swap) => swap.floor === undefined ? 'Whole building' : swap.floor === 0 ? 'Ground floor' : `Floor ${swap.floor}`;

/** First year (with decimals) where a futures percentile line reaches zero, or null. */
function fanPayback(points: { year: number; value: number }[]): number | null {
  let previous = { year: 0, value: -Infinity };
  for (const point of points) {
    if (previous.value < 0 && point.value >= 0) {
      if (!Number.isFinite(previous.value)) return point.year;
      return previous.year + ((0 - previous.value) / (point.value - previous.value)) * (point.year - previous.year);
    }
    previous = point;
  }
  return null;
}

export default function ResultsPage() {
  const [params] = useSearchParams();
  const read = readConfig(params);
  const scenario = useMemo(() => read?.config.scenario ?? [], [params]); // eslint-disable-line react-hooks/exhaustive-deps

  const [price, setPrice] = useState(read?.config.overrides[PRICE_KEY] ?? TODAY_PRICE);
  const [whatIf, setWhatIf] = useState<WhatIf | null>(null);
  const [staffEffects, setStaffEffects] = useState(false);
  const [horizon, setHorizon] = useState<number>(15);
  const [playToken, setPlayToken] = useState(0);
  const [playYear, setPlayYear] = useState<number | null>(null);

  const overrides = useMemo(() => ({ ...(read?.config.overrides ?? {}), [PRICE_KEY]: price }), [price, params]); // eslint-disable-line react-hooks/exhaustive-deps
  const engine = useEngine(scenario, overrides, useMemo(() => (whatIf ? [whatIf] : []), [whatIf]));
  const runs = engine.runs.data;
  const plan = runs?.plan;
  const playMs = horizon * MS_PER_YEAR;

  // The year counter runs alongside the chart's own drawing animation.
  useEffect(() => {
    if (playYear === null) return;
    if (playYear >= horizon) { const done = setTimeout(() => setPlayYear(null), 1200); return () => clearTimeout(done); }
    const next = setTimeout(() => setPlayYear(playYear + 1), MS_PER_YEAR);
    return () => clearTimeout(next);
  }, [playYear, horizon]);

  function play() {
    if (playYear !== null) { setPlayYear(null); return; }
    setPlayToken(token => token + 1);
    setPlayYear(0);
  }

  const world = (whatIf && runs?.[whatIf]) || plan;
  const rows = useMemo(() => (world ? totals(world, horizon, staffEffects) : []), [world, horizon, staffEffects]);

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
  const last = rows.at(-1);
  const endValue = last ? last.nothing - last.upgrade : 0;
  const payback = crossing(rows);
  const residual = world?.finance.years.find(y => y.year === horizon)?.residual_value ?? 0;
  const fan = engine.futures.data?.summary.plan?.fan.cash.filter(p => p.year <= horizon) ?? null;
  const goodPayback = fan ? fanPayback(fan.map(p => ({ year: p.year, value: p.p90 }))) : null;
  const badPayback = fan ? fanPayback(fan.map(p => ({ year: p.year, value: p.p10 }))) : null;
  const breakeven = engine.breakeven.data?.npv_cash;
  const flags = (finance?.flags ?? []).filter(flag => !isContextFlag(flag) && (flag.year === undefined || flag.year <= horizon));
  const contextFlags = (finance?.flags ?? []).filter(flag => isContextFlag(flag) && (flag.year === undefined || flag.year <= horizon));
  const today = plan?.snapshot_baseline.building;
  const after = plan?.snapshot.building;
  const breakevenPct = breakeven?.value != null ? ((breakeven.value - PRICE_MIN) / (PRICE_MAX - PRICE_MIN)) * 100 : null;

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-4 py-8 md:px-8">
      <section aria-label="What changed" className="flex flex-col gap-4 rounded-xl border bg-card p-4 md:flex-row md:items-center md:justify-between md:p-5">
        <div className="flex flex-col gap-3">
          <Link to="/" className="flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-4" /> Change the plan
          </Link>
          {scenario.length === 0 && <p className="text-lg font-semibold">No changes: this is today’s building.</p>}
          <ul className="flex flex-col gap-2">
            {scenario.map((swap, index) => (
              <li key={index} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="text-sm font-medium text-muted-foreground">{groupLabels[swap.group] ?? swap.group} · {where(swap)}</span>
                <span className="flex flex-wrap items-center gap-2 text-lg">
                  <span className="text-muted-foreground line-through decoration-1">{installedOption(engine.catalog.data, swap) ?? 'Today’s setup'}</span>
                  <ArrowRight className="size-4 text-muted-foreground" />
                  <span className="font-semibold">{optionName(engine.catalog.data, swap.group, swap.option) ?? swap.option}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div className="flex flex-col gap-0.5 md:items-end">
          <span className="text-sm text-muted-foreground">Up-front cost{read.isDemo && ' · demo plan'}</span>
          <span className="text-2xl font-semibold tracking-tight tabular-nums">{finance ? chf(finance.capex_year0) : '…'}</span>
        </div>
      </section>

      <section aria-label="Verdict" className="flex flex-col gap-2">
        {finance ? (
          <p className="text-4xl font-semibold tracking-tight text-balance md:text-5xl">
            After {horizon} years: {endValue >= 0 ? 'ahead by ' : 'behind by '}
            <span className={cn(endValue < 0 ? 'text-warning' : 'text-primary')}>{chfShort(Math.abs(endValue))}</span>
          </p>
        ) : <Skeleton className="h-14 w-full max-w-2xl" />}
        <p className="text-lg text-muted-foreground text-pretty">
          Compared with doing nothing{whatIf ? `, if ${whatIfLabels[whatIf].toLowerCase()} happens` : ''}{staffEffects ? ', counting staff effects' : ''}.
          {Math.abs(residual) >= 50_000 && residual < 0 && ` Doing nothing would also leave you with ${chfShort(-residual)} more equipment value at the end.`}
        </p>
      </section>

      <dl aria-label="Today and after" className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border md:grid-cols-4">
        {[
          { label: 'Energy bill, year 1', before: today && chfShort(today.costs_chf.energy), now: after && chfShort(after.costs_chf.energy) },
          { label: 'Energy use, year 1', before: today && kwh(today.kwh_year), now: after && kwh(after.kwh_year) },
          { label: 'CO₂ in meeting rooms', before: today && `${Math.round(today.outcomes.meeting_co2_ppm)} ppm`, now: after && `${Math.round(after.outcomes.meeting_co2_ppm)} ppm` },
          { label: 'Pays back in', before: null, now: finance ? (payback !== null ? years(payback) : `not within ${horizon} years`) : null },
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

      <section aria-label="Money over time" className="flex flex-col gap-5 rounded-xl border bg-card p-4 shadow-[0_1px_2px_oklch(0_0_0/0.04),0_8px_24px_-12px_oklch(0.3_0.02_60/0.14)] md:p-6">
        <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-4">
          <div className="flex flex-col gap-1">
            <h2 className="text-base font-semibold">Money compared with doing nothing</h2>
            <p className="text-sm text-muted-foreground">Only the costs that depend on your choice, added up year by year.</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <ToggleGroup type="single" variant="outline" value={String(horizon)} aria-label="Years to show"
              onValueChange={(value: string) => value && setHorizon(Number(value))}>
              {HORIZONS.map(h => <ToggleGroupItem key={h} value={String(h)} className="px-3 tabular-nums">{h} years</ToggleGroupItem>)}
            </ToggleGroup>
            <Button size="lg" onClick={play} disabled={!plan} className="min-w-36 tabular-nums">
              {playYear === null ? <Play data-icon="inline-start" /> : <Pause data-icon="inline-start" />}
              {playYear === null ? `Play ${horizon} years` : playYear === 0 ? 'Today' : `Year ${playYear}`}
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-2 border-t pt-4">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <span id="what-if-label" className="text-sm font-medium">What if the world changes?</span>
            <ToggleGroup type="single" variant="outline" value={whatIf ?? ''} aria-labelledby="what-if-label"
              onValueChange={(value: string) => setWhatIf((WHAT_IFS as readonly string[]).includes(value) ? (value as WhatIf) : null)}>
              {WHAT_IFS.map(id => (
                <ToggleGroupItem key={id} value={id} className="gap-2 px-3">
                  <span className="size-2 rounded-[2px]" style={{ background: seriesColor[id] }} />
                  {whatIfLabels[id]}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
          <p className="min-h-5 text-sm text-muted-foreground" aria-live="polite">
            {whatIf ? whatIfDetails[whatIf] : 'Pick one to replay both paths in that world. Click it again to go back.'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-x-10 gap-y-4 border-b pb-4">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-2 text-sm sm:flex-nowrap">
            <span id="price-label" className="shrink-0 text-muted-foreground">Electricity price</span>
            <div className="relative w-72 shrink-0 py-3">
              <Slider min={PRICE_MIN} max={PRICE_MAX} step={0.01} value={[price]} aria-labelledby="price-label"
                onValueChange={([value]) => setPrice(Math.round(value * 100) / 100)} />
              {breakevenPct !== null && breakevenPct >= 0 && breakevenPct <= 100 && !staffEffects && (
                <span className="pointer-events-none absolute top-full -mt-1 -translate-x-1/2 text-xs whitespace-nowrap text-muted-foreground" style={{ left: `${breakevenPct}%` }}>
                  ▲ pays off above {breakeven?.value?.toFixed(2)}
                </span>
              )}
            </div>
            <span className="w-28 whitespace-nowrap font-medium tabular-nums">{pricePerKwh(price)}</span>
            <Button variant="ghost" size="sm" onClick={() => setPrice(TODAY_PRICE)}
              className={cn(Math.abs(price - TODAY_PRICE) < 0.001 && 'invisible')}>Back to today</Button>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <Switch id="staff-effects" checked={staffEffects} onCheckedChange={setStaffEffects} />
            <label htmlFor="staff-effects">Count staff effects <span className="text-muted-foreground">(depends on guesses)</span></label>
          </div>
        </div>

        {runs ? (
          <MoneyChart rows={rows} horizon={horizon} staffEffects={staffEffects} playToken={playToken} playMs={playMs}
            equipment={[...new Set(scenario.map(swap => (groupLabels[swap.group] ?? swap.group).toLowerCase()))].join(' and ') || 'equipment'} />
        ) : <Skeleton className="h-[28rem] w-full" />}

        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 text-sm text-muted-foreground">
          <p className="flex flex-wrap gap-x-6 gap-y-1">
            <span className="flex items-center gap-2"><span className="h-3 w-5 rounded-sm bg-chart-3/25" />Green: the upgrade has spent less</span>
            <span className="flex items-center gap-2"><span className="h-3 w-5 rounded-sm bg-warning/15" />Red: the upgrade has spent more</span>
            {staffEffects && <span className="flex items-center gap-2"><svg aria-hidden="true" width="20" height="4" className="text-chart-1"><line x1="0" y1="2" x2="20" y2="2" stroke="currentColor" strokeWidth="2" strokeDasharray="5 3" /></svg>Dashed: includes lost staff value, a guess</span>}
          </p>
          {fan && !staffEffects && !whatIf && (
            <p className="text-foreground">
              Across 200 possible futures: paid for itself by {goodPayback !== null ? `year ${goodPayback.toFixed(1)}` : `—`} in good ones,{' '}
              {badPayback !== null ? `by year ${badPayback.toFixed(1)} in bad ones` : `not within ${horizon} years in bad ones`}.
            </p>
          )}
        </div>
      </section>

      <div className="grid gap-8 lg:grid-cols-2">
        <section aria-label="Where the money comes from" className="flex flex-col gap-4 rounded-xl border bg-card p-4 md:p-6">
          <div className="flex flex-col gap-1">
            <h2 className="text-base font-semibold">Where the money comes from</h2>
            <p className="text-sm text-muted-foreground">Over 15 years, with future francs counted at today’s value.</p>
          </div>
          {finance ? <MoneyBreakdown breakdown={finance.npv_breakdown} staffEffects={staffEffects} /> : <Skeleton className="h-40 w-full" />}
        </section>

        <section aria-label="Warnings" className="flex flex-col gap-3 rounded-xl border bg-card p-4 md:p-6">
          <h2 className="text-base font-semibold">Warnings</h2>
          {flags.length === 0 && contextFlags.length === 0 && <p className="text-sm text-muted-foreground">No warnings for this plan.</p>}
          <ul className="flex flex-col gap-2">
            {flags.map(flag => {
              const shown = playYear === null || flag.year === undefined || flag.year <= playYear;
              return (
                <li key={`${flag.type}-${flag.year}`} className={cn('flex items-start gap-3 rounded-lg bg-warning/8 px-3 py-2.5 text-sm transition-[opacity,translate] duration-500 ease-out', !shown && 'translate-y-1 opacity-0')}>
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
      </div>

      <footer className="text-sm text-muted-foreground">The building is real. The numbers are our assumptions.</footer>
    </main>
  );
}
