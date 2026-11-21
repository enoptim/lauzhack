import type { FutureSample } from '@/api/types';
import { cn } from '@/lib/utils';
import { chfShort } from './format';
import { groupLabels } from './labels';

/** One thing that happens in a year of the future being played. */
export type Beat = { year: number; text: string; tone: 'plan' | 'fail' | 'world' };

/** At most this many rows, so the strip has a fixed height. */
export const MAX_ROWS = 6;

const WORLD: Record<string, string> = {
  energy_price_spike: 'Electricity prices jump for a year',
  heatwave_summer: 'A heatwave summer: much more cooling',
  new_lab: 'A new lab moves in with 60 people',
};

type Options = {
  /** Year the plan's equipment is bought (0 = today), or null if not known. */
  boughtIn: number | null;
  purchase: number;
  timing: 'now' | 'end_of_life' | number;
  horizon: number;
  /** The plan in words, e.g. "the upgrade" or "Configuration 2". */
  subject: string;
};

/**
 * What happens, year by year, in one example future: the purchase, breakdowns of the old equipment
 * this plan replaces, and shocks from the world. Every number is already on the page or in the future itself.
 */
export function storyBeats(sample: FutureSample, failures: FutureSample['failures'], o: Options): Beat[] {
  const beats: (Beat & { rank: number })[] = [];
  if (o.boughtIn !== null && o.timing !== 'end_of_life' && o.purchase > 0) {
    beats.push({ year: o.boughtIn, tone: 'plan', rank: 0, text: `You buy ${o.subject} for ${chfShort(o.purchase)}` });
  }
  for (const f of failures) {
    const name = (groupLabels[f.group] ?? f.group).toLowerCase();
    const before = typeof o.timing === 'number' && f.year < o.timing;
    const text = o.timing === 'end_of_life' ? `Old ${name} wears out. You buy the upgrade instead`
      : before ? `Old ${name} breaks early: ${chfShort(f.cost)} to replace it`
      : `Old ${name} breaks. Without the upgrade: ${chfShort(f.cost)} emergency repair`;
    beats.push({ year: f.year, tone: 'fail', rank: 1 + 1 / (1 + f.cost), text });
  }
  const seen = new Set<string>(); // a what-if event comes on top of the random ones: tell it once
  for (const e of sample.events) {
    const key = `${e.id}-${e.start_year}`;
    if (e.start_year > o.horizon || !WORLD[e.id] || seen.has(key)) continue;
    seen.add(key);
    beats.push({ year: e.start_year, tone: 'world', rank: 2, text: WORLD[e.id] });
  }
  // Keep the purchase, then the most expensive breakdowns, then the world; then tell them in year order.
  const kept = beats.sort((a, b) => a.rank - b.rank).slice(0, MAX_ROWS)
    .sort((a, b) => a.year - b.year || a.rank - b.rank);
  if (!kept.some(b => b.tone !== 'plan')) kept.push({ year: o.horizon, tone: 'world', rank: 3, text: 'A quiet future: no breakdowns, no shocks' });
  return kept;
}

type Row = { year: number; tone: Beat['tone']; text: string };

/** Same-year beats become one row; the strongest tone colours it. */
function rows(beats: Beat[]): Row[] {
  const out: Row[] = [];
  for (const beat of beats) {
    const last = out[out.length - 1];
    if (last && last.year === beat.year) {
      last.text = `${last.text} · ${beat.text}`;
      if (beat.tone === 'fail' || last.tone === 'world') last.tone = beat.tone;
    } else out.push({ ...beat });
  }
  return out.slice(0, MAX_ROWS);
}

type Props = {
  beats: Beat[];
  /** The year the chart has reached while playing; null when not playing (then every row shows). */
  playYear: number | null;
  planColor: string;
  /** No future is shown yet: show a hint instead of rows. */
  empty: boolean;
};

/** A fixed-height strip under the chart: what happens in the future being played, appearing year by year. */
export default function PlayStory({ beats, playYear, planColor, empty }: Props) {
  const list = rows(beats);
  const newest = [...list].reverse().find(row => playYear !== null && row.year <= playYear);
  return (
    <div className="h-[7.5rem] overflow-hidden">
      {empty ? (
        <p className="pt-2 text-sm text-muted-foreground">Press Play to watch one typical future unfold, year by year.</p>
      ) : (
        <ol className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {list.map(row => {
            const shown = playYear === null || row.year <= playYear;
            const current = playYear !== null && newest === row;
            return (
              <li key={`${row.year}-${row.text}`} data-beat-year={row.year} data-shown={shown}
                className={cn('flex min-h-[3.25rem] items-start gap-2.5 overflow-hidden rounded-lg bg-muted/50 px-3 py-2 text-sm ease-out motion-safe:transition-[opacity,translate,box-shadow] motion-safe:duration-300',
                  !shown && 'translate-y-1 opacity-0', current && 'ring-1 ring-primary/40')}>
                <span aria-hidden="true" className="mt-0.5 h-9 w-[3px] shrink-0 rounded-full"
                  style={{ background: row.tone === 'plan' ? planColor : row.tone === 'fail' ? 'var(--warning)' : 'var(--muted-foreground)' }} />
                <span className="line-clamp-2">
                  <b className="font-semibold tabular-nums">{row.year === 0 ? 'Today' : `Year ${row.year}`}</b>{' '}{row.text}
                </span>
              </li>
            );
          })}
        </ol>
      )}
      <span className="sr-only" aria-live="polite">{newest ? `${newest.year === 0 ? 'Today' : `Year ${newest.year}`}: ${newest.text}` : ''}</span>
    </div>
  );
}
