import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router';
import { api } from '@/api/client';
import type { Catalog, FutureSample, FuturePathView, Scenario, Swap } from '@/api/types';
import { PLAN_COLORS, sameScenario } from '@/twin/plans';
import { usePublishFocus, useTwin } from '@/twin/TwinProvider';
import { readConfig } from './config';
import { groupLabels, isContextFlag, whatIfDetails, whatIfLabels } from './labels';
import type { ExampleNote, PlanLine } from './PlansChart';
import { storyBeats } from './story';
import { FUTURES_N, useEngine, WHAT_IFS, type WhatIf } from './useEngine';

/**
 * Everything the Results page knows, in one place: the plans, the assumptions the viewer can move,
 * the engine answers, and the numbers worked out from them. The page and its parts only read this.
 */

export const PRICE_KEY = 'electricity_price_chf_kwh';
/** 1 = big systems are replaced on a plan; 0 = old equipment runs until it breaks. Only the futures use it. */
const POLICY_KEY = 'replace_on_plan';
export const TODAY_PRICE = 0.2;
export const PRICE_MIN = 0.1;
export const PRICE_MAX = 0.45;
export const HORIZONS = [5, 10, 15] as const;
export type Timing = 'now' | 'end_of_life' | number;
export const TIMINGS: { value: Timing; label: string; short: string }[] = [
  { value: 'now', label: 'Now', short: 'Now' },
  { value: 'end_of_life', label: 'When the old units wear out', short: 'Worn out' },
  { value: 5, label: 'In year 5', short: 'Year 5' },
  { value: 8, label: 'In year 8', short: 'Year 8' },
];
/** Play speed: slow enough to talk over. The chart also holds briefly on each year where something happens. */
export const MS_PER_YEAR = 650;
/** A plan's colour: the one it has in the building and the assistant. Older addresses fall back to its place in the list. */
function colorFor(plan: { color?: string } | undefined, index: number) {
  const color = plan?.color;
  return typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color) ? color : PLAN_COLORS[index % PLAN_COLORS.length];
}

/** The same plan, bought at the chosen time. The engine keeps the old units running until then. */
function withTiming(scenario: Scenario, timing: Timing): Scenario {
  return scenario.map(swap => {
    // A played game's decisions keep the years they were made in (Play mode, "firm").
    if ((swap as Swap & { firm?: boolean }).firm) return swap;
    const { timing: _t, year: _y, ...rest } = swap;
    if (timing === 'now') return rest;
    return timing === 'end_of_life' ? { ...rest, timing: 'end_of_life' as const } : { ...rest, year: timing };
  });
}

export function optionName(catalog: Catalog | null, group: string, optionId: string | undefined) {
  return catalog?.groups[group]?.find(item => item.option_id === optionId)?.name;
}

/** What is installed today for a swap's group (and floor), by the most common option. */
export function installedOption(catalog: Catalog | null, swap: Swap) {
  const items = (catalog?.items ?? []).filter(item => item.group === swap.group
    && (swap.floor === undefined || item.serves_floor === swap.floor));
  const counts = new Map<string, number>();
  for (const item of items) counts.set(item.option_id, (counts.get(item.option_id) ?? 0) + item.units);
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  return optionName(catalog, swap.group, top);
}

export const where = (swap: Swap) => swap.floor === undefined ? 'Whole building'
  : swap.floor === -1 ? 'Basement' : swap.floor === 0 ? 'Ground floor' : `Floor ${swap.floor}`;

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

/** Failures in one example future of old equipment that this plan touches, one per year and group. */
function planFailures(sample: FutureSample | null, scenario: Scenario, horizon: number) {
  if (!sample) return [];
  const touched = (group: string, floors: number[]) => scenario.some(swap => swap.group === group
    && (swap.floor === undefined || floors.length === 0 || floors.includes(swap.floor)));
  return sample.failures.filter(f => f.year <= horizon && touched(f.group, f.floors));
}

