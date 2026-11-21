import * as echarts from 'echarts';
import { useEffect, useRef } from 'react';
import type { SimulateResult } from '@/api/types';
import { chf, chfShort } from './format';

/** Canvas colours. They mirror the tokens in styles.css (ECharts cannot read CSS variables). */
const C = {
  upgrade: '#c34e00',
  nothing: '#8a8a8a',
  ink: '#262626',
  muted: '#737373',
  grid: '#ececec',
  card: '#ffffff',
  ahead: 'rgba(111,127,31,0.14)',
  behind: 'rgba(212,54,31,0.08)',
};

export type Totals = {
  year: number;
  nothing: number;
  upgrade: number;
  /** What doing nothing spends on replacing worn-out equipment this year (0 if nothing). */
  nothingReplaces: number;
  /** Doing nothing's total so far, split: extra energy and upkeep, replacements, lost staff value. */
  nothingRunning: number;
  nothingReplacedSoFar: number;
  nothingStaff: number;
};

/**
 * Money that depends on the choice, added up from today to `horizon`.
 * Costs both paths share (most of the energy bill, other equipment) are left out, so the gap is visible.
 * Doing nothing: the extra energy and upkeep it pays, plus replacing worn-out units when they fail.
 * Upgrade: the purchase today, plus any year it costs more than doing nothing.
 * With staff effects on, doing nothing also loses the value of better work and fewer sick days.
 */
export function totals(run: SimulateResult, horizon: number, staffEffects: boolean): Totals[] {
  const rows: Totals[] = [{ year: 0, nothing: 0, upgrade: run.finance.capex_year0, nothingReplaces: 0, nothingRunning: 0, nothingReplacedSoFar: 0, nothingStaff: 0 }];
  let nothing = 0;
  let upgrade = run.finance.capex_year0;
  let runningSoFar = 0;
  let replacedSoFar = 0;
  let staffSoFar = 0;
  for (const y of run.finance.years) {
    if (y.year > horizon) break;
    const replaces = Math.max(y.capex_baseline - y.capex, 0);
    const running = y.operating_cost_baseline - y.operating_cost;
    const people = staffEffects ? y.economic_cf - y.cash_cf : 0;
    runningSoFar += Math.max(running, 0);
    replacedSoFar += replaces;
    staffSoFar += Math.max(people, 0);
    nothing += replaces + Math.max(running, 0) + Math.max(people, 0);
    upgrade += Math.max(y.capex - y.capex_baseline, 0) + Math.max(-running, 0) + Math.max(-people, 0);
    rows.push({ year: y.year, nothing, upgrade, nothingReplaces: replaces, nothingRunning: runningSoFar, nothingReplacedSoFar: replacedSoFar, nothingStaff: staffSoFar });
  }
  return rows;
}

/** The year (with decimals) where the upgrade's total drops below doing nothing's. */
export function crossing(rows: Totals[]): number | null {
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1].upgrade - rows[i - 1].nothing;
    const b = rows[i].upgrade - rows[i].nothing;
    if (a > 0 && b <= 0) return rows[i - 1].year + (a / (a - b)) * (rows[i].year - rows[i - 1].year);
  }
  return null;
}

function interpolate(rows: Totals[], year: number): number {
  const i = Math.max(1, rows.findIndex(r => r.year >= year));
  const a = rows[i - 1];
  const b = rows[i];
  return a.nothing + ((year - a.year) / (b.year - a.year)) * (b.nothing - a.nothing);
}

type Props = {
  rows: Totals[];
  horizon: number;
  staffEffects: boolean;
  /** What the plan replaces, in plain words, e.g. "ventilation". */
  equipment: string;
  /** Changes on every press of Play; the chart then redraws from today over `playMs`. */
  playToken: number;
  playMs: number;
};

type TooltipItem = { dataIndex: number };

