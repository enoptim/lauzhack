import { Dices, Pause, Play, TriangleAlert } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { num, Segmented, Skeleton } from './parts';
import PlansChart, { type ChartMarker } from './PlansChart';
import type { WhatIf } from './useEngine';
import { HORIZONS, MS_PER_YEAR, storyText, type ResultsModel } from './useResultsModel';

/** Each what-if happens in a fixed year in every future (see whatIfDetails in labels.ts). */
const WHAT_IF_MARKERS: Record<WhatIf, ChartMarker> = {
  energy_price_spike: { year: 3, label: 'Energy crisis' },
  heatwave_summer: { year: 6, label: 'Heatwave' },
  new_lab: { year: 4, label: '60 more staff' },
};

/** A small line sample for the legend: solid, dashed, or a soft band. */
function LegendKey({ kind, color }: { kind: 'band' | 'line' | 'dashed'; color: string }) {
  if (kind === 'band') return <span aria-hidden="true" className="h-2.5 w-4 rounded-[2px]" style={{ background: `color-mix(in oklch, ${color} 18%, transparent)` }} />;
  return (
    <svg aria-hidden="true" width="16" height="4" className="shrink-0">
      <line x1="0" y1="2" x2="16" y2="2" stroke={color} strokeWidth={kind === 'line' ? 2.5 : 1.5} strokeDasharray={kind === 'dashed' ? '4 3' : undefined} strokeLinecap="round" />
    </svg>
  );
}

/**
 * The chart section: money saved compared with doing nothing, year by year, for every plan.
 * The band shows where 8 in 10 futures land. Play tells one future year by year.
 */
export default function ChartPanel({ m }: { m: ResultsModel }) {
  const color = m.colorOf(m.selected);
  const markers: ChartMarker[] = [
    ...(m.whatIf ? [WHAT_IF_MARKERS[m.whatIf]] : []),
    ...(typeof m.timing === 'number' ? [{ year: m.timing, label: 'Buy' }] : []),
  ].filter(mk => mk.year <= m.horizon);
  const count = m.futures?.samples.length ?? 0;
  const playLabel = m.playState === 'idle'
    ? <>Play <span className={num}>{m.horizon}</span> years</>
    : <>{m.playState === 'playing' ? 'Pause' : 'Resume'} · {m.playYear ? <>year <span className={num}>{m.playYear}</span></> : 'today'}</>;

  const idle = m.playState === 'idle';

  return (
    <section aria-labelledby="chart-title" className="@container/chart flex flex-col gap-3 border-t border-[var(--r-divider)] px-5 pt-4 pb-5 @min-[40rem]/results:px-8">
      <div className="flex h-8 items-center justify-between gap-4">
        <h2 id="chart-title" className="min-w-0 text-sm font-semibold text-foreground">
          <span className="@min-[47rem]/chart:hidden">Money saved vs. doing nothing</span>
          <span className="hidden @min-[47rem]/chart:inline">Money saved compared with doing nothing</span>
        </h2>
        <div className="flex shrink-0 items-center gap-2">
          <Segmented label="Years to show" value={m.horizon} onChange={m.setHorizon}
            options={HORIZONS.map(h => ({ value: h, label: <><span className={num}>{h}</span> years</> }))} />
          <Button onClick={m.play} disabled={!m.futures} className="h-8 min-w-[9.5rem] justify-start px-3">
            {m.playState === 'playing' ? <Pause data-icon="inline-start" /> : <Play data-icon="inline-start" />}
            <span>{playLabel}</span>
          </Button>
        </div>
      </div>

      <div>
        <div className="h-[22rem] @min-[56rem]/results:h-[clamp(18rem,calc(100dvh-24rem),30rem)]">
          {m.futures ? (
            <div className={cn('h-full transition-opacity duration-200', m.busy && 'opacity-60')} aria-busy={m.busy}>
              <PlansChart lines={m.lines} selected={m.selected} highlighted={m.hovered} horizon={m.horizon} dashed={m.staffEffects}
                notes={m.notes} ghost={m.ghost} markers={markers} onSelect={m.selectPlan} playToken={m.playToken}
                playing={m.playState === 'playing'} msPerYear={MS_PER_YEAR} onYear={m.onYear} className="h-full" />
            </div>
          ) : m.engine.futures.error || m.outdated ? (
            <Alert variant="destructive">
              <TriangleAlert />
              <AlertTitle>{m.outdated ? 'The engine is out of date.' : 'The possible futures could not be worked out.'}</AlertTitle>
              <AlertDescription>Restart the engine with <code className="font-mono">make dev</code>, then reload this page.</AlertDescription>
            </Alert>
          ) : <Skeleton className="h-full w-full rounded-md" />}
        </div>
        {/* One fixed line under the plot: keys come and go without moving the chart. */}
        <ul aria-label="Legend" className="mt-2 flex h-5 items-center gap-4 overflow-hidden text-xs whitespace-nowrap text-muted-foreground">
          <li className="flex items-center gap-1.5"><LegendKey kind="band" color={m.example ? '#9a968f' : color} />8 in 10 futures</li>
          <li className="flex items-center gap-1.5"><LegendKey kind="line" color={color} />{m.example ? 'This future' : 'Middle future'}</li>
          {m.ghost && !m.example && <li className="flex items-center gap-1.5"><LegendKey kind="dashed" color="#9a968f" />Before your change</li>}
          {m.staffEffects && <li className="flex items-center gap-1.5"><LegendKey kind="dashed" color={color} />Staff effects (a guess)</li>}
        </ul>
      </div>

      <div className="flex flex-col gap-3 border-t border-[var(--r-divider)] pt-4 @min-[36rem]/chart:flex-row @min-[36rem]/chart:items-start @min-[36rem]/chart:gap-5">
        <div className="flex shrink-0 items-center gap-1">
          <Button variant="outline" size="sm" disabled={!m.futures || !idle} className="w-[13.5rem] justify-start hover:bg-[var(--r-track)] hover:text-foreground"
            onClick={() => m.setExampleIndex(index => (index === null ? 0 : index + 1))}>
            <Dices data-icon="inline-start" />
            {m.example ? 'Show another future' : 'Show one possible future'}
          </Button>
          <Button variant="ghost" size="sm" disabled={!idle} onClick={m.showAllFutures} className={cn('text-muted-foreground hover:bg-[var(--r-track)] hover:text-foreground', !m.example && 'invisible')}>
            Back to all futures
          </Button>
        </div>
        <p className="min-h-[3.75rem] text-[13px] leading-5 text-pretty @min-[36rem]/chart:pt-1" aria-live="polite">
          {m.example?.pinned ? (
            <>
              <span className="font-medium text-foreground">The future you played. </span>
              <span className="text-muted-foreground">{storyText(m.example, m.failures)}</span>
            </>
          ) : m.example && m.exampleNumber !== null ? (
            <>
              <span className="font-medium text-foreground">
                Example <span className={num}>{m.exampleNumber + 1}</span> of <span className={num}>{count}</span>, picked from the <span className={num}>{m.futuresN}</span>
                {m.exampleNumber === m.typicalIndex ? ', the one closest to the middle line' : ''}.{' '}
              </span>
              <span className="text-muted-foreground">{storyText(m.example, m.failures)}</span>
            </>
          ) : (
            <span className="text-muted-foreground">
              We ran {m.futuresN} possible futures. In each, prices move, heatwaves come and old equipment fails earlier or later.
              The line is the middle one. Show one future to see what happens in it.
            </span>
          )}
        </p>
      </div>
    </section>
  );
}
