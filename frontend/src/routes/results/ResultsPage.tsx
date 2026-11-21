import { ArrowLeft, ArrowRight, Dices, Eye, EyeOff, Pause, Play, TriangleAlert } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router';
import type { Catalog, FutureSample, FuturePathView, Scenario, Swap } from '@/api/types';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Slider } from '@/components/ui/slider';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { cn } from '@/lib/utils';
import { readConfig } from './config';
import { chf, chfShort, kwh, pricePerKwh, years } from './format';
import { flagText, groupLabels, isContextFlag, seriesColor, whatIfDetails, whatIfLabels } from './labels';
import MoneyBreakdown from './MoneyBreakdown';
import SimulationIntro from './SimulationIntro';
import PlayStory, { storyBeats } from './PlayStory';
import PlansChart, { paybackYear, type ExampleNote, type PlanLine } from './PlansChart';
import { FUTURES_N, useEngine, WHAT_IFS, type WhatIf } from './useEngine';

const PRICE_KEY = 'electricity_price_chf_kwh';
const TODAY_PRICE = 0.2;
const PRICE_MIN = 0.1;
const PRICE_MAX = 0.45;
const HORIZONS = [5, 10, 15] as const;
type Timing = 'now' | 'end_of_life' | number;
const TIMINGS: { value: Timing; label: string }[] = [
  { value: 'now', label: 'Now' },
  { value: 'end_of_life', label: 'When the old units wear out' },
  { value: 5, label: 'In year 5' },
  { value: 8, label: 'In year 8' },
];
const MS_PER_YEAR = 400;
/** One fixed colour per plan, by its place in the list. The first is the brand orange. */
const PLAN_COLORS = ['#c34e00', '#2f6fc0', '#a3368f', '#0f766e', '#6f7f1f', '#7c5a00'];

/** The same plan, bought at the chosen time. The engine keeps the old units running until then. */
function withTiming(scenario: Scenario, timing: Timing): Scenario {
  return scenario.map(swap => {
    const { timing: _t, year: _y, ...rest } = swap;
    if (timing === 'now') return rest;
    return timing === 'end_of_life' ? { ...rest, timing: 'end_of_life' as const } : { ...rest, year: timing };
  });
}

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

/** True only after `on` has stayed true for `ms`: avoids a flash of "Recalculating" for instant answers. */
function useDelayed(on: boolean, ms: number) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!on) { setShown(false); return; }
    const timer = setTimeout(() => setShown(true), ms);
    return () => clearTimeout(timer);
  }, [on, ms]);
  return shown;
}

/** "9.0 years", or "over 15 years" when it does not pay back within the years shown. */
const paybackText = (value: number | null, horizon: number) => (value === null ? `over ${horizon} years` : years(value));

const floorName = (floor: number) => (floor === -1 ? 'basement' : floor === 0 ? 'ground floor' : `floor ${floor}`);

/** Failures in one example future of old equipment that this plan touches, one per year and group. */
function planFailures(sample: FutureSample | null, scenario: Scenario, horizon: number) {
  if (!sample) return [];
  const touched = (group: string, floors: number[]) => scenario.some(swap => swap.group === group
    && (swap.floor === undefined || floors.length === 0 || floors.includes(swap.floor)));
  return sample.failures.filter(f => f.year <= horizon && touched(f.group, f.floors));
}

/** Notes on the example line. Only the 3 most expensive get a text label; the others are dots. */
function exampleNotes(failures: FutureSample['failures']): ExampleNote[] {
  const labelled = new Set([...failures].sort((a, b) => b.cost - a.cost).slice(0, 3));
  return failures.map(f => {
    const name = groupLabels[f.group] ?? f.group;
    const where = f.group === 'ventilation' && f.floors.length ? ` (${f.floors.map(floorName).join(', ')})`
      : f.rows > 1 ? ` (${f.rows} rooms)` : '';
    return { year: f.year, text: `Old ${name.toLowerCase()} fails${where}: ${chfShort(f.cost)}`, label: labelled.has(f) ? `${name} fails` : '' };
  });
}

