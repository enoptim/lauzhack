import * as echarts from 'echarts';
import { useEffect, useRef } from 'react';
import { chfShort } from './format';

/** Canvas colours. They mirror the tokens in styles.css (ECharts cannot read CSS variables). */
const C = {
  nothing: '#8a8a8a',
  ink: '#262626',
  muted: '#737373',
  grid: '#ececec',
  card: '#ffffff',
};

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

/** A note on the example line, e.g. the year old equipment fails. `label` is shown on the chart (empty = dot only). */
export type ExampleNote = { year: number; text: string; label: string };

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

function alpha(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

const savedText = (v: number) => (v >= 0 ? `saved ${chfShort(v)}` : `${chfShort(v)} so far`);

function paybackPoint(color: string, payback: number) {
  return {
    name: 'payback', coord: [payback, 0], symbol: 'circle', symbolSize: 12,
    itemStyle: { color, borderColor: C.card, borderWidth: 3 },
    label: {
      show: true, position: 'top' as const, distance: 12, color: C.ink, fontSize: 14, fontWeight: 600,
      backgroundColor: C.card, borderColor: C.grid, borderWidth: 1, borderRadius: 8, padding: [6, 10],
      shadowColor: 'rgba(40,30,20,0.12)', shadowBlur: 12, shadowOffsetY: 4,
      formatter: `Paid for itself · year ${payback.toFixed(1)}`,
    },
  };
}

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
  onSelect: (id: number) => void;
  playToken: number;
  playing: boolean;
  msPerYear: number;
  onYear: (year: number | null) => void;
};

type TooltipItem = { axisValue: number };

