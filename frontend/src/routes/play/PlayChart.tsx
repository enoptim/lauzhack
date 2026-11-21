import * as echarts from 'echarts';
import { useEffect, useRef } from 'react';
import type { FinanceYear } from '@/api/types';
import { chfShort, signedChf } from './format';

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
};

/** Money compared with doing nothing, added up year by year, up to now. The rest of the chart is still empty. */
export default function PlayChart({ history, horizon, now, ended }: Props) {
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
    const points = [[0, today], ...history.map(row => [row.year, row.cumulative_cash_cf])];
    const marks: object[] = [{
      yAxis: 0, lineStyle: { color: C.zero, type: 'solid', width: 1 },
      label: { formatter: 'Doing nothing', position: 'insideEndTop', color: C.muted, fontSize: 12 },
    }];
    if (!ended) {
      marks.push({ xAxis: now, lineStyle: { color: C.line, type: 'dashed', width: 1.5 },
        label: { formatter: 'Now', position: 'end', color: C.line, fontSize: 12 } });
    }
    chart.current?.setOption({
      animationDuration: 500,
      animationDurationUpdate: 500,
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
          return `<b>${year === 0 ? 'Today' : `After year ${year}`}</b><br/>${signedChf(value)} vs doing nothing`;
        },
      },
      series: [{
        type: 'line', data: points, symbol: 'circle', symbolSize: 7, showSymbol: true,
        lineStyle: { width: 3, color: C.line, cap: 'round', join: 'round' }, itemStyle: { color: C.line },
        markLine: { silent: true, symbol: 'none', data: marks },
        markArea: ended || now >= horizon ? undefined : {
          silent: true, itemStyle: { color: C.future },
          label: { show: true, position: 'inside', color: C.muted, fontSize: 12, formatter: 'Not happened yet' },
          data: [[{ xAxis: now }, { xAxis: horizon }]],
        },
      }],
    }, true);
  }, [history, horizon, now, ended]);

  const last = history.at(-1);
  const summary = last
    ? `After year ${last.year}: ${signedChf(last.cumulative_cash_cf)} compared with doing nothing.`
    : 'Nothing has happened yet.';
  return <div ref={host} className="h-64 w-full" role="img" aria-label={`Money compared with doing nothing. ${summary}`} />;
}