/** One short story of an example future: the world, then the old equipment of this plan. */
function storyText(sample: FutureSample, failures: FutureSample['failures']) {
  const parts: string[] = [];
  const price = /price ends at ([\d.]+)x today/.exec(sample.what_happened);
  if (price) {
    const change = Math.round((Number(price[1]) - 1) * 100);
    parts.push(change === 0 ? 'Electricity ends at today’s price' : `Electricity ends ${Math.abs(change)}% ${change > 0 ? 'above' : 'below'} today’s price`);
  }
  const count = (id: string) => sample.events.filter(e => e.id === id).length;
  const heat = count('heatwave_summer');
  const spikes = count('energy_price_spike');
  const lab = sample.events.find(e => e.id === 'new_lab');
  const world = [
    heat && `${heat} heatwave ${heat === 1 ? 'summer' : 'summers'}`,
    spikes && `${spikes} price ${spikes === 1 ? 'spike' : 'spikes'}`,
    lab ? `the new lab in year ${lab.start_year}` : 'no new lab',
  ].filter(Boolean);
  parts.push(world.join(', '));
  const byGroup = new Map<string, number[]>();
  for (const f of failures) byGroup.set(f.group, [...(byGroup.get(f.group) ?? []), f.year]);
  for (const [group, years] of byGroup) {
    const list = years.length === 1 ? `year ${years[0]}` : `years ${years.slice(0, -1).join(', ')} and ${years.at(-1)}`;
    parts.push(`Old ${(groupLabels[group] ?? group).toLowerCase()} fails in ${list}`);
  }
  if (!byGroup.size) parts.push('The old equipment of this plan lasts all these years');
  return `${parts.join('. ')}.`;
}

