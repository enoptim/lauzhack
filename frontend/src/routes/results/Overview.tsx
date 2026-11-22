import { useState, type ReactNode } from 'react';
import { ChevronRight, TrendingDown, TrendingUp, TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
import AnimatedNumber from './AnimatedNumber';
import { chf, chfShort } from './format';
import { flagShort, flagText, whatIfLabels } from './labels';
import { Fold } from './Fold';
import { num, Skeleton } from './parts';
import type { ResultsModel } from './useResultsModel';

/**
 * The top of the middle column: the main sentence of the page, how much the last change moved it,
 * and five key numbers. Every line keeps its height, so the chart below never jumps.
 */

/**
 * The years in which 8 in 10 futures pay back, short: "7.4–10.7", or "7.4 to over 15".
 * Worked out from each future's own payback year (10th to 90th percentile), never from the band's edges.
 */
const paybackRange = (good: number, bad: number | null, horizon: number) =>
  (bad === null ? `${good.toFixed(1)} to over ${horizon}` : `${good.toFixed(1)}–${bad.toFixed(1)}`);
const yearsShort = (value: number) => `${value.toFixed(1)} years`;
const mwh = (kwh: number) => `${Math.round(kwh / 1000).toLocaleString('en-US')} MWh`;
const ppm = (value: number) => `${Math.round(value).toLocaleString('en-US')} ppm`;
const percent = (value: number) => `${value < 0 ? '−' : '+'}${Math.abs(Math.round(value))}%`;
/** How the CO₂ level compares with the 1000 ppm aim, in a few words. */
const co2Note = (value: number, today: number) =>
  `${value > 1000.5 ? 'over 1000' : value >= 950 ? 'at the limit' : 'good'} · was ${today}`;
const ordinal = (n: number) => `${n}${n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`;

/** Live status on the right of the verdict: working, or up to date. */
function Status({ busy, futuresN }: { busy: boolean; futuresN: number }) {
  return (
    <span role="status" aria-live="polite" className="flex shrink-0 items-center gap-2 text-xs whitespace-nowrap text-muted-foreground">
      <span aria-hidden="true" className="relative flex size-1.5">
        {busy && <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary opacity-60 motion-reduce:animate-none" />}
        <span className={cn('relative inline-flex size-1.5 rounded-full transition-colors duration-150',
          busy ? 'bg-primary' : 'bg-muted-foreground/50')} />
      </span>
      {busy ? `Working out ${futuresN} futures…` : 'Up to date'}
    </span>
  );
}

/** How much the last change of assumptions moved the result. Quiet: a hairline outline, no fill. */
function DeltaChip({ delta, label }: { delta: number; label: string }) {
  const none = Math.abs(delta) < 1000;
  const up = delta > 0;
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <span className="inline-flex h-7 min-w-0 shrink items-center gap-1.5 rounded-md border border-[var(--r-line)] px-2 text-[13px] animate-in fade-in slide-in-from-bottom-1 duration-200 motion-reduce:animate-none">
      {none ? <span className="text-muted-foreground">No change</span> : (
        <span className={cn('flex shrink-0 items-center gap-1', up ? 'text-positive' : 'text-warning')}>
          <Icon aria-hidden="true" className="size-4" />
          <span className={cn(num, 'text-[15px] font-semibold')}>{up ? '+' : ''}{chfShort(delta)}</span>
        </span>
      )}
      <span className="max-w-[28rem] truncate text-muted-foreground">· {label}</span>
    </span>
  );
}

/** A warning about the plan that happens in a real share of the futures, e.g. "Needs a loan in 98% of futures". */
function WarningChip({ w }: { w: ResultsModel['planWarnings'][number] }) {
  const share = w.share >= 0.995 ? 'every future' : `${Math.round(w.share * 100)}% of futures`;
  const when = w.fixed?.year !== undefined ? ` With your assumptions and no surprises: from year ${w.fixed.year}.` : '';
  return (
    <span title={`${w.fixed ? flagText(w.fixed) : ''}${when}`.trim() || undefined}
      className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md bg-warning/8 px-2 text-[13px]">
      <TriangleAlert aria-hidden="true" className="size-3.5 text-warning" />
      {flagShort[w.type] ?? w.type.replaceAll('_', ' ')} in {share}
    </span>
  );
}

/**
 * The headline counts cash only, like the chart. This line says what it leaves out and adds it back for one real
 * middle future, so the steps add up exactly: cash saved, the difference in equipment still worth something at the end,
 * where that leaves the plan, and the same in today's money (NPV). Then the share of futures where that is above zero.
 */
function Chain({ c }: { c: NonNullable<ResultsModel['chain']> }) {
  const strong = (value: string) => <span className={cn(num, 'font-medium text-foreground')}>{value}</span>;
  const less = c.leftover_value < 0;
  const rate = c.discountRate !== null ? `, ${Math.round(c.discountRate * 1000) / 10}% a year` : '';
  const share = Math.round(c.npvPositiveShare * 100);
  return (
    <div className="flex flex-col">
      <p>Not counted above: equipment still worth something at the end, and today’s money. One middle future, year {c.year}:</p>
      <p className="text-pretty">
        {strong(chfShort(c.cash_saved))} cash saved{' '}
        <span title={less ? 'Doing nothing buys its replacements later, so its equipment is newer and worth more at the end.'
          : 'The plan’s equipment is newer, so it is worth more at the end.'}>
          {less ? '−' : '+'} {strong(chfShort(Math.abs(c.leftover_value)))} {less ? 'less' : 'more'} equipment value left
        </span>{' '}
        = {strong(chfShort(Math.abs(c.ahead)))} {c.ahead >= 0 ? 'ahead' : 'behind'}{' '}
        <span title={`NPV (net present value): all ${c.year} years of money vs doing nothing, in today’s francs. A franc later counts less than a franc today.`}>
          → {strong(chfShort(c.npv_cash))} in today’s money (NPV{rate})
        </span>.{' '}
        <span className={cn(share < 50 && 'text-warning')}>{share}% of futures end ahead in today’s money.</span>
      </p>
    </div>
  );
}

/** A small muted tag in the chip line, e.g. "With: energy crisis". */
function Tag({ children }: { children: ReactNode }) {
  return <span className="shrink-0 text-xs text-muted-foreground">{children}</span>;
}

/**
 * Hairlines between the cells of the KPI strip, by container width:
 * 2 columns when narrow, 3 from 30rem, 5 from 36rem. The first cell of each row starts flush with the text above.
 */
function cellClass(k: number) {
  return cn('border-[var(--r-divider)]',
    // 2 columns
    k % 2 === 1 ? 'border-l' : 'pl-0', k >= 2 && 'border-t',
    // 3 columns
    k % 3 === 0 ? '@[30rem]:border-l-0 @[30rem]:pl-0' : '@[30rem]:border-l @[30rem]:pl-3',
    k >= 3 ? '@[30rem]:border-t' : '@[30rem]:border-t-0',
    // 5 columns
    k === 0 ? '@[36rem]:pl-0' : '@[36rem]:border-l @[36rem]:pl-3', '@[36rem]:border-t-0');
}

function Kpi({ label, value, sub, title, subTitle, busy, className }: {
  label: string; value: ReactNode; sub: ReactNode; title?: string; subTitle?: string; busy: boolean; className?: string;
}) {
  return (
    <div title={title} className={cn('flex min-w-0 flex-col gap-1 px-3 py-2.5', className)}>
      <dt className="truncate text-xs text-muted-foreground">{label}</dt>
      <dd className={cn('flex flex-col gap-1 transition-opacity duration-150', busy && 'opacity-60')}>
        <span className={cn(num, 'flex h-7 items-center text-[20px] @[44rem]:text-[22px] font-medium tracking-tight whitespace-nowrap text-foreground')}>{value}</span>
        <span title={subTitle} className="h-4 truncate text-xs leading-4 whitespace-nowrap text-muted-foreground">{sub}</span>
      </dd>
    </div>
  );
}

export default function Overview({ m }: { m: ResultsModel }) {
  const [warningsOpen, setWarningsOpen] = useState(false);
  const { focus, horizon, endValue, busy, today, after, futuresN } = m;
  const color = m.colorOf(m.selected);
  const subject = m.multi ? m.plans[m.selected]?.name ?? 'The plan' : 'The upgrade';
  const pending = <Skeleton className="h-6 w-24" />;
  const pendingSub = <Skeleton className="h-3 w-20" />;
  const strong = (value: string) => <span className={cn(num, 'text-foreground')}>{value}</span>;

  // While Play runs, the verdict follows the example future year by year, at the same year as the chart's label.
  const playing = m.playState !== 'idle' && m.playYear !== null && Boolean(focus?.example);
  const storyYear = Math.min(Math.floor(m.playYear ?? 0), horizon);
  const storyValue = playing ? focus?.example?.[storyYear] ?? 0 : 0;
  const empty = m.chosen.length === 0;
  // The headline is always cash. Staff effects are a guess, shown beside it, never instead of it.
  const cash = m.staffEffects ? m.cashEnd[m.selected] ?? endValue : endValue;

  const money = (value: number, tone: 'plan' | 'plain' | 'warning', title?: string) => (
    <span title={title} style={tone === 'plan' ? { color } : undefined}
      className={cn('whitespace-nowrap', tone === 'warning' && 'text-warning', tone === 'plain' && 'text-foreground')}>
      {/* While Play runs the number steps year by year, exactly like the chart's label; otherwise it glides. */}
      {playing ? <span className={cn(num, 'font-semibold')}>{chfShort(Math.abs(value))}</span>
        : <AnimatedNumber value={Math.abs(value)} format={chfShort} className={cn(num, 'font-semibold')} />}
    </span>
  );
  const yearLabel = <span className="text-muted-foreground">{storyYear === 0 ? 'Today' : `Year ${storyYear}`} · </span>;

  let verdict: ReactNode;
  if (empty) verdict = 'This plan changes nothing. It is the same as doing nothing.';
  else if (playing) {
    verdict = storyYear === 0 ? <>{yearLabel}{money(storyValue, 'plain')} paid</>
      : storyValue < 0 ? <>{yearLabel}{money(storyValue, 'plain')} still to earn back</>
        : <>{yearLabel}{subject} has saved {money(storyValue, 'plan')} so far</>;
  } else {
    // Cash only, like the chart: it leaves out equipment left at the end and today's money (the line below adds them).
    verdict = cash >= 0
      ? <>{subject} saves {money(cash, 'plan', `Cash saved by year ${horizon}, middle of ${futuresN} futures: how much more doing nothing would have spent. Leaves out equipment left at the end and today’s money.`)} in cash by year {horizon}</>
      : <>{subject} is {money(cash, 'warning', `Cash by year ${horizon}, middle of ${futuresN} futures: it has not paid for itself yet.`)} short in cash by year {horizon}</>;
  }

  // Where the selected plan ranks among all plans, by cash in the middle future at the end.
  const ends = m.cashEnd;
  const known = ends.filter((v): v is number => v !== null);
  const bestIndex = ends.reduce<number>((best, v, k) => (v !== null && (ends[best] === null || v > (ends[best] as number)) ? k : best), 0);
  const rank = known.filter(v => v > cash).length + 1;
  let ranking: ReactNode = null;
  if (m.multi && focus && known.length > 1) {
    const bestEnd = ends[bestIndex] ?? 0;
    ranking = rank === 1 ? `Best of ${known.length} plans` : (
      <>
        {ordinal(rank)} of {known.length} ·{' '}
        <button type="button" onClick={() => m.selectPlan(bestIndex)}
          className="rounded-sm text-foreground underline decoration-[var(--r-line)] underline-offset-2 transition-colors duration-150 hover:decoration-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none">
          {m.plans[bestIndex]?.name}
        </button>
        {bestEnd >= 0 ? ` saves the most (${chfShort(bestEnd)})` : ' comes out best'}
      </>
    );
  }

  // The chip already names the last change; don't repeat it as a tag next to it.
  const lastLabel = m.lastChange && m.delta !== null ? m.lastChange.label : '';
  const energyChange = today && after && today.kwh_year > 0 ? (after.kwh_year - today.kwh_year) / today.kwh_year * 100 : null;
  const saving = m.yearlySaving;
  // The 8-in-10 payback range, only when it means something: at least half the futures pay back in the years shown,
  // and a plan bought later can "pay back" in year 0.0.
  const rangeShown = m.payback !== null && m.goodPayback !== null && m.goodPayback > 0.05 && (m.badPayback === null || m.badPayback > 0.05);
  const paidTenths = m.paidBackShare === null ? null : Math.round(m.paidBackShare * 10);
  const paidShort = paidTenths === null ? null : m.paidBackShare === 1 ? 'all futures pay back'
    : m.paidBackShare === 0 ? 'no future pays back' : paidTenths === 0 ? 'under 1 in 10 pay back'
      : paidTenths === 10 ? 'over 9 in 10 pay back' : `${paidTenths} in 10 pay back`;

  // The cells of the KPI strip; each value shows a skeleton only before the first answer.
  const kpis: { label: string; value: ReactNode; sub: ReactNode; title?: string; subTitle?: string }[] = [
    {
      label: m.boughtIn === 0 ? 'Paid today' : m.boughtIn ? `Bought in year ${m.boughtIn}` : 'Cost',
      value: empty ? chfShort(0) : m.finance ? <AnimatedNumber value={m.purchase} format={chfShort} /> : pending,
      sub: empty || m.finance ? 'one-off' : pendingSub,
      title: `${chf(m.purchase)}: the price of the new equipment, in today’s francs.`,
    },
    {
      label: 'Costs saved, year 1',
      value: empty ? chfShort(0) : saving !== null ? <AnimatedNumber value={Math.abs(saving)} format={chfShort} /> : pending,
      sub: empty ? 'about the same' : saving !== null ? (Math.abs(saving) < 500 ? 'about the same' : saving > 0 ? 'lower than doing nothing' : 'higher than doing nothing') : pendingSub,
      title: 'What the building pays to run in year 1, compared with doing nothing. From one fixed run: your assumptions, no surprises.',
    },
    {
      label: 'Pays for itself in',
      value: empty ? '—' : !focus ? pending : m.payback === null ? <span className="text-[17px]">Over {horizon} years</span>
        : m.payback === 0 ? 'Right away' : <AnimatedNumber value={m.payback} format={yearsShort} />,
      sub: empty ? 'nothing to pay back' : !focus ? pendingSub
        : rangeShown ? `8 in 10: ${paybackRange(m.goodPayback as number, m.badPayback, horizon)}`
          : paidShort ? `${paidShort} by year ${horizon}` : 'not in most futures',
      subTitle: [
        rangeShown && `8 in 10 futures pay for themselves in ${paybackRange(m.goodPayback as number, m.badPayback, horizon)} years.`,
        paidShort && `By year ${horizon}: ${paidShort}.`,
      ].filter(Boolean).join(' ') || undefined,
      title: `When the money saved catches up with the money spent. The middle of ${futuresN} futures: half pay back sooner, half later. Counted like the chart, without the value of equipment left at the end.`,
    },
    {
      label: 'Energy use, year 1',
      value: after ? <AnimatedNumber value={after.kwh_year} format={mwh} /> : pending,
      sub: today ? (energyChange !== null && Math.abs(energyChange) >= 0.5 ? `${percent(energyChange)} vs today` : 'same as today') : pendingSub,
      subTitle: today ? `today ${mwh(today.kwh_year)}` : undefined,
      title: 'From one fixed run: your assumptions, no surprises.',
    },
    {
      label: 'Meeting room CO₂',
      value: after ? <AnimatedNumber value={after.outcomes.meeting_co2_ppm} format={ppm} /> : pending,
      sub: today && after ? co2Note(after.outcomes.meeting_co2_ppm, Math.round(today.outcomes.meeting_co2_ppm)) : pendingSub,
      title: 'CO₂ shows how fresh the air is. Below 1000 ppm is good. From one fixed run: your assumptions, no surprises.',
    },
  ];

  return (
    <section aria-label="Overview" className="@container relative flex flex-col px-5 pt-5 pb-0 @min-[40rem]/results:px-8">
      <span className="absolute top-1.5 right-5 @min-[40rem]/results:right-8"><Status busy={busy} futuresN={futuresN} /></span>
      {focus || empty ? (
        <h1 className={cn('truncate text-[26px] leading-9 font-semibold tracking-tight whitespace-nowrap transition-opacity duration-150 @[48rem]:text-[30px]',
          busy && 'opacity-60')}>
          {verdict}
        </h1>
      ) : <Skeleton className="h-9 w-2/3" />}

      {/* The long explanation stays folded: the headline and the numbers below carry the page. */}
      {m.example ? (
        <p className={cn('mt-1 h-5 truncate text-sm leading-5 text-muted-foreground transition-opacity duration-150', busy && 'opacity-60')}>
          Showing one example future. The numbers below stay the same: they are not from this future.
        </p>
      ) : !empty && (m.chain || focus) ? (
        <Fold label="How we got this number" className={cn('mt-1 transition-opacity duration-150', busy && 'opacity-60')}>
          {m.chain && <Chain c={m.chain} />}
          {focus && (
            <p>
              {m.staffEffects ? 'Chart counts staff effects' : `Chart: cash saved, middle of ${futuresN} possible futures`}. 8 in 10 end year {horizon} between {strong(chfShort(focus.low[horizon]))} and {strong(chfShort(focus.high[horizon]))}.
            </p>
          )}
        </Fold>
      ) : !empty && !m.futures && <Skeleton className="mt-1 h-5 w-40" />}

      <div className="mt-2 flex h-7 min-w-0 items-center gap-3 overflow-hidden whitespace-nowrap">
        {!empty && m.planWarnings.length > 0 && (
          // The warnings stay one click away: a small count here, the full list below the row.
          <button type="button" aria-expanded={warningsOpen} aria-controls="plan-warnings" onClick={() => setWarningsOpen(o => !o)}
            className="inline-flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-md bg-warning/8 px-2 text-[13px] hover:bg-warning/12 focus-visible:outline-2 focus-visible:outline-ring">
            <TriangleAlert aria-hidden="true" className="size-3.5 text-warning" />
            {m.planWarnings.length} {m.planWarnings.length === 1 ? 'warning' : 'warnings'}
            <ChevronRight aria-hidden="true" className={cn('size-3.5 text-muted-foreground transition-transform duration-150 motion-reduce:transition-none', warningsOpen && 'rotate-90')} />
          </button>
        )}
        <div aria-live="polite" aria-atomic="true" className="flex min-w-0 shrink">
          {m.lastChange && m.delta !== null && (
            <DeltaChip key={`${m.lastChange.label}|${Math.round(m.delta)}`} delta={m.delta} label={m.lastChange.label} />
          )}
        </div>
        {m.whatIf && !lastLabel.includes(whatIfLabels[m.whatIf]) && <Tag>With: {whatIfLabels[m.whatIf].toLowerCase()}</Tag>}
        {m.staffEffects && focus && (
          <Tag>
            <span className={cn(num, 'text-foreground underline decoration-dashed underline-offset-4')}>{chfShort(endValue)}</span> with staff effects (a guess)
          </Tag>
        )}
        {ranking && <span className="ml-auto shrink-0 text-xs text-muted-foreground">{ranking}</span>}
      </div>

      {!empty && warningsOpen && m.planWarnings.length > 0 && (
        <div id="plan-warnings" className="mt-2 flex flex-wrap gap-2">
          {m.planWarnings.map(w => <WarningChip key={w.type} w={w} />)}
        </div>
      )}

      <dl aria-label="Key numbers" className="relative mt-3 grid grid-cols-2 border-y border-[var(--r-divider)] @[30rem]:grid-cols-3 @[36rem]:grid-cols-5">
        {kpis.map((kpi, k) => <Kpi key={k} {...kpi} busy={busy} className={cellClass(k)} />)}
        <div aria-hidden="true" className={cn('pointer-events-none absolute inset-x-0 -bottom-px h-px overflow-hidden transition-opacity duration-150',
          busy ? 'opacity-100' : 'opacity-0')}>
          <div className="results-progress h-full w-2/5 bg-primary" />
        </div>
      </dl>
    </section>
  );
}
