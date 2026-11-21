import * as echarts from 'echarts';
import { useEffect, useRef } from 'react';
import { chfShort } from './format';
import type { Totals } from './MoneyChart';

/** Canvas colours. They mirror the tokens in styles.css (ECharts cannot read CSS variables). */
const C = {
  nothing: '#8a8a8a',
  ink: '#262626',
  muted: '#737373',
  grid: '#ececec',
  card: '#ffffff',
  ahead: 'rgba(111,127,31,0.14)',
  behind: 'rgba(212,54,31,0.08)',
};

export type PlanLine = { id: number; name: string; color: string; rows: Totals[] };

/** Money saved compared with doing nothing, year by year: below zero until the plan has paid for itself. */
const saved = (r: Totals) => r.nothing - r.upgrade;

/** The year (with decimals) where a plan's savings first reach zero. */
export function planPayback(rows: Totals[]): number | null {
  for (let i = 1; i < rows.length; i++) {
    const a = saved(rows[i - 1]);
    const b = saved(rows[i]);
    if (a < 0 && b >= 0) return rows[i - 1].year + (-a / (b - a)) * (rows[i].year - rows[i - 1].year);
  }
  return null;
}

/** Points up to year `p`, with an in-between point so a line can stop part-way through a year. */
function cut(rows: Totals[], p: number | null): [number, number][] {
  const points = rows.map(r => [r.year, saved(r)] as [number, number]);
  if (p === null) return points;
  const shown = points.filter(([year]) => year <= p);
  const next = points.find(([year]) => year > p);
  const prev = shown[shown.length - 1];
  if (next && prev && p > prev[0]) shown.push([p, prev[1] + ((p - prev[0]) / (next[0] - prev[0])) * (next[1] - prev[1])]);
  return shown;
}

