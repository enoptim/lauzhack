import * as echarts from 'echarts';
import { useEffect, useRef } from 'react';
import type { FanPoint, SimulateResult } from '@/api/types';
import { chfShort } from './format';
import { whatIfLabels } from './labels';
import type { WhatIf } from './useEngine';

/** Canvas colours. They mirror the tokens in styles.css (ECharts cannot read CSS variables). */
const C = {
  plan: '#c34e00',
  energy_price_spike: '#2f6fc0',
  heatwave_summer: '#6f7f1f',
  new_lab: '#a3368f',
  cash: '#a3a3a3',
  ink: '#262626',
  muted: '#737373',
  grid: '#ececec',
  warning: '#d4361f',
  card: '#ffffff',
};

export type Note = { year: number; title: string; detail: string };

type Props = {
  runs: Record<string, SimulateResult>;
  whatIfs: WhatIf[];
  staffEffects: boolean;
  fan: FanPoint[] | null;
  horizon: number;
  belowMinimum: [number, number] | null;
  notes: Note[];
  /** Changes on every press of Play; the chart then redraws from today over `playMs`. */
  playToken: number;
  playMs: number;
};

type Key = 'cumulative_cash_cf' | 'cumulative_economic_cf';

export function moneyPoints(run: SimulateResult, key: Key, horizon: number): [number, number][] {
  // Year 0 is the day you pay: minus the up-front cost.
  return [[0, -run.finance.capex_year0], ...run.finance.years.filter(y => y.year <= horizon).map(y => [y.year, y[key]] as [number, number])];
}

export function crossing(points: [number, number][]): number | null {
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1];
    const [x1, y1] = points[i];
    if (y0 < 0 && y1 >= 0) return x0 + ((0 - y0) / (y1 - y0)) * (x1 - x0);
  }
  return null;
}

type TooltipItem = { seriesName: string; seriesId: string; color: string; value: [number, number] };

