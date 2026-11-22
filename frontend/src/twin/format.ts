/** CHF 760,500 → "CHF 761k"; keeps the sign with a real minus. Same rule as Results. */
export function chfShort(value: number): string {
  const sign = value < 0 ? '−' : '';
  const abs = Math.abs(value);
  if (abs >= 1e6) return `${sign}CHF ${(abs / 1e6).toFixed(abs >= 1e7 ? 0 : 2)}M`;
  if (abs >= 1e3) return `${sign}CHF ${Math.round(abs / 1e3)}k`;
  return `${sign}CHF ${Math.round(abs)}`;
}

export const whole = (value: number) => Math.round(value).toLocaleString('en-US');

/** Change from today in whole percent, or null when there is no today to compare with. */
export function changePct(today: number | null | undefined, now: number | null | undefined) {
  if (today == null || now == null || today === 0) return null;
  return Math.round(((now - today) / Math.abs(today)) * 100);
}
