import type { Flag } from '@/api/types';
import { chfShort } from '@/twin/format';
import type { WhatIf } from './useEngine';

export const whatIfLabels: Record<WhatIf, string> = {
  energy_price_spike: 'Energy crisis',
  heatwave_summer: 'Heatwave summer',
  new_lab: '60 more staff',
};

/** One plain sentence per what-if: what happens, and when. Mirrors data/events.csv. */
export const whatIfDetails: Record<WhatIf, string> = {
  energy_price_spike: 'In year 3, electricity costs 80% more for a whole year, like in 2022.',
  heatwave_summer: 'In year 6, a summer like 2003: the building needs 50% more cooling from June to August.',
  new_lab: 'From year 4, a new lab moves in with 60 people for good: more fresh air, power and coffee needed.',
};

/** Fixed colour per line: the plan is always chart-1, each what-if keeps its own colour. */
export const seriesColor: Record<'plan' | WhatIf, string> = {
  plan: 'var(--chart-1)',
  energy_price_spike: 'var(--chart-2)',
  heatwave_summer: 'var(--chart-3)',
  new_lab: 'var(--chart-4)',
};

export const groupLabels: Record<string, string> = {
  monitors: 'Monitors',
  computers: 'Computers',
  lighting: 'Lighting',
  blinds: 'Blinds',
  ventilation: 'Ventilation',
  heating_cooling: 'Heating and cooling',
  servers: 'Servers',
  printers_3d: '3D printers',
  coffee: 'Coffee machines',
  water_heater: 'Water heaters',
  solar_pv: 'Solar panels',
  lauzhack_banner: 'LauzHack banner',
};

/** Where the money comes from. Items marked `guess` rest on people effects and are not cash. */
export const breakdownLabels: Record<string, { label: string; guess: boolean }> = {
  capex_and_residual: { label: 'Purchase (net of resale)', guess: false },
  energy: { label: 'Energy saved', guess: false },
  pv_export: { label: 'Solar sold to the grid', guess: false },
  maintenance: { label: 'Upkeep', guess: false },
  consumables: { label: 'Supplies', guess: false },
  rent: { label: 'Space freed up', guess: true },
  productivity: { label: 'Better work', guess: true },
  sick_days: { label: 'Fewer sick days', guess: true },
  time_saved: { label: 'Time saved', guess: true },
};

export function flagText(flag: Flag): string {
  switch (flag.type) {
    case 'reserve_below_minimum': return flag.year === 0
      ? 'Paying for it today takes the building’s reserve fund below its safety minimum.'
      : 'The building’s reserve fund drops below its safety minimum.';
    case 'needs_financing': {
      const short = typeof flag.shortfall === 'number' ? ` It is ${chfShort(flag.shortfall)} short.` : '';
      const also = typeof flag.year_without_upgrades === 'number' ? ` Doing nothing runs it out too, in year ${flag.year_without_upgrades}.` : '';
      return `The reserve fund runs out, so this plan needs a loan or other outside money.${short}${also}`;
    }
    case 'reserve_below_minimum_without_upgrades': return 'Even without this upgrade, normal replacements take the reserve fund below its safety minimum.';
    case 'over_budget': {
      // The budget covers the extra cost over replacing worn-out units like for like, not the full price.
      const extra = typeof flag.extra_cost === 'number' ? `${chfShort(flag.extra_cost)} more` : 'More';
      const budget = typeof flag.budget === 'number' ? ` of ${chfShort(flag.budget)}` : '';
      return `${extra} than replacing worn-out units like for like. That is over the upgrade budget${budget}.`;
    }
    case 'desk_shortfall': return 'There are more staff than desks.';
    case 'ventilation_over_capacity': return 'A floor has more people than its air supply can handle.';
    default: return flag.type.replaceAll('_', ' ');
  }
}

/** Context flags explain the situation; they are not a warning about the plan. */
export const isContextFlag = (flag: Flag) => flag.type === 'reserve_below_minimum_without_upgrades';
