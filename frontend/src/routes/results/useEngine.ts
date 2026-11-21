import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/api/client';
import type {
  Assumption, BreakevenResult, Catalog, FuturesResult, Scenario, SimulateResult,
} from '@/api/types';

export type Load<T> = { data: T | null; error: string | null; loading: boolean };

/** Runs an engine call whenever its key changes; keeps the last good result while the next one loads. */
function useCall<T>(key: string | null, call: () => Promise<T>, delayMs = 0): Load<T> {
  const [state, setState] = useState<Load<T>>({ data: null, error: null, loading: key !== null });
  const callRef = useRef(call);
  callRef.current = call;

  useEffect(() => {
    if (key === null) return;
    let live = true;
    setState(previous => ({ ...previous, loading: true }));
    const timer = setTimeout(() => {
      callRef.current()
        .then(data => { if (live) setState({ data, error: null, loading: false }); })
        .catch((error: unknown) => {
          if (live) setState(previous => ({ ...previous, error: String(error), loading: false }));
        });
    }, delayMs);
    return () => { live = false; clearTimeout(timer); };
  }, [key, delayMs]);

  return state;
}

export const WHAT_IFS = ['energy_price_spike', 'heatwave_summer', 'new_lab'] as const;
export type WhatIf = (typeof WHAT_IFS)[number];

/** Everything the Results page reads from the engine for one configuration. */
/**
 * `overrides` drive the fast runs and update while the slider moves.
 * `settled` are the overrides after the slider is released; the slow runs wait for them.
 */
export function useEngine(scenario: Scenario, overrides: Record<string, number>, settled: Record<string, number>, whatIfs: WhatIf[]) {
  const base = useMemo(() => JSON.stringify({ scenario, overrides }), [scenario, overrides]);
  const settledBase = useMemo(() => JSON.stringify({ scenario, settled }), [scenario, settled]);
  // Break-even solves for the electricity price, so the chosen price does not matter to it.
  const withoutPrice = useMemo(() => {
    const { electricity_price_chf_kwh: _price, ...rest } = settled;
    return rest;
  }, [settled]);

  const catalog = useCall<Catalog>('catalog', () => api.catalog());
  const assumptions = useCall<Assumption[]>('assumptions', () => api.assumptions());

  // The plan as chosen, plus one run per what-if that is switched on. Each run takes about 13 ms.
  const runs = useCall<Record<string, SimulateResult>>(`${base}|${whatIfs.join(',')}`, async () => {
    const ids = ['plan', ...whatIfs];
    const results = await Promise.all(ids.map(id => api.simulate({
      scenario, overrides, events: id === 'plan' ? [] : [id],
    })));
    return Object.fromEntries(ids.map((id, index) => [id, results[index]]));
  }, 80);

  const breakeven = useCall<BreakevenResult>(JSON.stringify({ scenario, withoutPrice }), () => api.breakeven({ scenario, overrides: withoutPrice }));
  // The futures run takes about 4.5 s, so it waits until the slider is released.
  const futures = useCall<FuturesResult>(settledBase, () => api.futures({ scenarios: { plan: scenario }, n: 200, seed: 2026, overrides: settled }), 300);

  return { catalog, assumptions, runs, breakeven, futures };
}