export default function PlansChart({ lines, selected, highlighted, horizon, dashed, notes, onSelect, playToken, playing, msPerYear, onYear }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);
  // The axis only grows, so moving the price slider moves the lines instead of rescaling the axis.
  const axis = useRef({ key: '', min: 0, max: 0, step: 100_000 });
  const progress = useRef<number | null>(null);
  const latest = useRef({ lines, selected, highlighted, horizon, dashed, notes, onSelect, msPerYear, onYear });
  latest.current = { lines, selected, highlighted, horizon, dashed, notes, onSelect, msPerYear, onYear };

  function tooltip(year: number) {
    const { lines, selected, notes } = latest.current;
    const exploring = lines.some(line => line.example);
    const value = (line: PlanLine) => (line.example ?? line.middle)[year];
    const rows = lines.filter(line => value(line) !== undefined).sort((a, b) => value(b) - value(a));
    const row = (line: PlanLine) => {
      const v = value(line);
      const text = year === 0 ? `pays ${chfShort(-v)} up front` : v >= 0 ? `has saved ${chfShort(v)}` : `still needs ${chfShort(-v)}`;
      return `<div style="display:flex;justify-content:space-between;gap:20px;${line.id === selected ? 'font-weight:600' : ''}"><span><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${line.color};margin-right:6px"></span>${line.name}</span><span style="font-variant-numeric:tabular-nums">${text}</span></div>`;
    };
    const focus = lines.find(line => line.id === selected);
    const range = focus && year > 0 && !exploring
      ? `<div style="margin-top:6px;color:${C.muted}">${focus.name}: in 8 of 10 futures between <b style="color:${C.ink}">${chfShort(focus.low[year])}</b> and <b style="color:${C.ink}">${chfShort(focus.high[year])}</b></div>` : '';
    const happened = exploring ? notes.filter(n => n.year === year).map(n => `<div style="margin-top:6px"><b>${n.text}</b></div>`).join('') : '';
    return `<div style="min-width:250px;max-width:320px;white-space:normal">`
      + `<div style="font-weight:600;margin-bottom:6px">${year === 0 ? 'Today' : `After ${year} ${year === 1 ? 'year' : 'years'}`}${exploring ? ', in this future' : ', in the middle future'}</div>`
      + rows.map(row).join('') + range + happened
      + `<div style="margin-top:6px;color:${C.muted};font-size:12px">Compared with doing nothing.</div></div>`;
  }

  function draw(animate: boolean) {
    const instance = chart.current;
    const { lines, selected, highlighted, horizon, dashed, notes } = latest.current;
    if (!instance) return;
    const p = progress.current;
    const exploring = lines.some(line => line.example);

    const values = lines.flatMap(line => [...line.middle, ...(line.id === selected ? [...line.low, ...line.high] : []), ...(line.example ?? [])]);
    const hi = Math.max(0, ...values) * 1.1;
    const lo = Math.min(0, ...values) * 1.1;
    const axisKey = `${horizon}|${dashed}|${lines.map(l => l.id).join(',')}`;
    const grown = axis.current.key === axisKey
      ? { lo: Math.min(axis.current.min, lo), hi: Math.max(axis.current.max, hi) } : { lo, hi };
    // Even steps (100k, 200k, 250k, 500k, 1M) with at most 7 gaps, so the axis reads cleanly.
    const step = [100_000, 200_000, 250_000, 500_000, 1_000_000, 2_000_000].find(s => (grown.hi - grown.lo) / s <= 7) ?? 5_000_000;
    axis.current = { key: axisKey, step, min: Math.min(-step, Math.floor(grown.lo / step) * step), max: Math.max(step, Math.ceil(grown.hi / step) * step) };

    const focus = lines.find(line => line.id === selected);
    const dash: number[] | 'solid' = dashed ? [8, 6] : 'solid';
    const focusMain = focus ? (focus.example ?? focus.middle) : null;
    const payback = focusMain ? paybackYear(focusMain) : null;
    const showPayback = payback !== null && payback > 0 && (p === null || p >= payback);

    const series: echarts.SeriesOption[] = [];
    if (focus) {
      // The band: a stacked pair, so only the space between low and high is filled.
      const low = cut(focus.low, p);
      const high = cut(focus.high, p);
      const quiet = { type: 'line' as const, silent: true, symbol: 'none', lineStyle: { opacity: 0 }, stack: 'band', stackStrategy: 'all' as const, z: 1 };
      series.push({ ...quiet, id: 'band-low', data: low });
      series.push({ ...quiet, id: 'band-high', data: high.map(([x, y], k) => [x, y - (low[k]?.[1] ?? 0)]),
        areaStyle: { color: alpha(focus.color, exploring ? 0.07 : 0.15) } });
    }
    series.push({
      id: 'nothing', type: 'line', name: 'Doing nothing', silent: true, z: 2,
      data: [[0, 0], [p ?? horizon, 0]], symbol: 'none',
      lineStyle: { width: 2, color: C.nothing }, itemStyle: { color: C.nothing },
      endLabel: { show: p === null, color: C.muted, fontSize: 13, distance: 10, formatter: 'Doing nothing' },
      labelLayout: { moveOverlap: 'shiftY' },
    });

    for (const line of lines) {
      const isFocus = line.id === selected;
      const isLit = line.id === highlighted;
      const strong = isFocus || isLit;
      const faded = highlighted !== null && !isLit;
      // The middle line: the main line, or a quiet guide while one example future is shown.
      const middle = cut(line.middle, p);
      const middleEnd = middle[middle.length - 1]?.[1] ?? 0;
      series.push({
        id: `plan-${line.id}`, type: 'line', name: line.name, data: middle,
        symbol: 'none', z: isLit ? 6 : isFocus ? 5 : 3, cursor: 'pointer',
        lineStyle: {
          width: isFocus ? 3.5 : isLit ? 3 : 2, cap: 'round', join: 'round', type: dash,
          color: exploring ? alpha(line.color, 0.3) : strong ? line.color : alpha(line.color, faded ? 0.25 : 0.5),
        },
        itemStyle: { color: line.color },
        emphasis: { disabled: true },
        endLabel: {
          show: !exploring, distance: 10, lineHeight: 17, fontSize: 13, fontWeight: strong ? 600 : 400,
          color: strong ? line.color : alpha(line.color, faded ? 0.45 : 0.8),
          formatter: () => `${line.name}\n${savedText(middleEnd)}`,
        },
        labelLayout: { moveOverlap: 'shiftY' },
        markPoint: { data: isFocus && !exploring && showPayback ? [paybackPoint(line.color, payback!)] : [] },
      });
      if (line.example) {
        const example = cut(line.example, p);
        const end = example[example.length - 1]?.[1] ?? 0;
        const shownNotes = isFocus ? notes.filter(n => n.year <= Math.min(p ?? horizon, horizon)) : [];
        series.push({
          id: `example-${line.id}`, type: 'line', name: `${line.name}, this future`, data: example,
          symbol: 'none', z: isFocus ? 7 : 4, cursor: 'pointer',
          lineStyle: { width: isFocus ? 3 : 2, color: isFocus ? line.color : alpha(line.color, 0.7), cap: 'round', join: 'round', type: dash },
          itemStyle: { color: line.color },
          emphasis: { disabled: true },
          endLabel: {
            show: true, distance: 10, lineHeight: 17, fontSize: 13, fontWeight: isFocus ? 600 : 400, color: line.color,
            formatter: () => `${line.name}\n${savedText(end)}`,
          },
          labelLayout: { moveOverlap: 'shiftY' },
          markPoint: {
            symbol: 'circle', symbolSize: 9,
            itemStyle: { color: C.card, borderColor: line.color, borderWidth: 2.5 },
            label: {
              show: true, position: 'bottom', distance: 8, color: C.ink, fontSize: 12,
              backgroundColor: 'rgba(255,255,255,0.92)', borderRadius: 6, padding: [3, 6],
              formatter: (d: { name?: string }) => d.name ?? '',
            },
            data: [
              ...shownNotes.map(n => ({ name: n.label, coord: [n.year, line.example![n.year] ?? 0] })),
              ...(isFocus && showPayback ? [paybackPoint(line.color, payback!)] : []),
            ],
          },
        });
      }
    }

    const option: echarts.EChartsOption = {
      animation: animate,
      animationDuration: 800,
      animationDurationUpdate: 500,
      animationEasing: 'cubicOut',
      animationEasingUpdate: 'cubicInOut',
      grid: { left: 8, right: 170, top: 24, bottom: 8, containLabel: true },
      textStyle: { fontFamily: 'Geist, ui-sans-serif, system-ui, sans-serif' },
      xAxis: {
        type: 'value', min: 0, max: horizon, interval: horizon > 10 ? 5 : horizon > 5 ? 2 : 1,
        axisLabel: { color: C.muted, fontSize: 13, formatter: (v: number) => (v === 0 ? 'Today' : `Year ${v}`) },
        axisLine: { show: false }, axisTick: { show: false }, splitLine: { show: false },
      },
      yAxis: {
        type: 'value', min: axis.current.min, max: axis.current.max, interval: axis.current.step,
        axisLabel: { color: C.muted, fontSize: 13, formatter: (v: number) => chfShort(v) },
        axisLine: { show: false }, axisTick: { show: false },
        splitLine: { lineStyle: { color: C.grid } },
      },
      tooltip: {
        trigger: 'axis',
        backgroundColor: C.card, borderColor: C.grid, borderWidth: 1, padding: [10, 12],
        textStyle: { color: C.ink, fontSize: 13 },
        extraCssText: 'border-radius:10px;box-shadow:0 8px 24px -12px rgba(40,30,20,.25);',
        axisPointer: { type: 'line', lineStyle: { color: C.muted, opacity: 0.4 } },
        formatter: (raw: unknown) => tooltip(Math.round((raw as TooltipItem[])[0]?.axisValue ?? 0)),
      },
      series,
    };
    instance.setOption(option, { replaceMerge: ['series'] });
  }

  useEffect(() => {
    if (!host.current) return;
    const instance = echarts.init(host.current, undefined, { renderer: 'canvas' });
    chart.current = instance;
    instance.on('click', params => {
      const match = /^(?:plan|example)-(\d+)$/.exec(String(params.seriesId ?? ''));
      if (match) latest.current.onSelect(Number(match[1]));
    });
    const resize = new ResizeObserver(() => instance.resize());
    resize.observe(host.current);
    return () => { resize.disconnect(); instance.dispose(); chart.current = null; };
  }, []);

  // New data or settings: redraw (animated when showing the whole chart).
  useEffect(() => { draw(progress.current === null); }, [lines, selected, highlighted, horizon, dashed, notes]); // eslint-disable-line react-hooks/exhaustive-deps

  // Play pressed: start again from today.
  const firstToken = useRef(playToken);
  useEffect(() => {
    if (playToken === firstToken.current) return;
    progress.current = 0;
    draw(false);
  }, [playToken]); // eslint-disable-line react-hooks/exhaustive-deps

  // While playing, grow the lines a little every frame. Pausing stops the loop and keeps the position.
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    let before = performance.now();
    let lastYear = -1;
    const tick = (now: number) => {
      const { horizon, msPerYear, onYear } = latest.current;
      if (progress.current === null) return;
      progress.current = Math.min(horizon, progress.current + (now - before) / msPerYear);
      before = now;
      const year = Math.floor(progress.current);
      if (year !== lastYear) { lastYear = year; onYear(year); }
      if (progress.current >= horizon) {
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

  return <div ref={host} role="img" aria-label="Money each plan saves compared with doing nothing, year by year, with the range of possible futures" className="h-[24rem] w-full md:h-[28rem]" />;
}
