// Words and number formats for the play page. Every number shown comes from the API; this file only formats it.
import type { Catalog, FinanceYear, PlaySwap, SessionSwap } from '@/api/types';

const NUMBER = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

/** Money gained vs doing nothing so far, without the value of equipment still standing at the end: the same
 *  way Results counts it, so the game's last number matches the line Results draws for the future you played. */
export function gained(row: FinanceYear): number {
  return row.cumulative_cash_cf - (row.residual_value ?? 0);
}

/** CHF rounded to the hundred, with a real minus sign. */
export function chf(value: number): string {
  return `${value < 0 ? '−' : ''}CHF ${NUMBER.format(Math.abs(Math.round(value / 100) * 100))}`;
}

/** Like chf, but always with a sign: "+CHF 12,300" or "−CHF 4,500". */
export function signedChf(value: number): string {
  const rounded = Math.round(value / 100) * 100;
  return `${rounded > 0 ? '+' : rounded < 0 ? '−' : ''}CHF ${NUMBER.format(Math.abs(rounded))}`;
}

/** CHF 760,500 → "CHF 761k", for chart axes. */
export function chfShort(value: number): string {
  const sign = value < 0 ? '−' : '';
  const abs = Math.abs(value);
  if (abs >= 1e6) return `${sign}CHF ${(abs / 1e6).toFixed(abs >= 1e7 ? 0 : 1)}M`;
  if (abs >= 1e3) return `${sign}CHF ${Math.round(abs / 1e3)}k`;
  return `${sign}CHF ${Math.round(abs)}`;
}

export function mwh(kwh: number): string {
  return `${NUMBER.format(Math.round(kwh / 1000))} MWh`;
}

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
  water_heater: 'Water heater',
  solar_pv: 'Solar panels',
};

export function floorLabel(floor: number): string {
  return floor === -1 ? 'basement' : floor === 0 ? 'ground floor' : floor === 5 ? 'roof' : `floor ${floor}`;
}

/** The moment a change happens. Time t is the end of year t. */
export function whenLabel(year: number, now: number): string {
  if (year === now) return 'now';
  return year === 0 ? 'today' : `end of year ${year}`;
}

export function optionName(catalog: Catalog | null, group: string, optionId: string): string {
  return catalog?.groups[group]?.find(option => option.option_id === optionId)?.name ?? optionId;
}

/** Where a change applies, in plain words. */
export function whereLabel(catalog: Catalog | null, swap: PlaySwap | SessionSwap): string {
  if (swap.floor !== undefined) return floorLabel(swap.floor);
  if (swap.item_id) {
    const item = catalog?.items.find(i => i.item_id === swap.item_id);
    return item ? floorLabel(item.serves_floor) : 'one unit';
  }
  return 'whole building';
}
