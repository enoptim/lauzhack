import * as echarts from 'echarts';
import { useEffect, useRef } from 'react';
import type { FinanceYear } from '@/api/types';
import { chfShort, gained, signedChf } from './format';
import type { Stop } from './usePlay';

/** Canvas colours. They mirror the tokens in styles.css (ECharts cannot read CSS variables). */
const C = {
  line: '#c34e00',
  muted: '#737373',
  ink: '#262626',
  grid: '#ececec',
  card: '#ffffff',
  zero: '#a3a3a3',
  future: 'rgba(115,115,115,0.07)',
};

type Props = {
  /** Years 1 to now, from the API. */
  history: FinanceYear[];
  horizon: number;
  now: number;
  ended: boolean;
  /** Height, e.g. "h-40". */
  className?: string;
  /** Stops so far, drawn as markers on the line. */
  stops?: Stop[];
};

/** Money compared with doing nothing, added up year by year, up to now. The rest of the chart is still empty. */
export default function PlayChart({ history, horizon, now, ended, className = 'h-64', stops = [] }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!host.current) return;
    const instance = echarts.init(host.current, undefined, { renderer: 'svg' });
    chart.current = instance;
    const resize = new ResizeObserver(() => instance.resize());
    resize.observe(host.current);
    return () => {
      resize.disconnect();
      instance.dispose();
      chart.current = null;
    };
  }, []);

  useEffect(() => {
    const first = history[0];
    // Today: what was bought today (the first year's total minus that year's own flow).
    const today = first ? first.cumulative_cash_cf - first.cash_cf : 0;
    const points = [[0, today], ...history.map(row => [row.year, gained(row)])];
    const marks: object[] = [{
      yAxis: 0, lineStyle: { color: C.zero, type: 'solid', width: 1 },
      label: { formatter: 'Doing nothing', position: 'insideStartBottom', color: C.muted, fontSize: 11 },
    }];
    if (!ended) {
      marks.push({ xAxis: now, lineStyle: { color: C.line, type: 'dashed', width: 1.5 },
        label: { formatter: 'Now', position: 'end', color: C.line, fontSize: 12 } });
    }
    chart.current?.setOption({
      animationDuration: 900,
      animationDurationUpdate: 900,
      grid: { left: 8, right: 32, top: 28, bottom: 8, containLabel: true },
      textStyle: { fontFamily: 'Geist, ui-sans-serif, system-ui, sans-serif' },
      xAxis: {
        type: 'value', min: 0, max: horizon, interval: 5,
        axisLabel: { color: C.muted, fontSize: 12, formatter: (v: number) => (v === 0 ? 'Today' : `Year ${v}`) },
        axisLine: { show: false }, axisTick: { show: false }, splitLine: { show: false },
      },
      yAxis: {
        type: 'value',
        // At least ±CHF 100k, so an empty start doesn't zoom in on rounding noise.
        splitNumber: 3,
        min: (v: { min: number }) => Math.min(Math.floor((v.min * 1.05) / 100_000) * 100_000, -100_000),
        max: (v: { max: number }) => Math.max(Math.ceil((v.max * 1.05) / 100_000) * 100_000, 100_000),
        axisLabel: { color: C.muted, fontSize: 12, formatter: (v: number) => chfShort(v) },
        axisLine: { show: false }, axisTick: { show: false }, splitLine: { lineStyle: { color: C.grid } },
      },
      tooltip: {
        trigger: 'axis',
        backgroundColor: C.card, borderColor: C.grid, borderWidth: 1, padding: [8, 10],
        textStyle: { color: C.ink, fontSize: 13 },
        axisPointer: { type: 'line', lineStyle: { color: C.muted, opacity: 0.4 } },
        formatter: (raw: unknown) => {
          const [year, value] = ((raw as { value: [number, number] }[])[0]?.value ?? [0, 0]);
          const stop = stops.find(s => s.t === year);
          const happened = stop ? `<br/><span style="color:${C.muted}">${stop.reasons.map(r => r.title).join('<br/>')}</span>` : '';
          return `<b>${year === 0 ? 'Today' : `After year ${year}`}</b><br/>${signedChf(value)} vs doing nothing${happened}`;
        },
      },
      series: [{
        id: 'path', type: 'line', data: points, symbol: 'circle', symbolSize: 5, showSymbol: true,
        smooth: 0.3, smoothMonotone: 'x',
        lineStyle: { width: 2.5, color: C.line, cap: 'round', join: 'round' }, itemStyle: { color: C.line },
        areaStyle: { color: C.line, opacity: 0.08, origin: 0 },
        markLine: { silent: true, symbol: 'none', data: marks },
        markPoint: {
          symbol: 'circle', symbolSize: 9, silent: true, animation: false,
          data: stops.filter(stop => stop.t <= now).map(stop => {
            const failure = stop.reasons.some(r => r.type === 'failure');
            const point = points.find(p => p[0] === stop.t);
            return { coord: [stop.t, point?.[1] ?? 0], label: { show: false },
                     itemStyle: { color: failure ? '#d4361f' : C.line, borderColor: C.card, borderWidth: 2 } };
          }),
        },
        markArea: {
          silent: true, itemStyle: { color: C.future },
          label: { show: true, position: 'insideTop', color: C.muted, fontSize: 11, formatter: 'Not happened yet' },
          data: ended || now >= horizon ? [] : [[{ xAxis: now }, { xAxis: horizon }]],
        },
      }],
    }, { replaceMerge: ['series'] });
  }, [history, horizon, now, ended, stops]);

  const last = history.at(-1);
  const summary = last
    ? `After year ${last.year}: ${signedChf(gained(last))} compared with doing nothing.`
    : 'Nothing has happened yet.';
  return <div ref={host} className={`${className} w-full`} role="img" aria-label={`Money compared with doing nothing. ${summary}`} />;
}