export default function MoneyChart({ runs, whatIfs, staffEffects, fan, horizon, belowMinimum, notes, playToken, playMs }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);
  const lastToken = useRef(playToken);

  useEffect(() => {
    if (!host.current) return;
    const instance = echarts.init(host.current, undefined, { renderer: 'canvas' });
    chart.current = instance;
    const resize = new ResizeObserver(() => instance.resize());
    resize.observe(host.current);
    return () => { resize.disconnect(); instance.dispose(); chart.current = null; };
  }, []);

  useEffect(() => {
    const instance = chart.current;
    const plan = runs.plan;
    if (!instance || !plan) return;
    const key: Key = staffEffects ? 'cumulative_economic_cf' : 'cumulative_cash_cf';
    const planPoints = moneyPoints(plan, key, horizon);
    const payback = crossing(planPoints);
    const replay = playToken !== lastToken.current;
    lastToken.current = playToken;
    const duration = replay ? playMs : 700;
    const delayFor = (year: number) => (replay ? (year / horizon) * playMs : 300);
    const shownNotes = notes.filter(n => n.year <= horizon);
    const pointYears = [...shownNotes.map(n => n.year), ...(payback !== null ? [payback] : [])];
    const band = fan && !staffEffects ? fan.filter(p => p.year <= horizon) : [];

    const option: echarts.EChartsOption = {
      animationDuration: duration,
      animationDurationUpdate: 650,
      animationEasing: replay ? 'linear' : 'cubicOut',
      animationEasingUpdate: 'cubicInOut',
      grid: { left: 8, right: 72, top: 48, bottom: 8, containLabel: true },
      textStyle: { fontFamily: 'Geist, ui-sans-serif, system-ui, sans-serif' },
      xAxis: {
        type: 'value', min: 0, max: horizon, interval: horizon > 10 ? 5 : horizon > 5 ? 2 : 1,
        axisLabel: { color: C.muted, fontSize: 13, formatter: (v: number) => (v === 0 ? 'Today' : `Year ${v}`) },
        axisLine: { show: false }, axisTick: { show: false }, splitLine: { show: false },
      },
      yAxis: {
        type: 'value',
        axisLabel: { color: C.muted, fontSize: 13, formatter: (v: number) => chfShort(v) },
        axisLine: { show: false }, axisTick: { show: false },
        splitLine: { lineStyle: { color: C.grid } },
      },
      tooltip: {
        trigger: 'axis',
        backgroundColor: C.card, borderColor: C.grid, borderWidth: 1, padding: [8, 12],
        textStyle: { color: C.ink, fontSize: 13 },
        extraCssText: 'border-radius:10px;box-shadow:0 8px 24px -12px rgba(40,30,20,.25);',
        axisPointer: { type: 'line', lineStyle: { color: C.muted, opacity: 0.4 } },
        formatter: (raw: unknown) => {
          const items = (raw as TooltipItem[]).filter(item => !item.seriesId.startsWith('band'));
          if (!items.length) return '';
          const year = items[0].value[0];
          const note = shownNotes.find(n => n.year === year);
          const rows = items.map(item => `<div style="display:flex;justify-content:space-between;gap:16px"><span style="color:${C.muted}"><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${item.color};margin-right:6px"></span>${item.seriesName}</span><b style="font-variant-numeric:tabular-nums">${chfShort(item.value[1])}</b></div>`).join('');
          return `<div style="font-weight:600;margin-bottom:4px">${year === 0 ? 'Today' : `Year ${year}`}</div>${rows}${note ? `<div style="margin-top:6px;max-width:260px;white-space:normal;color:${C.muted}">${note.detail}</div>` : ''}`;
        },
      },
      series: [
        // Range of futures: an invisible base at p10, then the p10→p90 gap stacked on top.
        { id: 'band-base', type: 'line', name: 'band', stack: 'band', stackStrategy: 'all', smoothMonotone: 'x', silent: true, symbol: 'none', smooth: 0.35,
          lineStyle: { opacity: 0 }, data: band.map(p => [p.year, p.p10]) },
        { id: 'band-gap', type: 'line', name: 'Range of futures', stack: 'band', stackStrategy: 'all', smoothMonotone: 'x', silent: true, symbol: 'none', smooth: 0.35,
          lineStyle: { opacity: 0 }, areaStyle: { color: C.plan, opacity: 0.08 },
          data: band.map(p => [p.year, p.p90 - p.p10]) },
        {
          id: 'plan', type: 'line', name: staffEffects ? 'With staff effects' : 'As planned',
          data: planPoints, smooth: 0.35, smoothMonotone: 'x', symbol: 'circle', symbolSize: 7, showSymbol: false,
          lineStyle: { width: 3, color: C.plan, type: staffEffects ? [8, 6] : 'solid' },
          itemStyle: { color: C.plan },
          areaStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: 'rgba(195,78,0,0.16)' }, { offset: 1, color: 'rgba(195,78,0,0)' },
            ]),
            origin: 'start',
          },
          z: 5,
          markLine: {
            silent: true, symbol: 'none', animation: false,
            lineStyle: { color: C.ink, opacity: 0.35, type: 'solid', width: 1 },
            label: { show: true, position: 'insideEndTop', color: C.muted, fontSize: 12, formatter: 'Even with doing nothing' },
            data: [{ yAxis: 0 }],
          },
          markArea: belowMinimum && belowMinimum[0] <= horizon ? {
            silent: true,
            itemStyle: { color: 'rgba(212,54,31,0.035)', borderColor: 'rgba(212,54,31,0.28)', borderWidth: 1, borderType: 'dashed' },
            label: { show: true, position: 'insideBottomLeft', distance: 8, color: C.warning, fontSize: 13, fontWeight: 500, formatter: 'Savings below minimum' },
            data: [[{ xAxis: Math.max(belowMinimum[0] - 0.5, 0) }, { xAxis: Math.min(belowMinimum[1] + 0.5, horizon) }]],
          } : undefined,
          markPoint: {
            symbol: 'circle', symbolSize: 11,
            itemStyle: { color: C.card, borderColor: C.plan, borderWidth: 2.5 },
            label: {
              show: true, position: 'top', distance: 10, color: C.ink, fontSize: 13, lineHeight: 18,
              backgroundColor: C.card, borderColor: C.grid, borderWidth: 1, borderRadius: 8, padding: [6, 10],
              shadowColor: 'rgba(40,30,20,0.12)', shadowBlur: 12, shadowOffsetY: 4,
              formatter: (p: { name: string }) => p.name,
            },
            animationDuration: 400,
            animationDelay: (index: number) => delayFor(pointYears[index] ?? 0),
            data: [
              ...shownNotes.map(n => ({
                name: n.title, coord: [n.year, planPoints.find(([x]) => x === n.year)?.[1] ?? 0],
                label: { position: n.year > horizon * 0.8 ? ('left' as const) : ('top' as const) },
              })),
              ...(payback !== null ? [{
                name: `Pays back · year ${payback.toFixed(1)}`, coord: [payback, 0],
                itemStyle: { color: C.plan, borderColor: C.card, borderWidth: 2 },
                label: { position: 'bottom' as const, distance: 12, fontWeight: 600 },
              }] : []),
            ],
          },
        },
        ...(staffEffects ? [{
          id: 'cash', type: 'line' as const, name: 'Money only', data: moneyPoints(plan, 'cumulative_cash_cf', horizon),
          smooth: 0.35, smoothMonotone: 'x' as const, showSymbol: false, lineStyle: { width: 2, color: C.cash }, itemStyle: { color: C.cash },
          endLabel: { show: true, color: C.muted, fontSize: 12, formatter: 'Money only' },
        }] : []),
        ...whatIfs.filter(id => runs[id]).map(id => ({
          id, type: 'line' as const, name: whatIfLabels[id], data: moneyPoints(runs[id], key, horizon),
          smooth: 0.35, smoothMonotone: 'x' as const, showSymbol: false,
          lineStyle: { width: 2, color: C[id], type: staffEffects ? ([8, 6] as number[]) : ('solid' as const) },
          itemStyle: { color: C[id] },
          endLabel: { show: true, color: C[id], fontSize: 12, fontWeight: 500, formatter: whatIfLabels[id] },
        })),
      ],
    };
    instance.setOption(option, replay ? { notMerge: true } : { replaceMerge: ['series'] });
  }, [runs, whatIfs, staffEffects, fan, horizon, belowMinimum, notes, playToken, playMs]);

  return <div ref={host} role="img" aria-label="Money compared with doing nothing, year by year" className="h-[24rem] w-full md:h-[28rem]" />;
}
