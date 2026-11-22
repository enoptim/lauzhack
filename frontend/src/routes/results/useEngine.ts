import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/api/client';
import type {
  Assumption, Catalog, FuturesResult, Scenario, SimulateResult,
} from '@/api/types';

/** `dataKey`: the request the shown data answers, so callers can tell when it belongs to an older request. */
export type Load<T> = { data: T | null; error: string | null; loading: boolean; dataKey?: string | null };

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
        .then(data => { if (live) setState({ data, error: null, loading: false, dataKey: key }); })
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

/** Number of possible futures per run. */
export const FUTURES_N = 200;

/** Futures results by request, kept for the whole visit: going back to a world you saw is instant. */
const futuresCache = new Map<string, Promise<FuturesResult>>();

function futuresRequest(scenarios: Scenario[], whatIf: WhatIf | null, overrides: Record<string, number>) {
  const body = {
    scenarios: Object.fromEntries(scenarios.map((scenario, index) => [`p${index}`, scenario])),
    n: FUTURES_N, seed: 2026, events: whatIf ? [whatIf] : [], overrides,
  };
  return { key: JSON.stringify(body), body };
}

function fetchFutures(scenarios: Scenario[], whatIf: WhatIf | null, overrides: Record<string, number>) {
  const { key, body } = futuresRequest(scenarios, whatIf, overrides);
  let pending = futuresCache.get(key);
  if (!pending) {
    pending = api.futures(body);
    futuresCache.set(key, pending);
    pending.catch(() => futuresCache.delete(key));
  }
  return pending;
}

/**
 * Everything the Results page reads from the engine.
 * - `runs`: fast single runs of the selected plan (about 13 ms), for year-1 numbers, warnings and the price text.
 *   They follow `overrides`, which change while the slider moves.
 * - `futures`: 200 possible futures for every plan at once (1–3 s). They follow `settled`, the slider value after release.
 */
export function useEngine(scenario: Scenario, allScenarios: Scenario[], overrides: Record<string, number>,
  settled: Record<string, number>, whatIf: WhatIf | null) {
  const base = useMemo(() => JSON.stringify({ scenario, overrides }), [scenario, overrides]);

  const catalog = useCall<Catalog>('catalog', () => api.catalog());
  const assumptions = useCall<Assumption[]>('assumptions', () => api.assumptions());

  // The selected plan as chosen, plus the what-if run if one is switched on.
  const runs = useCall<Record<string, SimulateResult>>(`${base}|${whatIf ?? ''}`, async () => {
    const ids = whatIf ? ['plan', whatIf] : ['plan'];
    const results = await Promise.all(ids.map(id => api.simulate({
      scenario, overrides, events: id === 'plan' ? [] : [id],
    })));
    return Object.fromEntries(ids.map((id, index) => [id, results[index]]));
  }, 80);

  const futuresKey = useMemo(() => futuresRequest(allScenarios, whatIf, settled).key, [allScenarios, whatIf, settled]);
  const futures = useCall<FuturesResult>(futuresKey, () => fetchFutures(allScenarios, whatIf, settled), 50);

  // Once the plain world is ready, work out the three what-ifs in the background, one after the other.
  const ready = futures.data !== null && !futures.loading && whatIf === null;
  useEffect(() => {
    if (!ready) return;
    let live = true;
    void (async () => {
      for (const id of WHAT_IFS) {
        if (!live) return;
        await fetchFutures(allScenarios, id, settled).catch(() => undefined);
      }
    })();
    return () => { live = false; };
  }, [ready, futuresKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return { catalog, assumptions, runs, futures };
}
