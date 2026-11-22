import * as echarts from 'echarts';
import { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import { chfShort } from './format';

/** Canvas colours. They mirror the page tokens (ECharts cannot read CSS variables). */
const C = {
  ink: '#262626',
  muted: '#77736c',
  grid: '#dedad3',
  card: '#ffffff',
  nothing: '#9a968f',
  marker: '#c9c4bc',
  fail: '#d4361f',
  good: '#3f7d3a',
};

/** Plan names and notes come from the page address: escape them before they go into tooltip HTML. */
const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
/** ECharts rich text reads {style|text}: strip those characters from names put into a formatter. */
const plain = (s: string) => s.replace(/[{}|]/g, '');
/** End labels sit in a 150px margin: long names are cut with an ellipsis. */
const short = (s: string) => (s.length > 22 ? `${s.slice(0, 21)}…` : s);
const SANS = 'Geist, ui-sans-serif, system-ui, sans-serif';
/** Numbers use the same font as text: one family keeps the chart calm. */
const MONO = "Geist, ui-sans-serif, system-ui, sans-serif";

/** Axis money: "CHF 500k", "−CHF 1.5M", "CHF 0". Shorter than chfShort, so the axis stays narrow. */
function axisMoney(v: number) {
  const sign = v < 0 ? '−' : '';
  const abs = Math.abs(v);
  if (abs >= 1e6) return `${sign}CHF ${String(+(abs / 1e6).toFixed(2))}M`;
  if (abs >= 1e3) return `${sign}CHF ${Math.round(abs / 1e3)}k`;
  return `${sign}CHF ${Math.round(abs)}`;
}

/**
 * One plan on the chart. Every array is indexed by year: 0 = today, 1..horizon.
 * Values are money saved compared with doing nothing, added up so far (below zero until it has paid for itself).
 */
export type PlanLine = {
  id: number;
  name: string;
  color: string;
  /** The middle future: half of the possible futures do better, half do worse. */
  middle: number[];
  /** 8 in 10 futures land between `low` and `high`. */
  low: number[];
  high: number[];
  /** One example future, when the viewer is looking at one. */
  example: number[] | null;
};

/** Something that happens in the example future: a dot on its line, `text` in the hover box,
 * `label` named on the chart while it plays (only the newest one). */
export type ExampleNote = { year: number; text: string; label: string; tone: 'plan' | 'fail' | 'world' };

/** Something that happens in every future in a known year: a thin dashed upright line with a name on top. */
export type ChartMarker = { year: number; label: string };

/** The year (with decimals) where a line reaches zero for the last time and stays above; null if it ends below zero. */
export function paybackYear(values: number[]): number | null {
  if (!values.length || values[values.length - 1] < 0) return null;
  if (values.every(v => v >= 0)) return 0;
  let year = values.length - 1;
  while (year > 0 && values[year - 1] >= 0) year--;
  const a = values[year - 1];
  const b = values[year];
  return year - 1 + -a / (b - a);
}

/** Points up to year `p`, with an in-between point so a line can stop part-way through a year. */
function cut(values: number[], p: number | null): [number, number][] {
  const points = values.map((v, year) => [year, v] as [number, number]);
  if (p === null) return points;
  const shown = points.filter(([year]) => year <= p);
  const prev = shown[shown.length - 1];
  const next = points[shown.length];
  if (next && prev && p > prev[0]) shown.push([p, prev[1] + (p - prev[0]) * (next[1] - prev[1])]);
  return shown;
}

/** The value of a line part-way through a year. */
function at(values: number[], x: number) {
  const k = Math.min(values.length - 2, Math.max(0, Math.floor(x)));
  return values[k] + (x - k) * ((values[k + 1] ?? values[k]) - values[k]);
}

function alpha(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

const savedText = (v: number) => (v >= 0 ? `saved ${chfShort(v)}` : `${chfShort(v)} so far`);

/** An end label: the plan's name over its value. In one example future the value says so, to match the headline. */
function endLabel(name: string, value: number, color: string, strong: boolean, thisFuture = false) {
  return {
    // One tight block per plan, with room between blocks, so each value clearly belongs to its name.
    show: true, distance: 10, padding: [4, 0, 4, 0],
    formatter: () => `{n|${short(plain(name))}}\n{v|${thisFuture ? `this future ${chfShort(value)}` : savedText(value)}}`,
    rich: {
      n: { fontFamily: SANS, fontSize: 12, lineHeight: 15, fontWeight: strong ? 600 : 500, color },
      v: { fontFamily: MONO, fontSize: 12, lineHeight: 15, color },
    },
  };
}

function paybackPoint(color: string, payback: number, thisFuture = false) {
  return {
    value: [payback, 0], symbol: 'circle', symbolSize: 11,
    itemStyle: { color, borderColor: C.card, borderWidth: 2.5 },
    label: {
      show: true, position: 'top' as const, distance: 10,
      backgroundColor: C.card, borderColor: C.grid, borderWidth: 1, borderRadius: 6, padding: [4, 8],
      formatter: `{t|${thisFuture ? 'This future pays' : 'Pays'} for itself · }{v|year ${payback.toFixed(1)}}`,
      rich: {
        t: { fontFamily: SANS, fontSize: 12, color: C.ink },
        v: { fontFamily: MONO, fontSize: 12, color: C.ink },
      },
    },
  };
}

/** How long Play stays on a year where something happens. */
const HOLD_MS = 800;

const reducedMotion = () => typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

type Props = {
  lines: PlanLine[];
  /** The plan shown in detail: thick, with its band and payback point. */
  selected: number;
  /** The plan under the pointer in the plan list: drawn strong for a moment. */
  highlighted: number | null;
  horizon: number;
  /** Staff effects are counted: lines are dashed, because they rest on guesses. */
  dashed: boolean;
  /** Notes for the example future, on the selected plan's example line. */
  notes: ExampleNote[];
  /** The selected plan's middle line before the last assumption change, drawn as a grey dashed "Before" line. */
  ghost?: number[] | null;
  /** Known events in every future (a what-if, the year you buy). */
  markers?: ChartMarker[];
  onSelect: (id: number) => void;
  playToken: number;
  playing: boolean;
  msPerYear: number;
  onYear: (year: number | null) => void;
  className?: string;
};

type TooltipItem = { axisValue: number };

const row = (left: string, right: string, strong = false) =>
  `<div style="display:flex;justify-content:space-between;align-items:center;gap:20px;line-height:20px;${strong ? 'font-weight:600' : ''}">${left}<span style="font-family:${MONO};font-variant-numeric:tabular-nums;white-space:nowrap">${right}</span></div>`;

export default function PlansChart({ lines, selected, highlighted, horizon, dashed, notes, ghost = null, markers = [], onSelect, playToken, playing, msPerYear, onYear, className }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);
  // The axis only grows, so moving the price slider moves the lines instead of rescaling the axis.
  const axis = useRef({ key: '', min: 0, max: 0, step: 100_000 });
  const progress = useRef<number | null>(null);
  const latest = useRef({ lines, selected, highlighted, horizon, dashed, notes, ghost, markers, onSelect, msPerYear, onYear });
  latest.current = { lines, selected, highlighted, horizon, dashed, notes, ghost, markers, onSelect, msPerYear, onYear };

  function tooltip(year: number) {
    const { lines, selected, notes, ghost } = latest.current;
    const exploring = lines.some(line => line.example);
    const value = (line: PlanLine) => (line.example ?? line.middle)[year];
    const rows = lines.filter(line => value(line) !== undefined).sort((a, b) => value(b) - value(a));
    const planRow = (line: PlanLine) => {
      const v = value(line);
      const text = year === 0 ? `pays ${chfShort(-v)}` : v >= 0 ? `saved ${chfShort(v)}` : `still ${chfShort(-v)} behind`;
      return row(`<span><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${line.color};margin-right:8px"></span>${esc(line.name)}</span>`, text, line.id === selected);
    };
    const focus = lines.find(line => line.id === selected);
    const range = focus && year > 0 && !exploring
      ? `<div style="margin-top:8px;padding-top:8px;border-top:1px solid ${C.grid};color:${C.muted}">8 in 10 futures: <span style="font-family:${MONO};color:${C.ink}">${chfShort(focus.low[year])}</span> to <span style="font-family:${MONO};color:${C.ink}">${chfShort(focus.high[year])}</span></div>` : '';
    const before = ghost && ghost[year] !== undefined && !exploring
      ? `<div style="color:${C.muted}">Before your change: <span style="font-family:${MONO};color:${C.ink}">${chfShort(ghost[year])}</span></div>` : '';
    const happened = exploring ? notes.filter(n => n.year === year).map(n => `<div style="margin-top:8px;display:flex;gap:8px"><span style="flex:none;margin-top:5px;width:8px;height:8px;border-radius:50%;border:2px solid ${n.tone === 'fail' ? C.fail : n.tone === 'world' ? C.muted : C.ink}"></span><span style="font-weight:500">${esc(n.text)}</span></div>`).join('') : '';
    return `<div style="min-width:240px;max-width:320px;white-space:normal;font-family:${SANS};font-size:13px;color:${C.ink}">`
      + `<div style="display:flex;justify-content:space-between;gap:12px;margin-bottom:6px"><span style="font-weight:600">${year === 0 ? 'Today' : `Year ${year}`}</span><span style="color:${C.muted};font-size:12px">${exploring ? 'This future' : 'Middle future'}</span></div>`
      + rows.map(planRow).join('') + range + before + happened
      + `<div style="margin-top:8px;color:${C.muted};font-size:12px">Compared with doing nothing.</div></div>`;
  }

  function draw(animate: boolean) {
    const instance = chart.current;
    const { lines, selected, highlighted, horizon, dashed, notes, ghost, markers } = latest.current;
    if (!instance) return;
    const p = progress.current;
    const exploring = lines.some(line => line.example);
    const focus = lines.find(line => line.id === selected);
    const showGhost = Boolean(ghost && focus && !exploring && ghost.length === focus.middle.length);

    const values = lines.flatMap(line => [...line.middle, ...(line.id === selected ? [...line.low, ...line.high] : []), ...(line.example ?? [])]);
    const hi = Math.max(0, ...values) * 1.1;
    const lo = Math.min(0, ...values) * 1.1;
    const axisKey = `${horizon}|${dashed}|${lines.map(l => l.id).join(',')}`;
    // ...unless the lines now use less than 60% of it (e.g. old answers drawn for a moment after a switch): then fit again.
    const fits = axis.current.key === axisKey && (hi - lo) > 0.6 * (axis.current.max - axis.current.min);
    const grown = fits
      ? { lo: Math.min(axis.current.min, lo), hi: Math.max(axis.current.max, hi) } : { lo, hi };
    // Even steps (100k, 200k, 250k, 500k, 1M) with at most 7 gaps, so the axis reads cleanly.
    const step = [100_000, 200_000, 250_000, 500_000, 1_000_000, 2_000_000].find(s => (grown.hi - grown.lo) / s <= 7) ?? 5_000_000;
    axis.current = { key: axisKey, step, min: Math.min(-step, Math.floor(grown.lo / step) * step), max: Math.max(step, Math.ceil(grown.hi / step) * step) };

    const dash: number[] | 'solid' = dashed ? [8, 6] : 'solid';
    const focusMain = focus ? (focus.example ?? focus.middle) : null;
    const payback = focusMain ? paybackYear(focusMain) : null;
    const showPayback = payback !== null && payback > 0 && (p === null || p >= payback);
    const reach = p ?? horizon;

    const series: echarts.SeriesOption[] = [];
    if (focus) {
      // The band: a stacked pair, so only the space between low and high is filled.
      const low = cut(focus.low, p);
      const high = cut(focus.high, p);
      const quiet = { type: 'line' as const, silent: true, symbol: 'none', lineStyle: { opacity: 0 }, stack: 'band', stackStrategy: 'all' as const, z: 1 };
      series.push({ ...quiet, id: 'band-low', data: low });
      series.push({ ...quiet, id: 'band-high', data: high.map(([x, y], k) => [x, y - (low[k]?.[1] ?? 0)]),
        // With one example future shown, the band turns neutral grey: it is the backdrop, not the story.
        areaStyle: { color: exploring ? alpha(C.nothing, 0.14) : alpha(focus.color, showGhost ? 0.08 : 0.12) } });
      // The band is named where it is, not only in the legend: lay readers need it in place.
      // It goes in the widest half of the band (above or below the middle line) in the right half of the chart,
      // away from the zero line and the payback point, and only where the words fit inside the band.
      const plotHeight = Math.max(1, (host.current?.clientHeight ?? 400) - 64);
      const px = (v: number) => v / (axis.current.max - axis.current.min) * plotHeight;
      let spot = { x: 0, y: 0, room: 0 };
      for (let k = 0; k <= 10; k++) {
        const x = horizon * (0.5 + 0.035 * k);
        if (payback !== null && Math.abs(x - payback) < horizon * 0.15) continue;
        const mid = at(focus.middle, x);
        for (const edge of [at(focus.high, x), at(focus.low, x)]) {
          const room = Math.abs(edge - mid);
          const y = mid + (edge - mid) * 0.6;
          if (room > spot.room && Math.abs(px(y)) > 12) spot = { x, y, room };
        }
      }
      const tallEnough = px(spot.room) > 26; // the words keep clear of the middle line
      series.push({
        id: 'band-label', type: 'scatter', silent: true, z: 2, symbolSize: 1, itemStyle: { color: 'transparent' },
        data: p === null && !exploring && tallEnough ? [[spot.x, spot.y]] : [],
        label: { show: true, position: 'inside', formatter: '8 in 10 futures', color: C.muted, fontFamily: SANS, fontSize: 12 },
        animation: false,
      });
    }
    const shownMarkers = markers.filter(mk => mk.year > 0 && mk.year <= Math.min(reach, horizon)).sort((a, b) => a.year - b.year);
    series.push({
      id: 'nothing', type: 'line', name: 'Doing nothing', silent: true, z: 2,
      data: [[0, 0], [reach, 0]], symbol: 'none',
      lineStyle: { width: 1.5, color: C.nothing, type: [4, 4] }, itemStyle: { color: C.nothing },
      endLabel: { show: false },
      markLine: {
        silent: true, symbol: 'none', animation: false,
        lineStyle: { color: C.marker, width: 1, type: [3, 3] },
        label: { position: 'end', distance: 6, color: C.muted, fontFamily: SANS, fontSize: 12 },
        data: shownMarkers.map((mk, k) => {
          // Two events close together: the first name ends at its line, the second starts at its line, so they never cross.
          const closeBefore = k > 0 && mk.year - shownMarkers[k - 1].year < 1.5;
          const closeAfter = k < shownMarkers.length - 1 && shownMarkers[k + 1].year - mk.year < 1.5;
          const align = closeBefore ? 'left' : closeAfter ? 'right' : 'center';
          return { xAxis: mk.year, name: plain(mk.label), label: { formatter: plain(mk.label), align, padding: closeBefore ? [0, 0, 0, 4] : closeAfter ? [0, 4, 0, 0] : 0 } };
        }),
      },
    });
    // "Doing nothing" is named on the zero line at the left, where every plan is still below it:
    // it never gets pushed away from its line by the plan names on the right.
    series.push({
      id: 'nothing-label', type: 'scatter', silent: true, z: 2, symbolSize: 1, itemStyle: { color: 'transparent' }, animation: false,
      data: [[0, 0]],
      label: { show: true, position: 'top', align: 'left', offset: [6, 0], distance: 4, color: C.muted, fontFamily: SANS, fontSize: 12, formatter: 'Doing nothing' },
    });

    if (showGhost && focus) {
      // Cause and effect: the space between the line before the change and the line now,
      // green where the change made the plan better, rose where it made it worse (year by year).
      // Two stacked pairs: on the old line, the gain; on the new line, the loss.
      const before = cut(ghost!, p);
      const now = cut(focus.middle, p);
      const gain = now.map(([x, y], k) => [x, Math.max(0, y - (before[k]?.[1] ?? y))]);
      const loss = now.map(([x, y], k) => [x, Math.max(0, (before[k]?.[1] ?? y) - y)]);
      const fill = { type: 'line' as const, silent: true, symbol: 'none', lineStyle: { opacity: 0 }, stackStrategy: 'all' as const, z: 2 };
      const grow = { animationDuration: 500, animationDelay: 150, animationEasing: 'cubicOut' as const };
      series.push({ ...fill, id: 'change-base', stack: 'gain', data: before, animation: false });
      series.push({ ...fill, id: 'change-fill', stack: 'gain', data: gain, areaStyle: { color: alpha(C.good, 0.18) }, ...grow });
      series.push({ ...fill, id: 'change-base-loss', stack: 'loss', data: now, animation: false });
      series.push({ ...fill, id: 'change-fill-loss', stack: 'loss', data: loss, areaStyle: { color: 'rgba(190,18,60,0.16)' }, ...grow });
      series.push({
        // Appears at once where the focused line was, so the focused line is seen moving away from it.
        id: 'ghost', type: 'line', name: 'Before your change', silent: true, z: 4, animation: false,
        data: cut(ghost!, p), symbol: 'none',
        lineStyle: { width: 1.5, color: C.nothing, type: [4, 4] },
      });
    }

    for (const line of lines) {
      const isFocus = line.id === selected;
      const isLit = line.id === highlighted;
      const strong = isFocus || isLit;
      const faded = highlighted !== null && !isLit;
      // The middle line: the main line, or a quiet guide while one example future is shown.
      const middle = cut(line.middle, p);
      const middleEnd = middle[middle.length - 1]?.[1] ?? 0;
      const color = exploring ? alpha(line.color, 0.3) : strong ? line.color : alpha(line.color, faded ? 0.25 : 0.45);
      series.push({
        id: `plan-${line.id}`, type: 'line', name: line.name, data: middle,
        symbol: 'none', z: isLit ? 6 : isFocus ? 5 : 3, cursor: 'pointer', triggerLineEvent: true,
        lineStyle: { width: isFocus ? 2.5 : isLit ? 2 : 1.5, cap: 'round', join: 'round', type: dash, color },
        itemStyle: { color: line.color },
        emphasis: { disabled: true },
        endLabel: exploring ? { show: false } : endLabel(line.name, middleEnd, strong ? line.color : alpha(line.color, faded ? 0.5 : 0.85), strong),
        labelLayout: { moveOverlap: 'shiftY' },
      });
      if (line.example) {
        const example = cut(line.example, p);
        // While playing, the label shows the last whole year reached: the same number as the headline.
        const end = p !== null ? line.example[Math.min(Math.floor(p), horizon)] ?? 0 : example[example.length - 1]?.[1] ?? 0;
        const shownNotes = isFocus ? notes.filter(n => n.year <= Math.min(reach, horizon)) : [];
        const newest = p !== null ? shownNotes.at(-1) : undefined;
        series.push({
          id: `example-${line.id}`, type: 'line', name: `${line.name}, this future`, data: example,
          symbol: 'none', z: isFocus ? 7 : 4, cursor: 'pointer', triggerLineEvent: true,
          lineStyle: { width: isFocus ? 2.5 : 1.5, color: isFocus ? line.color : alpha(line.color, 0.6), cap: 'round', join: 'round', type: dash },
          itemStyle: { color: line.color },
          emphasis: { disabled: true },
          endLabel: endLabel(line.name, end, line.color, isFocus, true),
          labelLayout: { moveOverlap: 'shiftY' },
        });
        if (isFocus) {
          // What happens in this future, as dots on its line. A scatter series, not markPoints:
          // its data is replaced exactly on every frame, so no dot shows ahead of the growing line.
          series.push({
            // Below the line and to the left of the dot, so the newest name never covers the end labels at the tip.
            // When not playing, every dot is named (names that would collide are dropped).
            id: 'notes', type: 'scatter', silent: true, z: 8, symbol: 'circle', symbolSize: 8, animation: false,
            labelLayout: { hideOverlap: true },
            label: {
              position: 'bottom', distance: 10, align: 'right', offset: [8, 0], color: C.ink, fontFamily: SANS, fontSize: 12,
              backgroundColor: C.card, borderColor: C.grid, borderWidth: 1, borderRadius: 6, padding: [3, 6],
            },
            data: shownNotes.map(n => ({
              value: [n.year, line.example![n.year] ?? 0],
              itemStyle: { color: C.card, borderColor: n.tone === 'fail' ? C.fail : n.tone === 'world' ? C.muted : line.color, borderWidth: 2 },
              label: { show: p === null || n === newest, formatter: plain(n.label), ...(n.year === 0 ? { align: 'left' as const, offset: [-8, 0] } : {}) },
            })),
          });
        }
      }
    }

    // The payback point, on the focused line (middle, or the example shown), only once the line has reached it.
    if (focus) {
      series.push({
        id: 'payback', type: 'scatter', silent: true, z: 9, animation: false,
        data: showPayback ? [paybackPoint(focus.color, payback!, exploring)] : [],
      });
    }

    const motion = animate && !reducedMotion();
    const option: echarts.EChartsOption = {
      animation: motion,
      animationDuration: 700,
      animationDurationUpdate: 400,
      animationEasing: 'cubicOut',
      animationEasingUpdate: 'cubicOut',
      grid: { left: 4, right: 150, top: 32, bottom: 4, containLabel: true },
      textStyle: { fontFamily: SANS },
      xAxis: {
        type: 'value', min: 0, max: horizon, interval: horizon > 10 ? 5 : horizon > 5 ? 2 : 1,
        axisLabel: { color: C.muted, fontFamily: MONO, fontSize: 12, margin: 12, formatter: (v: number) => (v === 0 ? 'Today' : `Year ${v}`) },
        axisLine: { show: false }, axisTick: { show: false }, splitLine: { show: false },
      },
      yAxis: {
        type: 'value', min: axis.current.min, max: axis.current.max, interval: axis.current.step,
        axisLabel: { color: C.muted, fontFamily: MONO, fontSize: 12, margin: 12, formatter: axisMoney },
        axisLine: { show: false }, axisTick: { show: false },
        splitLine: { lineStyle: { color: C.grid, width: 1 } },
      },
      tooltip: {
        trigger: 'axis',
        backgroundColor: C.card, borderColor: C.grid, borderWidth: 1, padding: [10, 12],
        textStyle: { color: C.ink, fontSize: 13, fontFamily: SANS },
        extraCssText: 'border-radius:8px;box-shadow:0 1px 2px rgba(30,25,20,.06),0 6px 16px -6px rgba(30,25,20,.14);',
        axisPointer: { type: 'line', lineStyle: { color: C.nothing, width: 1, opacity: 0.6 } },
        formatter: (raw: unknown) => tooltip(Math.round((raw as TooltipItem[])[0]?.axisValue ?? 0)),
      },
      series,
    };
    // A tooltip left open would show the old numbers: close it on every redraw.
    instance.dispatchAction({ type: 'hideTip' });
    instance.dispatchAction({ type: 'updateAxisPointer', currTrigger: 'leave' });
    instance.setOption(option, { replaceMerge: ['series'] });
  }

  useEffect(() => {
    if (!host.current) return;
    const instance = echarts.init(host.current, undefined, { renderer: 'canvas' });
    chart.current = instance;
    // Click near a line (or its end label) selects that plan. Thin lines are hard to hit exactly,
    // so the nearest line within a few pixels wins.
    instance.getZr().on('click', event => {
      const { lines, horizon, onSelect } = latest.current;
      const [x] = instance.convertFromPixel({ gridIndex: 0 }, [event.offsetX, event.offsetY]) as number[];
      if (!Number.isFinite(x) || x < 0) return;
      const atEnd = x > horizon;
      const xc = Math.min(horizon, x);
      let best: { id: number; d: number } | null = null;
      for (const line of lines) {
        const values = line.example ?? line.middle;
        const py = (instance.convertToPixel({ gridIndex: 0 }, [xc, at(values, xc)]) as number[])[1];
        const d = Math.abs(py - event.offsetY);
        if (d < (atEnd ? 22 : 12) && (!best || d < best.d)) best = { id: line.id, d };
      }
      if (best) onSelect(best.id);
    });
    const hide = () => {
      instance.dispatchAction({ type: 'hideTip' });
      instance.dispatchAction({ type: 'updateAxisPointer', currTrigger: 'leave' });
    };
    instance.on('globalout', hide);
    // The middle column scrolls on its own: a tooltip must not stay stuck where the chart was.
    window.addEventListener('scroll', hide, { capture: true, passive: true });
    const resize = new ResizeObserver(() => instance.resize());
    resize.observe(host.current);
    return () => { window.removeEventListener('scroll', hide, { capture: true }); resize.disconnect(); instance.dispose(); chart.current = null; };
  }, []);

  // New data or settings: redraw (animated when showing the whole chart).
  const notesKey = JSON.stringify(notes);
  const ghostKey = ghost ? ghost.join(',') : '';
  const markersKey = JSON.stringify(markers);
  // Play pressed: start again from today. If the chart mounts while a play has already begun
  // (e.g. right after the intro), start it too. One effect for both, so the first frame of a new play
  // is never drawn whole (no flash of the full line or its payback dot before it grows).
  const seenToken = useRef<number | null>(playing ? null : playToken);
  useEffect(() => {
    if (playToken !== seenToken.current) {
      seenToken.current = playToken;
      progress.current = 0;
      draw(false);
      return;
    }
    draw(progress.current === null);
  }, [lines, selected, highlighted, horizon, dashed, notesKey, ghostKey, markersKey, playToken]); // eslint-disable-line react-hooks/exhaustive-deps

  // While playing, grow the lines a little every frame. Pausing stops the loop and keeps the position.
  // On a year where something happens (a crisis, a breakdown, the purchase), the story holds for a moment.
  // With reduced motion, the lines step a whole year at a time instead of gliding.
  useEffect(() => {
    if (!playing) return;
    const reduced = reducedMotion();
    let frame = 0;
    let before = performance.now();
    let lastYear = -1;
    let holdUntil = 0;
    let raw = progress.current ?? 0;
    const tick = (now: number) => {
      const { horizon, msPerYear, onYear, notes } = latest.current;
      if (progress.current === null) { onYear(null); return; }
      if (now < holdUntil) { before = now; frame = requestAnimationFrame(tick); return; }
      let next = Math.min(horizon, raw + (now - before) / msPerYear);
      before = now;
      const held = notes.map(n => n.year).filter(y => y > raw && y <= next && y < horizon).sort((a, b) => a - b)[0];
      if (held !== undefined) { next = held; holdUntil = now + HOLD_MS; }
      raw = next;
      progress.current = reduced ? Math.floor(raw) : raw;
      const year = Math.floor(raw);
      if (year !== lastYear) { lastYear = year; onYear(year); }
      if (raw >= horizon) {
        progress.current = null;
        draw(false);
        onYear(null);
        return;
      }
      draw(false);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={host} role="img" aria-label="Money each plan saves compared with doing nothing, year by year, with the range of possible futures" className={cn('h-[22rem] w-full', className)} />;
}
