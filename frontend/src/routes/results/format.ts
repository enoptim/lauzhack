// Thousands with a comma, like every other amount in the app (de-CH would print 198’670).
const CHF = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

/** CHF 760,500 → "CHF 761k"; keeps the sign with a real minus. */
export function chfShort(value: number): string {
  const sign = value < 0 ? '−' : '';
  const abs = Math.abs(value);
  if (abs >= 1e6) return `${sign}CHF ${(abs / 1e6).toFixed(abs >= 1e7 ? 0 : 2)}M`;
  if (abs >= 1e3) return `${sign}CHF ${Math.round(abs / 1e3)}k`;
  return `${sign}CHF ${Math.round(abs)}`;
}

export function chf(value: number): string {
  return `${value < 0 ? '−' : ''}CHF ${CHF.format(Math.abs(value))}`;
}

export function kwh(value: number): string {
  if (value >= 1e6) return `${(value / 1e6).toFixed(2)} GWh`;
  return `${Math.round(value / 1e3)} MWh`;
}

export function years(value: number | null): string {
  if (value === null) return 'never';
  return `${value.toFixed(1)} years`;
}

export function pricePerKwh(value: number): string {
  return `CHF ${value.toFixed(2)} / kWh`;
}

/** A share of futures in plain words: "no future", "3 in 10 futures", "every future". */
export function chances(share: number, n: number): string {
  const k = Math.round(share * n);
  if (k === 0) return 'no future';
  if (k === n) return 'every future';
  const tenths = Math.round(share * 10);
  if (tenths === 0) return 'fewer than 1 in 10 futures';
  if (tenths === 10) return 'more than 9 in 10 futures';
  return `${tenths} in 10 futures`;
}
