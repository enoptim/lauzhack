import { Area, CartesianGrid, ComposedChart, Line, ReferenceArea, ReferenceDot, ReferenceLine, XAxis, YAxis } from 'recharts';
import type { FanPoint, SimulateResult } from '@/api/types';
import { ChartContainer, ChartTooltip, type ChartConfig } from '@/components/ui/chart';
import { chfShort } from './format';
import { seriesColor, whatIfLabels } from './labels';
import type { WhatIf } from './useEngine';

type Props = {
  runs: Record<string, SimulateResult>;
  whatIfs: WhatIf[];
  staffEffects: boolean;
  fan: FanPoint[] | null;
  /** Years past this are hidden, for the play button. */
  visibleUntil: number;
  belowMinimum: [number, number] | null;
  animate: boolean;
};

export default function MoneyChart({ runs, whatIfs, staffEffects, fan, visibleUntil, belowMinimum, animate }: Props) {
  const plan = runs.plan;
  if (!plan) return null;
  const key = staffEffects ? 'cumulative_economic_cf' : 'cumulative_cash_cf';
  const payback = staffEffects ? plan.finance.payback_economic : plan.finance.payback_cash;

  const rows = plan.finance.years.map((year, index) => {
    const shown = year.year <= visibleUntil;
    const row: Record<string, number | [number, number] | null> = {
      year: year.year,
      plan: shown ? year[key] : null,
      cash: shown && staffEffects ? year.cumulative_cash_cf : null,
      band: fan?.[index] && !staffEffects ? [fan[index].p10, fan[index].p90] : null,
    };
    for (const id of whatIfs) {
      const other = runs[id]?.finance.years[index];
      row[id] = shown && other ? other[key] : null;
    }
    return row;
  });

  const config: ChartConfig = {
    plan: { label: staffEffects ? 'With staff effects' : 'As planned', color: seriesColor.plan },
    cash: { label: 'Money only', color: 'var(--chart-5)' },
    band: { label: 'Range of futures', color: seriesColor.plan },
    ...Object.fromEntries(whatIfs.map(id => [id, { label: whatIfLabels[id], color: seriesColor[id] }])),
  };

  return (
    <ChartContainer config={config} className="aspect-auto h-[22rem] w-full md:h-[26rem]">
      <ComposedChart data={rows} margin={{ top: 12, right: 12, bottom: 0, left: 8 }}>
        <defs>
          <linearGradient id="plan-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.22} />
            <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
          </linearGradient>
          <pattern id="below-minimum" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="8" stroke="var(--warning)" strokeWidth="1.5" strokeOpacity="0.22" />
          </pattern>
        </defs>
        <CartesianGrid vertical={false} stroke="var(--border)" />
        <XAxis
          dataKey="year" type="number" domain={[1, rows.length]} ticks={[1, 5, 10, 15].filter(t => t <= rows.length)}
          tickFormatter={value => `Year ${value}`} tickLine={false} axisLine={false} tickMargin={10}
          className="text-sm"
        />
        <YAxis tickFormatter={value => chfShort(value)} tickLine={false} axisLine={false} width={84} className="text-sm" />

        {belowMinimum && (
          <ReferenceArea x1={belowMinimum[0] - 0.5} x2={belowMinimum[1] + 0.5} fill="url(#below-minimum)" stroke="none"
            label={{ value: 'Savings below minimum', position: 'insideTopLeft', fill: 'var(--warning)', fontSize: 13, fontWeight: 500 }} />
        )}
        <ReferenceLine y={0} stroke="var(--foreground)" strokeOpacity={0.35} />

        <Area dataKey="band" type="monotone" stroke="none" fill="var(--chart-1)" fillOpacity={0.07}
          isAnimationActive={animate} activeDot={false} connectNulls />
        <Area dataKey="plan" type="monotone" stroke="var(--chart-1)" strokeWidth={2.5} fill="url(#plan-fill)"
          baseValue="dataMin" strokeDasharray={staffEffects ? '7 5' : undefined}
          isAnimationActive={animate} dot={false} activeDot={{ r: 5, strokeWidth: 2, stroke: 'var(--card)' }} />
        {staffEffects && (
          <Line dataKey="cash" type="monotone" stroke="var(--chart-5)" strokeWidth={2} dot={false} isAnimationActive={animate} />
        )}
        {whatIfs.map(id => (
          <Line key={id} dataKey={id} type="monotone" stroke={seriesColor[id]} strokeWidth={2}
            strokeDasharray={staffEffects ? '7 5' : undefined} dot={false}
            activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--card)' }} isAnimationActive={animate} />
        ))}

        {payback !== null && payback <= visibleUntil && (
          <ReferenceDot x={payback} y={0} r={6} fill="var(--chart-1)" stroke="var(--card)" strokeWidth={2}
            label={{ value: `Pays back · year ${payback.toFixed(1)}`, position: 'top', offset: 12, fill: 'var(--foreground)', fontSize: 13, fontWeight: 500 }} />
        )}

        <ChartTooltip
          cursor={{ stroke: 'var(--muted-foreground)', strokeOpacity: 0.4 }}
          content={({ active, payload, label }) => {
            if (!active || !payload?.length) return null;
            return (
              <div className="grid min-w-44 gap-1.5 rounded-lg border bg-popover px-3 py-2 text-sm shadow-lg">
                <span className="font-medium">Year {label}</span>
                {payload.filter(item => item.dataKey !== 'band' && typeof item.value === 'number').map(item => (
                  <span key={String(item.dataKey)} className="flex items-center justify-between gap-4">
                    <span className="flex items-center gap-2 text-muted-foreground">
                      <span className="size-2 rounded-[2px]" style={{ background: item.color ?? item.stroke }} />
                      {config[String(item.dataKey)]?.label}
                    </span>
                    <span className="font-medium tabular-nums">{chfShort(item.value as number)}</span>
                  </span>
                ))}
              </div>
            );
          }}
        />
      </ComposedChart>
    </ChartContainer>
  );
}