function alpha(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

type Props = {
  lines: PlanLine[];
  /** The plan shown in detail: thick, filled, with its payback point. */
  selected: number;
  /** The plan under the pointer in the plan list: drawn strong for a moment. */
  highlighted: number | null;
  horizon: number;
  staffEffects: boolean;
  onSelect: (id: number) => void;
  playToken: number;
  playing: boolean;
  msPerYear: number;
  onYear: (year: number | null) => void;
};

type TooltipItem = { dataIndex: number; axisValue: number };

export default function PlansChart({ lines, selected, highlighted, horizon, staffEffects, onSelect, playToken, playing, msPerYear, onYear }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);
  // The axis only grows, so moving the price slider moves the lines instead of rescaling the axis.
  const axis = useRef({ key: '', min: 0, max: 0, step: 100_000 });
  const progress = useRef<number | null>(null);
  const latest = useRef({ lines, selected, highlighted, horizon, staffEffects, onSelect, msPerYear, onYear });
  latest.current = { lines, selected, highlighted, horizon, staffEffects, onSelect, msPerYear, onYear };

  function draw(animate: boolean) {
    const instance = chart.current;
    const { lines, selected, highlighted, horizon, staffEffects } = latest.current;
    if (!instance) return;
    const p = progress.current;
    const values = lines.flatMap(line => line.rows.map(saved));
    const hi = Math.max(0, ...values) * 1.1;
    const lo = Math.min(0, ...values) * 1.1;
    const axisKey = `${horizon}|${staffEffects}|${lines.map(l => l.id).join(',')}`;
    const grown = axis.current.key === axisKey
      ? { lo: Math.min(axis.current.min, lo), hi: Math.max(axis.current.max, hi) } : { lo, hi };
    // Even steps (100k, 200k, 250k, 500k, 1M) with at most 7 gaps, so the axis reads cleanly.
    const step = [100_000, 200_000, 250_000, 500_000, 1_000_000, 2_000_000].find(s => (grown.hi - grown.lo) / s <= 7) ?? 5_000_000;
    axis.current = { key: axisKey, step, min: Math.min(-step, Math.floor(grown.lo / step) * step), max: Math.max(step, Math.ceil(grown.hi / step) * step) };

    const focus = lines.find(line => line.id === selected);
    const focusPoints = focus ? cut(focus.rows, p) : [];
    const payback = focus ? planPayback(focus.rows) : null;
    const showPayback = payback !== null && (p === null || p >= payback);
    const quiet = { type: 'line' as const, silent: true, symbol: 'none', lineStyle: { opacity: 0 }, z: 1 };
    const dash: number[] | 'solid' = staffEffects ? [8, 6] : 'solid';

    const planSeries = lines.map(line => {
      const isFocus = line.id === selected;
      const isLit = line.id === highlighted;
      const strong = isFocus || isLit;
      const points = isFocus ? focusPoints : cut(line.rows, p);
      const end = points[points.length - 1]?.[1] ?? 0;
      return {
        id: `plan-${line.id}`, type: 'line' as const, name: line.name, data: points,
        symbol: 'none', z: isLit ? 6 : isFocus ? 5 : 3, cursor: 'pointer',
        lineStyle: { width: isFocus ? 3.5 : isLit ? 3 : 2, color: strong ? line.color : alpha(line.color, highlighted !== null ? 0.25 : 0.5), cap: 'round' as const, join: 'round' as const, type: dash },
        itemStyle: { color: line.color },
        emphasis: { disabled: true },
        endLabel: {
          show: true, distance: 10, lineHeight: 17, fontSize: 13, fontWeight: strong ? 600 : 400,
          color: strong ? line.color : alpha(line.color, highlighted !== null ? 0.45 : 0.8),
          formatter: () => `${line.name}\n${end >= 0 ? `saved ${chfShort(end)}` : `${chfShort(end)}`}`,
        },
        labelLayout: { moveOverlap: 'shiftY' as const },
        markPoint: !isFocus || !showPayback || payback === null ? { data: [] } : {
          symbol: 'circle', symbolSize: 12,
          itemStyle: { color: line.color, borderColor: C.card, borderWidth: 3 },
          label: {
            show: true, position: 'top' as const, distance: 12, color: C.ink, fontSize: 14, fontWeight: 600,
            backgroundColor: C.card, borderColor: C.grid, borderWidth: 1, borderRadius: 8, padding: [6, 10],
            shadowColor: 'rgba(40,30,20,0.12)', shadowBlur: 12, shadowOffsetY: 4,
            formatter: `Paid for itself · year ${payback.toFixed(1)}`,
          },
          data: [{ name: 'payback', coord: [payback, 0] }],
        },
      };
    });

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
        formatter: (raw: unknown) => {
          const year = Math.round((raw as TooltipItem[])[0]?.axisValue ?? 0);
          const rows = latest.current.lines
            .map(line => ({ line, r: line.rows.find(r => r.year === year) }))
            .filter((x): x is { line: PlanLine; r: Totals } => Boolean(x.r))
            .sort((a, b) => saved(b.r) - saved(a.r));
          const item = ({ line, r }: { line: PlanLine; r: Totals }) => {
            const v = saved(r);
            const text = year === 0 ? `pays ${chfShort(-v)} up front` : v >= 0 ? `has saved ${chfShort(v)}` : `still needs ${chfShort(-v)}`;
            return `<div style="display:flex;justify-content:space-between;gap:20px;${line.id === latest.current.selected ? 'font-weight:600' : ''}"><span><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${line.color};margin-right:6px"></span>${line.name}</span><span style="font-variant-numeric:tabular-nums">${text}</span></div>`;
          };
          return `<div style="min-width:240px">`
            + `<div style="font-weight:600;margin-bottom:6px">${year === 0 ? 'Today' : `After ${year} ${year === 1 ? 'year' : 'years'}`}</div>`
            + rows.map(item).join('')
            + `<div style="margin-top:6px;color:${C.muted};font-size:12px">Compared with doing nothing. Highest first.</div></div>`;
        },
      },
      series: [
        // Green above zero (the selected plan has saved money), red below (it still has to earn back its cost).
        { ...quiet, id: 'gain', areaStyle: { color: C.ahead, origin: 0 }, data: focusPoints.map(([x, y]) => [x, Math.max(y, 0)]) },
        { ...quiet, id: 'loss', areaStyle: { color: C.behind, origin: 0 }, data: focusPoints.map(([x, y]) => [x, Math.min(y, 0)]) },
        {
          id: 'nothing', type: 'line', name: 'Doing nothing', silent: true, z: 2,
          data: [[0, 0], [p ?? horizon, 0]], symbol: 'none',
          lineStyle: { width: 2, color: C.nothing }, itemStyle: { color: C.nothing },
          endLabel: { show: p === null, color: C.muted, fontSize: 13, distance: 10, formatter: 'Doing nothing' },
          labelLayout: { moveOverlap: 'shiftY' },
          tooltip: { show: false },
        },
        ...planSeries,
      ],
    };
    instance.setOption(option, { replaceMerge: ['series'] });
  }

  useEffect(() => {
    if (!host.current) return;
    const instance = echarts.init(host.current, undefined, { renderer: 'canvas' });
    chart.current = instance;
    instance.on('click', params => {
      const id = String(params.seriesId ?? '');
      if (id.startsWith('plan-')) latest.current.onSelect(Number(id.slice(5)));
    });
    const resize = new ResizeObserver(() => instance.resize());
    resize.observe(host.current);
    return () => { resize.disconnect(); instance.dispose(); chart.current = null; };
  }, []);

  // New data or settings: redraw (animated when showing the whole chart).
  useEffect(() => { draw(progress.current === null); }, [lines, selected, highlighted, horizon, staffEffects]); // eslint-disable-line react-hooks/exhaustive-deps

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

  return <div ref={host} role="img" aria-label="Money each plan has saved compared with doing nothing, year by year" className="h-[24rem] w-full md:h-[28rem]" />;
}