/** One short story of an example future: the world, then the old equipment of this plan. */
export function storyText(sample: FutureSample, failures: FutureSample['failures']) {
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
    spikes && `${spikes} energy ${spikes === 1 ? 'crisis' : 'crises'}`,
    lab ? `60 more staff from year ${lab.start_year}` : 'no extra staff',
  ].filter(Boolean);
  parts.push(world.join(', '));
  const byGroup = new Map<string, number[]>();
  for (const f of failures) byGroup.set(f.group, [...(byGroup.get(f.group) ?? []), f.year]);
  for (const [group, years] of byGroup) {
    const list = years.length === 1 ? `year ${years[0]}` : `years ${years.slice(0, -1).join(', ')} and ${years.at(-1)}`;
    parts.push(`Old ${(groupLabels[group] ?? group).toLowerCase()} fails in ${list}`);
  }
  if (!byGroup.size) parts.push('No old equipment of this plan breaks early');
  return `${parts.join('. ')}.`;
}

export function useResultsModel() {
  const [params] = useSearchParams();
  const location = useLocation();
  // Coming from the building's Simulate button: show the short simulating screen first.
  const [intro, setIntro] = useState(() => Boolean((location.state as { intro?: boolean } | null)?.intro));
  const read = readConfig(params);
  const [timing, setTiming] = useState<Timing>('now');
  const plans = useMemo(() => read?.config.plans ?? [], [params]); // eslint-disable-line react-hooks/exhaustive-deps
  const multi = plans.length > 1;
  const colors = useMemo(() => plans.map((plan, index) => colorFor(plan, index)), [plans]);
  const colorOf = (index: number) => colors[index] ?? PLAN_COLORS[index % PLAN_COLORS.length];
  // The plan shown in detail. The others stay on the chart; any can be hidden.
  const [selected, setSelected] = useState(read?.config.selected ?? 0);
  const [hidden, setHidden] = useState<ReadonlySet<number>>(() => new Set());
  const [hovered, setHovered] = useState<number | null>(null);
  const chosen = plans[selected]?.scenario ?? [];
  const scenario = useMemo(() => withTiming(chosen, timing), [chosen, timing]);
  const allScenarios = useMemo(() => plans.map(plan => withTiming(plan.scenario, timing)), [plans, timing]);

  const [price, setPrice] = useState(read?.config.overrides[PRICE_KEY] ?? TODAY_PRICE);
  const [settledPrice, setSettledPrice] = useState(price);
  // A what-if can come with the plans, e.g. from the assistant.
  const [whatIf, setWhatIf] = useState<WhatIf | null>(() => WHAT_IFS.find(id => read?.config.events.includes(id)) ?? null);
  const [staffEffects, setStaffEffects] = useState(false);
  // How the building manager replaces old big systems: on a plan at the end of their normal life, or when they break.
  const [onPlan, setOnPlan] = useState(true);
  const [horizon, setHorizon] = useState<number>(read?.config.horizon ?? 15);
  const [playToken, setPlayToken] = useState(0);
  const [playYear, setPlayYear] = useState<number | null>(null);
  const [playState, setPlayState] = useState<'idle' | 'playing' | 'paused'>('idle');

  const overrides = useMemo(() => ({ ...(read?.config.overrides ?? {}), [PRICE_KEY]: price }), [price, params]); // eslint-disable-line react-hooks/exhaustive-deps
  const settled = useMemo(() => ({ ...(read?.config.overrides ?? {}), [PRICE_KEY]: settledPrice, [POLICY_KEY]: onPlan ? 1 : 0 }), [settledPrice, onPlan, params]); // eslint-disable-line react-hooks/exhaustive-deps
  const engine = useEngine(scenario, allScenarios, overrides, settled, whatIf, read?.config.game);
  // What the selected plan costs to buy, after the solar subsidy: the engine's figure, as in the top bar and the assistant.
  const [upfront, setUpfront] = useState<{ key: string; value: number } | null>(null);
  const chosenKey = JSON.stringify(chosen);
  useEffect(() => {
    let live = true;
    if (!chosen.length) { setUpfront({ key: chosenKey, value: 0 }); return; }
    api.evaluate({ objective: { metric: 'upfront_cost_chf', sense: 'min' } }, chosen)
      .then(e => { const value = e.metrics.upfront_cost_chf; if (live && value !== null) setUpfront({ key: chosenKey, value }); })
      .catch(() => undefined); // The catalog estimate stays on screen.
    return () => { live = false; };
  }, [chosenKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const runs = engine.runs.data;
  const plan = runs?.plan;
  // An engine started before the futures update answers without these fields: say so instead of drawing nonsense.
  const outdated = Boolean(engine.futures.data && Object.values(engine.futures.data.summary)
    .some(s => typeof s.start !== 'number' || !s.fan.cash_running || !s.risk || !s.payback) || (engine.futures.data && !engine.futures.data.samples));
  const futures = outdated ? null : engine.futures.data;
  // The fast single run still answers for another plan or buy date (not just another price): its numbers are stale.
  const runsKeyPrefix = `{"scenario":${JSON.stringify(scenario)},`;
  const runsStale = Boolean(engine.runs.dataKey && !engine.runs.dataKey.startsWith(runsKeyPrefix));
  const busy = useDelayed(engine.futures.loading || runsStale, 200);
  // One example future at a time ("Show one possible future"); null shows all futures as a band.
  const [exampleIndex, setExampleIndex] = useState<number | null>(null);
  const example = exampleIndex !== null && futures?.samples.length ? futures.samples[exampleIndex % futures.samples.length] : null;

  // Play always plays one real future, so the events it tells match the line it draws.
  // Without a chosen example it pins the typical future: the one closest to the middle line.
  const typicalRef = useRef(0);

  /** Play starts from today; while playing it pauses; while paused it resumes. */
  // When Play (or the intro) picked the future itself, the chart goes back to all 200 futures shortly after Play ends,
  // so the page never shows one future's numbers next to the middle of all of them.
  const pinnedByPlay = useRef(false);
  // A played game keeps its own future on the chart after Play: that future is the point of the page.
  const isGame = Boolean(read?.config.game);
  const backTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(backTimer.current), []);

  function play() {
    clearTimeout(backTimer.current);
    if (playState === 'playing') { setPlayState('paused'); return; }
    if (playState === 'idle') {
      if (exampleIndex === null) { pinnedByPlay.current = !isGame; setExampleIndex(typicalRef.current); }
      setPlayToken(token => token + 1);
      setPlayYear(0);
    }
    setPlayState('playing');
  }

  // After the simulating screen, the chart plays the typical future once, so the story starts moving straight away.
  const endIntro = useCallback(() => {
    setIntro(false);
    setExampleIndex(index => {
      if (index === null) pinnedByPlay.current = !isGame;
      return index ?? typicalRef.current;
    });
    setPlayToken(token => token + 1);
    setPlayYear(0);
    setPlayState('playing');
  }, []);

  const onYear = useCallback((year: number | null) => {
    setPlayYear(year);
    if (year !== null) return;
    setPlayState('idle');
    if (pinnedByPlay.current) {
      pinnedByPlay.current = false;
      backTimer.current = setTimeout(() => setExampleIndex(null), 1200);
    }
  }, []);
  /** Leave one example future and show all 200 again (not while Play is telling it). */
  function showAllFutures() {
    clearTimeout(backTimer.current);
    pinnedByPlay.current = false;
    setExampleIndex(null);
  }

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
      id: index, name: p.name, color: colors[index],
      middle: [s.start, ...fan.map(f => f.p50)],
      low: [s.start, ...fan.map(f => f.p10)],
      high: [s.start, ...fan.map(f => f.p90)],
      example: path ? [path.start, ...path[view].slice(0, horizon)] : null,
      // Worked out for each future by the engine, on the basis of these lines. Not where the middle line crosses zero.
      payback: s.payback[view][horizon - 1]?.p50 ?? null,
    };
  }), [plans, colors, futures, view, horizon, example]);
  const lines = useMemo(() => planLines.filter((line): line is PlanLine => line !== null && (line.id === selected || !hidden.has(line.id))),
    [planLines, selected, hidden]);
  const failures = useMemo(() => planFailures(example, chosen, horizon), [example, chosen, horizon]);
  const typicalIndex = useMemo(() => {
    const middle = planLines[selected]?.middle;
    if (!futures?.samples.length || !middle) return 0;
    if (futures.samples[0].pinned) return 0;          // a played game: its own future is the one to tell
    const distance = (sample: FutureSample) => sample.paths[`p${selected}`][view].slice(0, horizon)
      .reduce((sum, value, k) => sum + Math.abs(value - middle[k + 1]), 0);
    return futures.samples.reduce((best, sample, k, all) => (distance(sample) < distance(all[best]) ? k : best), 0);
  }, [futures, planLines, selected, view, horizon]);
  typicalRef.current = typicalIndex;

  // The last assumption the viewer moved, and the selected plan's middle line just before it.
  // The chart draws that line as a ghost, and the verdict says how much the change moved the result.
  // `noGhost`: the change is another way of counting, not another world, so the chart draws no "before" line.
  const [lastChange, setLastChange] = useState<{ label: string; before: number[]; noGhost?: boolean } | null>(null);
  const focusRef = useRef<PlanLine | null>(null);
  function track(label: string, noGhost = false) {
    const current = focusRef.current?.middle;
    setLastChange(previous => {
      // A second change before the first one's answer arrived: keep the first "before" and name both changes.
      if (previous && current === previous.before) return { label: `${previous.label} · ${label}`, before: previous.before, noGhost: previous.noGhost || noGhost };
      return current ? { label, before: current, noGhost } : null;
    });
  }
  const timingLabel = (t: Timing) => TIMINGS.find(o => o.value === t)?.short ?? String(t);
  function changeTiming(next: Timing) {
    if (next === timing) return;
    track(`Buy: ${timingLabel(timing)} → ${timingLabel(next)}`);
    setTiming(next);
  }
  function commitPrice(next: number) {
    if (Math.abs(next - settledPrice) < 0.001) return;
    track(`Electricity ${settledPrice.toFixed(2)} → ${next.toFixed(2)} CHF/kWh`);
    setSettledPrice(next);
  }
  function resetPrice() { setPrice(TODAY_PRICE); commitPrice(TODAY_PRICE); }
  function changeWhatIf(next: WhatIf | null) {
    if (next === whatIf) return;
    track(next ? `What if: ${whatIfLabels[next]}` : `What if: ${whatIf ? whatIfLabels[whatIf] : ''} removed`);
    setWhatIf(next);
  }
  function changeStaffEffects(next: boolean) {
    if (next === staffEffects) return;
    // Another way of counting, not another world: a chip, but no "before" line (it would sit far away and squash the chart).
    track(next ? 'Staff effects on' : 'Staff effects off', true);
    setStaffEffects(next);
  }
  function changeOnPlan(next: boolean) {
    if (next === onPlan) return;
    track(next ? 'Old equipment: replaced on a plan' : 'Old equipment: replaced when it breaks');
    setOnPlan(next);
  }
  /** Back to today's assumptions in one click. */
  function resetAssumptions() {
    // Back to the start: a chip says how much that moved the result; no "before" line (it can sit far away).
    track('Back to today’s assumptions', true);
    if (playState === 'idle') showAllFutures();
    setTiming('now'); setPrice(TODAY_PRICE); setSettledPrice(TODAY_PRICE); setWhatIf(null); setStaffEffects(false); setOnPlan(true);
  }
  const changed = {
    timing: timing !== 'now', price: Math.abs(price - TODAY_PRICE) > 0.001, whatIf: whatIf !== null, staffEffects, onPlan: !onPlan,
  };
  const anyChanged = Object.values(changed).some(Boolean);

  function selectPlan(index: number) {
    if (index !== selected) setLastChange(null);
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

  const catalog = engine.catalog.data;
  const finance = plan?.finance;
  const yearlySaving = finance?.years[0] ? finance.years[0].operating_cost_baseline - finance.years[0].operating_cost : null;
  // The year the upgrade is paid for: today, or the first year its equipment spending differs from doing nothing.
  // A chosen year is that year. "At wear-out" is the first year spending differs from doing nothing.
  const boughtIn = !finance ? null : timing === 'now' ? 0 : typeof timing === 'number' ? timing
    : finance.capex_year0 > 0 ? 0 : finance.years.find(y => Math.abs(y.capex - y.capex_baseline) > 1000)?.year ?? null;
  // Price of the new equipment (same in any year: all prices are in today's francs).
  // New solar panels get the one-off subsidy per kWp, as in the engine's upfront cost, the pulse and the assistant's cards.
  const pvSubsidy = engine.assumptions.data?.find(a => a.key === 'pv_subsidy_chf_per_kwp')?.value ?? 0;
  const estimate = chosen.reduce((sum, swap) => {
    const unitPrice = catalog?.groups[swap.group]?.find(o => o.option_id === swap.option)?.price_chf_per_unit ?? 0;
    const units = (catalog?.items ?? []).filter(item => item.group === swap.group
      && (swap.floor === undefined || item.serves_floor === swap.floor)).reduce((n, item) => n + item.units, 0);
    const subsidy = swap.group === 'solar_pv' && unitPrice > 0 ? pvSubsidy : 0;
    return sum + (unitPrice - subsidy) * units;
  }, 0);
  // The engine's own figure once it answers (it knows how many solar panels fit), so Results, the top bar and the assistant agree.
  const purchase = upfront?.key === JSON.stringify(chosen) ? upfront.value : estimate;
  const focus = planLines[selected] ?? null;
  focusRef.current = focus;
  // The ghost and the change in the result, once the futures for the new assumptions are in.
  // "Arrived" = the selected plan's line is a new one, not the line the change started from.
  const arrived = Boolean(focus && lastChange && focus.middle !== lastChange.before);
  const settledNow = !engine.futures.loading && arrived;
  const ghost = lastChange && settledNow && lastChange.before.length > horizon ? lastChange.before.slice(0, horizon + 1) : null;
  const delta = ghost && focus && ghost.length === focus.middle.length ? focus.middle[horizon] - ghost[horizon] : null;
  // No visible change: no ghost line on top of the real one (the chip still says "No change").
  const shownGhost = lastChange?.noGhost || (delta !== null && Math.abs(delta) < 1000) ? null : ghost;
  // Cash only (no staff effects), per plan, at the horizon: the headline and the ranking always lead with cash.
  const cashEnd = plans.map((_, index) => futures?.summary[`p${index}`]?.fan.cash_running.find(f => f.year === horizon)?.p50 ?? null);
  // Payback, worked out by the engine for each of the 200 futures on the chart's basis (same money, same years shown).
  // Never read it off the band: its low and high lines are worked out separately for each year, not single futures.
  const paybackStats = futures?.summary[`p${selected}`]?.payback?.[view]?.[horizon - 1] ?? null;
  // Share of the futures in which the selected plan has paid for itself by the last year shown.
  const paidBackShare = paybackStats?.share ?? null;
  const endValue = focus?.middle[horizon] ?? 0;
  // The middle future's payback: half of the futures pay back sooner, half later or not within the years shown.
  const payback = paybackStats?.p50 ?? null;
  // 8 in 10 futures pay back between these years (null = later than the years shown).
  const goodPayback = paybackStats?.p10 ?? null;
  const badPayback = paybackStats?.p90 ?? null;
  const residual = world?.finance.years.find(y => y.year === horizon)?.residual_value ?? 0;
  const breakdown = futures?.summary[`p${selected}`]?.npv_breakdown_mean ?? finance?.npv_breakdown;
  const risk = futures?.summary[`p${selected}`]?.risk ?? null;
  const riskYear = risk?.emergency_by_year[Math.min(horizon, risk.emergency_by_year.length) - 1] ?? null;
  const flags = (finance?.flags ?? []).filter(flag => !isContextFlag(flag) && (flag.year === undefined || flag.year <= horizon));
  const contextFlags = (finance?.flags ?? []).filter(flag => isContextFlag(flag) && (flag.year === undefined || flag.year <= horizon));
  const subject = multi ? plans[selected]?.name ?? 'the plan' : 'the upgrade';
  const beats = example ? storyBeats(example, failures, { boughtIn, purchase, timing, horizon, subject }) : [];
  // What happens in the future shown: dots on its line, the words in the hover box, the newest one named while it plays.
  const notes: ExampleNote[] = beats.map(beat => ({ year: beat.year, text: beat.text, label: beat.short, tone: beat.tone }));
  const today = plan?.snapshot_baseline.building;
  const after = plan?.snapshot.building;
  const exampleNumber = example && futures ? (exampleIndex ?? 0) % futures.samples.length : null;

  // The assistant and the pulse in the top bar follow the plan shown here, as timed and priced here.
  const focusName = plans[selected]?.name ?? 'the plan';
  const timingText = TIMINGS.find(t => t.value === timing)?.label.toLowerCase() ?? 'now';
  usePublishFocus(read ? {
    label: `Results · ${focusName}`,
    describe: `The user is on the Results page, looking at the plan "${focusName}" (${chosen.length} change(s)), bought ${timingText},`
      + ` over ${horizon} years, across ${FUTURES_N} possible futures. Electricity price: CHF ${settledPrice.toFixed(2)} per kWh.`
      + `${whatIf ? ` What-if switched on: ${whatIfLabels[whatIf]} (${whatIfDetails[whatIf]})` : ''}`
      + `${staffEffects ? ' Staff effects are counted.' : ''}`
      + ` Old equipment is replaced ${onPlan ? 'on a plan at the end of its normal life' : 'only when it breaks'}.`
      + `${multi ? ` Other plans on the chart: ${plans.filter((_, i) => i !== selected).map(p => p.name).join(', ')}.` : ''}`,
    suggestions: chosen.length ? [
      'What happens to this plan if energy prices spike?',
      'Find a cheaper plan that keeps most of this saving.',
      'Where do this plan’s savings come from?',
    ] : ['Which single upgrades pay back fastest?'],
    plan: { name: focusName, scenario, buy: chosen, overrides: { ...read.config.overrides, [PRICE_KEY]: settledPrice }, color: colorOf(selected) },
  } : null);

  // Back in the building, edit the plan shown here, if it is one of the plans kept in this browser.
  const twin = useTwin();
  const editShownPlan = () => {
    const kept = twin.plans.find(p => sameScenario(p.scenario, chosen));
    if (kept) twin.setActivePlan(kept.id);
  };

  return {
    // Page address
    read, isDemo: read?.isDemo ?? false,
    // Intro screen
    intro, endIntro,
    // Plans
    plans, multi, colorOf, editShownPlan, selected, selectPlan, hidden, toggleHidden, hovered, setHovered, chosen, scenario,
    // Assumptions the viewer moves
    // Each change is tracked, so the chart can show the line before it and the verdict the difference.
    timing, changeTiming, price, setPrice, commitPrice, resetPrice, whatIf, changeWhatIf, staffEffects, changeStaffEffects,
    onPlan, changeOnPlan, horizon, setHorizon, resetAssumptions, changed, anyChanged,
    lastChange, ghost: shownGhost, delta, cashEnd, paidBackShare,
    // Play and example futures
    play, playState, playYear, playToken, onYear, exampleIndex, setExampleIndex, showAllFutures, example, exampleNumber, typicalIndex,
    // Engine
    engine, catalog, plan, futures, outdated, busy,
    // Worked-out numbers
    planLines, lines, focus, endValue, payback, goodPayback, badPayback, residual, breakdown, risk, riskYear,
    flags, contextFlags, subject, notes, beats, failures, today, after, finance, yearlySaving, boughtIn, purchase,
    futuresN: FUTURES_N,
  };
}

export type ResultsModel = ReturnType<typeof useResultsModel>;