export default function ResultsPage() {
  const [params] = useSearchParams();
  const location = useLocation();
  // Coming from the building's Simulate button: show the short simulating screen first.
  const [intro, setIntro] = useState(() => Boolean((location.state as { intro?: boolean } | null)?.intro));
  const read = readConfig(params);
  const [timing, setTiming] = useState<Timing>('now');
  const plans = useMemo(() => read?.config.plans ?? [], [params]); // eslint-disable-line react-hooks/exhaustive-deps
  const multi = plans.length > 1;
  // The plan shown in detail. The others stay on the chart; any can be hidden.
  const [selected, setSelected] = useState(read?.config.selected ?? 0);
  const [hidden, setHidden] = useState<ReadonlySet<number>>(() => new Set());
  const [hovered, setHovered] = useState<number | null>(null);
  const chosen = plans[selected]?.scenario ?? [];
  const scenario = useMemo(() => withTiming(chosen, timing), [chosen, timing]);
  const allScenarios = useMemo(() => plans.map(plan => withTiming(plan.scenario, timing)), [plans, timing]);

  const [price, setPrice] = useState(read?.config.overrides[PRICE_KEY] ?? TODAY_PRICE);
  const [settledPrice, setSettledPrice] = useState(price);
  const [whatIf, setWhatIf] = useState<WhatIf | null>(null);
  const [staffEffects, setStaffEffects] = useState(false);
  const [horizon, setHorizon] = useState<number>(15);
  const [playToken, setPlayToken] = useState(0);
  const [playYear, setPlayYear] = useState<number | null>(null);
  const [playState, setPlayState] = useState<'idle' | 'playing' | 'paused'>('idle');

  const overrides = useMemo(() => ({ ...(read?.config.overrides ?? {}), [PRICE_KEY]: price }), [price, params]); // eslint-disable-line react-hooks/exhaustive-deps
  const settled = useMemo(() => ({ ...(read?.config.overrides ?? {}), [PRICE_KEY]: settledPrice }), [settledPrice, params]); // eslint-disable-line react-hooks/exhaustive-deps
  const engine = useEngine(scenario, allScenarios, overrides, settled, whatIf);
  const runs = engine.runs.data;
  const plan = runs?.plan;
  // An engine started before the futures update answers without these fields: say so instead of drawing nonsense.
  const outdated = Boolean(engine.futures.data && Object.values(engine.futures.data.summary)
    .some(s => typeof s.start !== 'number' || !s.fan.cash_running) || (engine.futures.data && !engine.futures.data.samples));
  const futures = outdated ? null : engine.futures.data;
  const busy = useDelayed(engine.futures.loading, 200);
  // One example future at a time ("Show one possible future"); null shows all futures as a band.
  const [exampleIndex, setExampleIndex] = useState<number | null>(null);
  const example = exampleIndex !== null && futures?.samples.length ? futures.samples[exampleIndex % futures.samples.length] : null;

  // Play always plays one real future, so the events it tells match the line it draws.
  // Without a chosen example it pins the typical future: the one closest to the middle line.
  const typicalRef = useRef(0);

  /** Play starts from today; while playing it pauses; while paused it resumes. */
  function play() {
    if (playState === 'playing') { setPlayState('paused'); return; }
    if (playState === 'idle') {
      if (exampleIndex === null) setExampleIndex(typicalRef.current);
      setPlayToken(token => token + 1);
      setPlayYear(0);
    }
    setPlayState('playing');
  }

  // After the simulating screen, the chart plays the typical future once, so the story starts moving straight away.
  const endIntro = useCallback(() => {
    setIntro(false);
    setExampleIndex(index => index ?? typicalRef.current);
    setPlayToken(token => token + 1);
    setPlayYear(0);
    setPlayState('playing');
  }, []);

  const onYear = useCallback((year: number | null) => {
    setPlayYear(year);
    if (year === null) setPlayState('idle');
  }, []);

  const world = (whatIf && runs?.[whatIf]) || plan;
  // Each plan from the 200 futures: the middle future and the range where 8 in 10 land. Index = year (0 = today).
  // Money is counted without the value of equipment still standing at the end (see the sentence under the verdict).
  const view: FuturePathView = staffEffects ? 'economic_running' : 'cash_running';
  const planLines = useMemo(() => plans.map((p, index): PlanLine | null => {
    const s = futures?.summary[`p${index}`];
    if (!s) return null;
    const fan = s.fan[view].filter(f => f.year <= horizon);
    const path = example?.paths[`p${index}`];
    return {
      id: index, name: p.name, color: PLAN_COLORS[index % PLAN_COLORS.length],
      middle: [s.start, ...fan.map(f => f.p50)],
      low: [s.start, ...fan.map(f => f.p10)],
      high: [s.start, ...fan.map(f => f.p90)],
      example: path ? [path.start, ...path[view].slice(0, horizon)] : null,
    };
  }), [plans, futures, view, horizon, example]);
  const lines = useMemo(() => planLines.filter((line): line is PlanLine => line !== null && (line.id === selected || !hidden.has(line.id))),
    [planLines, selected, hidden]);
  const failures = useMemo(() => planFailures(example, chosen, horizon), [example, chosen, horizon]);
  const typicalIndex = useMemo(() => {
    const middle = planLines[selected]?.middle;
    if (!futures?.samples.length || !middle) return 0;
    const distance = (sample: FutureSample) => sample.paths[`p${selected}`][view].slice(0, horizon)
      .reduce((sum, value, k) => sum + Math.abs(value - middle[k + 1]), 0);
    return futures.samples.reduce((best, sample, k, all) => (distance(sample) < distance(all[best]) ? k : best), 0);
  }, [futures, planLines, selected, view, horizon]);
  typicalRef.current = typicalIndex;
  const notes = useMemo(() => exampleNotes(failures), [failures]);

  function selectPlan(index: number) {
    setSelected(index);
    setHidden(previous => { const next = new Set(previous); next.delete(index); return next; });
  }

  function toggleHidden(index: number) {
    setHidden(previous => {
      const next = new Set(previous);
      if (next.has(index)) next.delete(index); else next.add(index);
      return next;
    });
  }

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
  const yearlySaving = finance?.years[0] ? finance.years[0].operating_cost_baseline - finance.years[0].operating_cost : null;
  // The year the upgrade is paid for: today, or the first year its equipment spending differs from doing nothing.
  const boughtIn = !finance ? null : finance.capex_year0 > 0 ? 0
    : finance.years.find(y => Math.abs(y.capex - y.capex_baseline) > 1000)?.year ?? null;
  // Price of the new equipment (same in any year: all prices are in today's francs).
  const purchase = chosen.reduce((sum, swap) => {
    const price = engine.catalog.data?.groups[swap.group]?.find(o => o.option_id === swap.option)?.price_chf_per_unit ?? 0;
    const units = (engine.catalog.data?.items ?? []).filter(item => item.group === swap.group
      && (swap.floor === undefined || item.serves_floor === swap.floor)).reduce((n, item) => n + item.units, 0);
    return sum + price * units;
  }, 0);
  const focus = planLines[selected] ?? null;
  const endValue = focus?.middle[horizon] ?? 0;
  const payback = focus ? paybackYear(focus.middle) : null;
  const goodPayback = focus ? paybackYear(focus.high) : null;
  const badPayback = focus ? paybackYear(focus.low) : null;
  const residual = world?.finance.years.find(y => y.year === horizon)?.residual_value ?? 0;
  const breakdown = futures?.summary[`p${selected}`]?.npv_breakdown_mean ?? finance?.npv_breakdown;
  const flags = (finance?.flags ?? []).filter(flag => !isContextFlag(flag) && (flag.year === undefined || flag.year <= horizon));
  const contextFlags = (finance?.flags ?? []).filter(flag => isContextFlag(flag) && (flag.year === undefined || flag.year <= horizon));
  const subject = multi ? plans[selected]?.name : 'the upgrade';
  const beats = example ? storyBeats(example, failures, { boughtIn, purchase, timing, horizon, subject }) : [];
  const today = plan?.snapshot_baseline.building;
  const after = plan?.snapshot.building;

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-4 py-8 md:px-8">
      {intro && (
        <SimulationIntro ready={Boolean(plan && (futures || outdated || engine.futures.error) && engine.catalog.data)} onDone={endIntro}
          changes={chosen.map(swap => `${groupLabels[swap.group] ?? swap.group} → ${optionName(engine.catalog.data, swap.group, swap.option) ?? swap.option}`)} />
      )}
      <Button asChild variant="outline" size="lg" className="w-fit">
        <Link to="/"><ArrowLeft data-icon="inline-start" /> Change the plan</Link>
      </Button>

      {multi && (
        <section aria-label="Your plans" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
            <h2 className="text-base font-semibold">Your plans</h2>
            <p className="text-sm text-muted-foreground">Click a plan to see it in detail. Use the eye to hide a plan from the chart.</p>
          </div>
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {plans.map((p, index) => {
              const value = planLines[index]?.middle[horizon] ?? null;
              const isSelected = index === selected;
              const isHidden = hidden.has(index) && !isSelected;
              return (
                <li key={index} onMouseEnter={() => setHovered(index)} onMouseLeave={() => setHovered(null)}
                  className={cn('flex items-stretch overflow-hidden rounded-xl border bg-card transition-[border-color,box-shadow,opacity] duration-200',
                    isSelected ? 'border-transparent ring-2' : 'hover:border-foreground/20', isHidden && 'opacity-55')}
                  style={isSelected ? { ['--tw-ring-color' as string]: PLAN_COLORS[index % PLAN_COLORS.length] } : undefined}>
                  <button type="button" onClick={() => selectPlan(index)} aria-pressed={isSelected}
                    className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring">
                    <span aria-hidden="true" className="h-8 w-1.5 shrink-0 rounded-full" style={{ background: PLAN_COLORS[index % PLAN_COLORS.length] }} />
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate font-semibold">{p.name}</span>
                      <span className="truncate text-sm text-muted-foreground tabular-nums">
                        {value === null ? '…' : value >= 0 ? <>saves <b className="font-semibold text-foreground">{chfShort(value)}</b> in {horizon} years</>
                          : <>still needs {chfShort(-value)} after {horizon} years</>}
                      </span>
                    </span>
                  </button>
                  {!isSelected && (
                    <button type="button" onClick={() => toggleHidden(index)} aria-label={isHidden ? `Show ${p.name} on the chart` : `Hide ${p.name} from the chart`}
                      className="flex w-11 shrink-0 items-center justify-center border-l text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring">
                      {isHidden ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section aria-label="What changed" className="flex flex-col gap-4 rounded-xl border bg-card p-4 md:flex-row md:items-center md:justify-between md:p-5">
        <div className="flex flex-col gap-3">
          {multi && <h2 className="text-sm font-semibold">{plans[selected]?.name}</h2>}
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
          <span className="text-sm text-muted-foreground">{boughtIn === 0 ? 'Paid today' : boughtIn ? `Bought in year ${boughtIn}` : 'Cost'}{read.isDemo && ' · demo plan'}</span>
          <span className="text-2xl font-semibold tracking-tight tabular-nums">{finance ? chf(purchase) : '…'}</span>
        </div>
      </section>


      <section aria-label="Verdict" className="flex flex-col gap-2">
        {focus ? (
          <p className={cn("font-semibold tracking-tight text-balance", endValue >= 0 ? "text-4xl md:text-5xl" : "text-2xl sm:text-3xl")}>
            {endValue >= 0 ? <>After {horizon} years, {subject} has saved <span className="text-primary">{chfShort(endValue)}</span></>
              : <>After {horizon} years, {subject} still needs <span className="text-warning">{chfShort(-endValue)}</span> to pay for itself</>}
          </p>
        ) : <Skeleton className="h-14 w-full max-w-2xl" />}
        <p className="text-lg text-muted-foreground text-pretty">
          {focus && `In the middle of ${FUTURES_N} possible futures. In 8 of 10, the result is between ${chfShort(focus.low[horizon])} and ${chfShort(focus.high[horizon])}.`}
          {endValue >= 0 ? ' Saved means: doing nothing would have cost this much more.' : ''}
          {whatIf ? ` This is with: ${whatIfLabels[whatIf].toLowerCase()}.` : ''}{staffEffects ? ' Staff effects are counted.' : ''}
          {Math.abs(residual) >= 50_000 && residual < 0 && ` Doing nothing would also leave you with ${chfShort(-residual)} more equipment value at the end.`}
        </p>
      </section>

      <dl aria-label="Today and after" className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border md:grid-cols-4">
        {[
          { label: 'Energy bill, year 1', sub: today && `today ${chfShort(today.costs_chf.energy)}`, now: after && chfShort(after.costs_chf.energy) },
          { label: 'Energy use, year 1', sub: today && `today ${kwh(today.kwh_year)}`, now: after && kwh(after.kwh_year) },
          { label: 'CO₂ in meeting rooms', sub: today && `today ${Math.round(today.outcomes.meeting_co2_ppm)} ppm`, now: after && `${Math.round(after.outcomes.meeting_co2_ppm)} ppm` },
          { label: 'Pays back in', now: focus ? (payback !== null ? years(payback) : `not within ${horizon} years`) : null,
            sub: focus && (goodPayback === null ? null : `8 in 10: ${years(goodPayback)} to ${paybackText(badPayback, horizon)}`) },
        ].map(stat => (
          <div key={stat.label} className="flex flex-col gap-1 bg-card px-5 py-4">
            <dt className="text-sm text-muted-foreground">{stat.label}</dt>
            <dd className="flex flex-wrap items-baseline gap-x-2 tabular-nums">
              <span className="whitespace-nowrap text-2xl font-semibold tracking-tight">{stat.now ?? '…'}</span>
              {stat.sub && <span className="whitespace-nowrap text-sm text-muted-foreground">{stat.sub}</span>}
            </dd>
          </div>
        ))}
      </dl>

      <section aria-label="Money over time" className="flex flex-col gap-5 rounded-xl border bg-card p-4 shadow-[0_1px_2px_oklch(0_0_0/0.04),0_8px_24px_-12px_oklch(0.3_0.02_60/0.14)] md:p-6">
        <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-4">
          <div className="flex flex-col gap-1">
            <h2 className="text-base font-semibold">Money saved compared with doing nothing</h2>
            <p className="text-sm text-muted-foreground">{multi ? 'Each plan starts' : 'The plan starts'} below the grey line by its price. Where it crosses the grey line, it has paid for itself.</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <ToggleGroup type="single" variant="outline" value={String(horizon)} aria-label="Years to show"
              onValueChange={(value: string) => value && setHorizon(Number(value))}>
              {HORIZONS.map(h => <ToggleGroupItem key={h} value={String(h)} className="px-3 tabular-nums">{h} years</ToggleGroupItem>)}
            </ToggleGroup>
            <Button size="lg" onClick={play} disabled={!plan} className="min-w-36 tabular-nums">
              {playState === 'playing' ? <Pause data-icon="inline-start" /> : <Play data-icon="inline-start" />}
              {playState === 'idle' ? `Play ${horizon} years`
                : `${playState === 'playing' ? 'Pause' : 'Resume'} · ${playYear ? `year ${playYear}` : 'today'}`}
            </Button>
          </div>
        </div>

        {chosen.length > 0 && (
          <div className="flex flex-col gap-2 border-t pt-4">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <span id="timing-label" className="text-sm font-medium">When to buy?</span>
              <ToggleGroup type="single" variant="outline" value={String(timing)} aria-labelledby="timing-label"
                onValueChange={(value: string) => value && setTiming(value === 'now' || value === 'end_of_life' ? value : Number(value))}>
                {TIMINGS.map(option => <ToggleGroupItem key={String(option.value)} value={String(option.value)} className="px-3">{option.label}</ToggleGroupItem>)}
              </ToggleGroup>
            </div>
            <p className="min-h-5 text-sm text-muted-foreground">
              {timing === 'now' ? 'You pay the full price today.'
                : timing === 'end_of_life' ? 'Keep the old units until they fail, then buy the upgrade instead of the same old kind.'
                : `Keep the old units until year ${timing}, replacing them like-for-like if they fail first.`}
            </p>
          </div>
        )}

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
            {whatIf ? whatIfDetails[whatIf] : `Pick one to add it to all ${FUTURES_N} futures. Click it again to go back.`}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-x-10 gap-y-4 border-b pb-4">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
            <span id="price-label" className="shrink-0 text-muted-foreground">Electricity price</span>
            <div className="relative w-72 shrink-0 py-3">
              <Slider min={PRICE_MIN} max={PRICE_MAX} step={0.01} value={[price]} aria-labelledby="price-label"
                onValueChange={([value]) => setPrice(Math.round(value * 100) / 100)}
                onValueCommit={([value]) => setSettledPrice(Math.round(value * 100) / 100)} />
            </div>
            <span className="w-28 whitespace-nowrap font-medium tabular-nums">{pricePerKwh(price)}</span>
            {yearlySaving !== null && (
              <span className="w-72 whitespace-nowrap text-muted-foreground tabular-nums">
                {yearlySaving >= 0 ? <>the upgrade saves <b className="font-semibold text-foreground">{chfShort(yearlySaving)} a year</b> on bills</>
                  : <>the upgrade costs <b className="font-semibold text-foreground">{chfShort(-yearlySaving)} a year</b> more in bills</>}
              </span>
            )}
            <Button variant="ghost" size="sm" onClick={() => { setPrice(TODAY_PRICE); setSettledPrice(TODAY_PRICE); }}
              className={cn('shrink-0', Math.abs(price - TODAY_PRICE) < 0.001 && 'invisible')}>Back to today</Button>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <Switch id="staff-effects" checked={staffEffects} onCheckedChange={setStaffEffects} />
            <label htmlFor="staff-effects">Count staff effects <span className="text-muted-foreground">(depends on guesses)</span></label>
          </div>
        </div>

        {futures ? (
          <div className="relative">
            <div className={cn('transition-opacity duration-200', busy && 'opacity-60')}>
              <PlansChart lines={lines} selected={selected} highlighted={hovered} horizon={horizon} dashed={staffEffects} notes={notes}
                onSelect={selectPlan} playToken={playToken} playing={playState === 'playing'} msPerYear={MS_PER_YEAR} onYear={onYear} />
            </div>
            {busy && (
              <span className="absolute top-2 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full border bg-card px-3 py-1.5 text-sm shadow-sm">
                <Spinner /> Running {FUTURES_N} possible futures…
              </span>
            )}
          </div>
        ) : engine.futures.error || outdated ? (
          <Alert variant="destructive">
            <TriangleAlert />
            <AlertTitle>{outdated ? 'The engine is out of date.' : 'The possible futures could not be worked out.'}</AlertTitle>
            <AlertDescription>Restart the engine with <code className="font-mono">make dev</code>, then reload this page.</AlertDescription>
          </Alert>
        ) : <Skeleton className="h-[28rem] w-full" />}

        <PlayStory beats={beats} playYear={playState === 'idle' ? null : playYear} planColor={PLAN_COLORS[selected % PLAN_COLORS.length]} empty={!example} />

        <p className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted-foreground">
          <span className="flex items-center gap-2">
            <span className="h-3 w-5 rounded-sm" style={{ background: `color-mix(in oklch, ${PLAN_COLORS[selected % PLAN_COLORS.length]} 20%, transparent)` }} />
            Pale band: 8 in 10 possible futures land here
          </span>
          <span className="flex items-center gap-2">
            <span className="h-0.5 w-5 rounded-full" style={{ background: PLAN_COLORS[selected % PLAN_COLORS.length] }} />
            {example ? 'Bold line: the one future shown' : 'Line: the middle future'}
          </span>
          {staffEffects && <span className="flex items-center gap-2"><svg aria-hidden="true" width="20" height="4" className="text-chart-1"><line x1="0" y1="2" x2="20" y2="2" stroke="currentColor" strokeWidth="2" strokeDasharray="5 3" /></svg>Dashed: includes staff effects, a guess</span>}
        </p>

        <div className="flex flex-col gap-3 border-t pt-4 md:flex-row md:items-start md:gap-6">
          <div className="flex shrink-0 items-center gap-2">
            <Button variant="outline" size="lg" disabled={!futures} className="w-60"
              onClick={() => setExampleIndex(index => (index === null ? 0 : index + 1))}>
              <Dices data-icon="inline-start" />
              {example ? 'Show another future' : 'Show one possible future'}
            </Button>
            <Button variant="ghost" size="lg" onClick={() => setExampleIndex(null)} className={cn(!example && 'invisible')}>
              Back to all futures
            </Button>
          </div>
          <p className="h-16 overflow-hidden text-sm text-pretty" aria-live="polite">
            {example && futures ? (
              <>
                <span className="font-semibold">Future {((exampleIndex ?? 0) % futures.samples.length) + 1} of {futures.samples.length}{(exampleIndex ?? 0) % futures.samples.length === typicalIndex ? ', the one closest to the middle line' : ''}. </span>
                {storyText(example, failures)}
              </>
            ) : (
              <span className="text-muted-foreground">
                The engine ran {FUTURES_N} possible futures. In each, prices move, heatwaves come, and old equipment fails earlier or later, the way real equipment wears out.
                The line is the middle one. Click the button to see one future on its own.
              </span>
            )}
          </p>
        </div>
      </section>

      <div className="grid gap-8 lg:grid-cols-2">
        <section aria-label="Where the money comes from" className="flex flex-col gap-4 rounded-xl border bg-card p-4 md:p-6">
          <div className="flex flex-col gap-1">
            <h2 className="text-base font-semibold">Where the money comes from</h2>
            <p className="text-sm text-muted-foreground">Average of {FUTURES_N} possible futures over 15 years, with future francs counted at today’s value.</p>
          </div>
          {breakdown ? <MoneyBreakdown breakdown={breakdown} staffEffects={staffEffects} /> : <Skeleton className="h-40 w-full" />}
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
