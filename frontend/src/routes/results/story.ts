import type { FutureSample } from '@/api/types';
import { chfShort } from './format';
import { groupLabels } from './labels';

/** One thing that happens in a year of the future being played. */
export type Beat = { year: number; text: string; short: string; tone: 'plan' | 'fail' | 'world' };

/** "Old blinds break", "Old ventilation breaks": the verb follows the name. */
const breaks = (name: string) => (name.endsWith('s') ? 'break' : 'breaks');

/** At most this many events per future, so the chart stays readable. */
export const MAX_ROWS = 6;

const WORLD: Record<string, { text: string; short: string }> = {
  energy_price_spike: { text: 'Energy crisis: electricity prices jump for a year', short: 'Energy crisis' },
  heatwave_summer: { text: 'A heatwave summer: much more cooling', short: 'Heatwave' },
  new_lab: { text: 'A new lab moves in: 60 more staff', short: '60 more staff' },
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
    beats.push({ year: o.boughtIn, tone: 'plan', rank: 0, short: 'You buy', text: `You buy ${o.subject} for ${chfShort(o.purchase)}` });
  }
  for (const f of failures) {
    const label = groupLabels[f.group] ?? f.group;
    const name = label.toLowerCase();
    const verb = breaks(name);
    const before = typeof o.timing === 'number' && f.year < o.timing;
    const text = o.timing === 'end_of_life' ? `Old ${name} ${verb === 'break' ? 'wear' : 'wears'} out. You buy the upgrade instead`
      : before ? `Old ${name} ${verb} early: ${chfShort(f.cost)} to replace`
      : `Old ${name} ${verb}. Without the upgrade: ${chfShort(f.cost)} emergency repair`;
    beats.push({ year: f.year, tone: 'fail', rank: 1 + 1 / (1 + f.cost), short: `${label} ${verb}`, text });
  }
  const seen = new Set<string>(); // a what-if event comes on top of the random ones: tell it once
  for (const e of sample.events) {
    const key = `${e.id}-${e.start_year}`;
    if (e.start_year > o.horizon || !WORLD[e.id] || seen.has(key)) continue;
    seen.add(key);
    beats.push({ year: e.start_year, tone: 'world', rank: 2, ...WORLD[e.id] });
  }
  // Keep the purchase, then the most expensive breakdowns, then the world; then tell them in year order.
  const kept = beats.sort((a, b) => a.rank - b.rank).slice(0, MAX_ROWS)
    .sort((a, b) => a.year - b.year || a.rank - b.rank);
  return kept;
}