export default function MoneyChart({ rows, horizon, staffEffects, equipment, playToken, playMs }: Props) {
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
    if (!instance || rows.length < 2) return;
    const replay = playToken !== lastToken.current;
    lastToken.current = playToken;
    const payback = crossing(rows);
    const last = rows[rows.length - 1];

    // Shade the gap: green where the upgrade has spent less, red where it has spent more.
    const lower = rows.map(r => [r.year, Math.min(r.nothing, r.upgrade)]);
    const behind = rows.map(r => [r.year, Math.max(r.upgrade - r.nothing, 0)]);
    const ahead = rows.map(r => [r.year, Math.max(r.nothing - r.upgrade, 0)]);
    const quiet = { type: 'line' as const, silent: true, symbol: 'none', lineStyle: { opacity: 0 }, stackStrategy: 'all' as const };

    const option: echarts.EChartsOption = {
      animationDuration: replay ? playMs : 800,
      animationDurationUpdate: 650,
      animationEasing: replay ? 'linear' : 'cubicOut',
      animationEasingUpdate: 'cubicInOut',
      grid: { left: 8, right: 150, top: 24, bottom: 8, containLabel: true },
      textStyle: { fontFamily: 'Geist, ui-sans-serif, system-ui, sans-serif' },
      xAxis: {
        type: 'value', min: 0, max: horizon, interval: horizon > 10 ? 5 : horizon > 5 ? 2 : 1,
        axisLabel: { color: C.muted, fontSize: 13, formatter: (v: number) => (v === 0 ? 'Today' : `Year ${v}`) },
        axisLine: { show: false }, axisTick: { show: false }, splitLine: { show: false },
      },
      yAxis: {
        type: 'value', min: 0,
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
          const r = rows[(raw as TooltipItem[])[0]?.dataIndex];
          if (!r) return '';
          const gap = r.nothing - r.upgrade;
          const small = (text: string) => `<div style="color:${C.muted};font-size:12px;margin:1px 0 6px 14px">${text}</div>`;
          const line = (color: string, label: string, value: number) =>
            `<div style="display:flex;justify-content:space-between;gap:20px"><span><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${color};margin-right:6px"></span>${label}</span><b style="font-variant-numeric:tabular-nums">${chfShort(value)}</b></div>`;
          const nothingParts = [
            r.nothingRunning > 0 && `higher energy and upkeep bills ${chfShort(r.nothingRunning)}`,
            r.nothingReplacedSoFar > 0 && `replacing worn-out ${equipment} ${chfShort(r.nothingReplacedSoFar)}`,
            r.nothingStaff > 0 && `lost staff value ${chfShort(r.nothingStaff)} (a guess)`,
          ].filter(Boolean).join(' + ');
          return `<div style="max-width:290px;white-space:normal">`
            + `<div style="font-weight:600;margin-bottom:6px">${r.year === 0 ? 'Today' : `After ${r.year} ${r.year === 1 ? 'year' : 'years'}`}</div>`
            + line(C.nothing, 'Doing nothing has cost', r.nothing)
            + small(nothingParts || 'nothing extra yet')
            + line(C.upgrade, 'The upgrade has cost', r.upgrade)
            + small(r.upgrade - rows[0].upgrade < 1000 ? 'the purchase today; after that it costs nothing extra, because its energy bill is lower' : 'the purchase today, plus years it cost more')
            + `<div style="padding-top:6px;border-top:1px solid ${C.grid};font-weight:600">${r.year === 0 ? `You pay ${chfShort(r.upgrade)} up front` : gap >= 0 ? `The upgrade has saved you ${chfShort(gap)} so far` : `The upgrade still needs ${chfShort(-gap)} to pay for itself`}</div>`
            + (r.nothingReplaces >= 50_000 ? `<div style="margin-top:6px;color:${C.muted}"><b style="color:${C.ink}">Why the grey line jumps:</b> this year the old ${equipment} would wear out. Doing nothing means buying new units for ${chf(r.nothingReplaces)}. With the upgrade, you already have them.</div>` : '')
            + `</div>`;
        },
      },
      series: [
        { ...quiet, id: 'gap-base', stack: 'behind', data: lower },
        { ...quiet, id: 'gap-behind', stack: 'behind', areaStyle: { color: C.behind }, data: behind },
        { ...quiet, id: 'gap-base-2', stack: 'ahead', data: lower },
        { ...quiet, id: 'gap-ahead', stack: 'ahead', areaStyle: { color: C.ahead }, data: ahead },
        {
          id: 'nothing', type: 'line', name: 'Doing nothing', data: rows.map(r => [r.year, r.nothing]),
          symbol: 'none', lineStyle: { width: 2.5, color: C.nothing, cap: 'round', join: 'round', type: staffEffects ? [8, 6] : 'solid' }, itemStyle: { color: C.nothing },
          endLabel: { show: true, color: C.muted, fontSize: 13, distance: 10, lineHeight: 18, formatter: `Doing nothing\n${chfShort(last.nothing)}` },
          labelLayout: { moveOverlap: 'shiftY' },
        },
        {
          id: 'upgrade', type: 'line', name: 'With the upgrade', data: rows.map(r => [r.year, r.upgrade]),
          symbol: 'none', z: 5,
          lineStyle: { width: 3, color: C.upgrade, cap: 'round', join: 'round', type: 'solid' },
          itemStyle: { color: C.upgrade },
          endLabel: { show: true, color: C.upgrade, fontSize: 13, fontWeight: 600, distance: 10, lineHeight: 18, formatter: last.upgrade - rows[0].upgrade < 1000 ? `With the upgrade\n${chfShort(last.upgrade)}, paid once` : `With the upgrade\n${chfShort(last.upgrade)}` },
          labelLayout: { moveOverlap: 'shiftY' },
          markPoint: payback === null ? undefined : {
            symbol: 'circle', symbolSize: 12,
            itemStyle: { color: C.upgrade, borderColor: C.card, borderWidth: 3 },
            label: {
              show: true, position: 'top', distance: 12, color: C.ink, fontSize: 14, fontWeight: 600,
              backgroundColor: C.card, borderColor: C.grid, borderWidth: 1, borderRadius: 8, padding: [6, 10],
              shadowColor: 'rgba(40,30,20,0.12)', shadowBlur: 12, shadowOffsetY: 4,
              formatter: `Paid for itself · year ${payback.toFixed(1)}`,
            },
            animationDelay: replay ? (payback / horizon) * playMs : 400,
            data: [{ name: 'payback', coord: [payback, interpolate(rows, payback)] }],
          },
        },
      ],
    };
    instance.setOption(option, replay ? { notMerge: true } : { replaceMerge: ['series'] });
  }, [rows, horizon, staffEffects, equipment, playToken, playMs]);

  return <div ref={host} role="img" aria-label="Money that depends on the choice: doing nothing compared with the upgrade" className="h-[24rem] w-full md:h-[28rem]" />;
}
