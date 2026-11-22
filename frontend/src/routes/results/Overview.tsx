import type { ReactNode } from 'react';
import { TrendingDown, TrendingUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import AnimatedNumber from './AnimatedNumber';
import { chf, chfShort } from './format';
import { whatIfLabels } from './labels';
import { num, Skeleton } from './parts';
import type { ResultsModel } from './useResultsModel';

/**
 * The top of the middle column: the main sentence of the page, how much the last change moved it,
 * and five key numbers. Every line keeps its height, so the chart below never jumps.
 */

/** The range where 8 in 10 futures pay back, short: "7.4–10.7", or "7.4 to over 15". The unit is in the value above. */
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
    verdict = cash >= 0
      ? <>{subject} saves {money(cash, 'plan', 'Saved means: doing nothing would have cost this much more.')} over {horizon} years</>
      : <>{subject} is {money(cash, 'warning', 'It has not paid for itself yet in the middle future.')} short after {horizon} years</>;
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
  // The 8-in-10 payback range, only when it means something: a plan bought later can "pay back" in year 0.0.
  const rangeShown = m.goodPayback !== null && m.goodPayback > 0.05 && (m.badPayback === null || m.badPayback > 0.05);

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
      sub: empty ? 'about the same' : saving !== null ? (Math.abs(saving) < 500 ? 'about the same' : saving > 0 ? 'lower than today' : 'higher than today') : pendingSub,
      title: 'What the building pays to run in year 1, compared with today.',
    },
    {
      label: 'Pays for itself in',
      value: empty ? '—' : !focus ? pending : m.payback === null ? <span className="text-[17px]">Over {horizon} years</span>
        : m.payback === 0 ? 'Right away' : <AnimatedNumber value={m.payback} format={yearsShort} />,
      sub: empty ? 'nothing to pay back' : !focus ? pendingSub
        : rangeShown ? `8 in 10: ${paybackRange(m.goodPayback as number, m.badPayback, horizon)}`
          : m.paidBackShare !== null ? `${Math.round(m.paidBackShare * 10)} in 10 pay back` : 'not in most futures',
      subTitle: [
        rangeShown && `In 8 of 10 futures it pays for itself in ${paybackRange(m.goodPayback as number, m.badPayback, horizon)} years.`,
        m.paidBackShare !== null && `It has paid for itself by year ${horizon} in ${Math.round(m.paidBackShare * 10)} of 10 futures.`,
      ].filter(Boolean).join(' ') || undefined,
      title: 'When the money saved catches up with the money spent, in the middle future.',
    },
    {
      label: 'Energy use, year 1',
      value: after ? <AnimatedNumber value={after.kwh_year} format={mwh} /> : pending,
      sub: today ? (energyChange !== null && Math.abs(energyChange) >= 0.5 ? `${percent(energyChange)} vs today` : 'same as today') : pendingSub,
      subTitle: today ? `today ${mwh(today.kwh_year)}` : undefined,
    },
    {
      label: 'Meeting room CO₂',
      value: after ? <AnimatedNumber value={after.outcomes.meeting_co2_ppm} format={ppm} /> : pending,
      sub: today && after ? co2Note(after.outcomes.meeting_co2_ppm, Math.round(today.outcomes.meeting_co2_ppm)) : pendingSub,
      title: 'CO₂ shows how fresh the air is. Below 1000 ppm is good.',
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

      <p className={cn('mt-1 h-5 truncate text-sm leading-5 text-muted-foreground transition-opacity duration-150', busy && 'opacity-60')}>
        {m.example ? 'Showing one example future. The numbers below are the middle of all 200.'
          : focus && !empty ? <>{m.staffEffects ? 'Counting staff effects' : `The middle of ${futuresN} possible futures`}. In 8 of 10, it lands between {strong(chfShort(focus.low[horizon]))} and {strong(chfShort(focus.high[horizon]))}.</>
            : null}
      </p>

      <div className="mt-2 flex h-7 min-w-0 items-center gap-3 overflow-hidden whitespace-nowrap">
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
