import { useEffect, useRef, useState } from 'react';
import { api } from '@/api/client';
import type { Scenario, SimulateResult } from '@/api/types';

export type Vitals = { bill: number; co2: number; kwh: number };

export type Pulse = {
  today: Vitals | null;
  plan: Vitals | null;
  /** True while the engine works on a change. The last answer stays on screen meanwhile. */
  loading: boolean;
  /** True when the engine does not answer. */
  offline: boolean;
};

const vitals = (snapshot: SimulateResult['snapshot']): Vitals => ({
  bill: snapshot.building.costs_chf.energy,
  co2: snapshot.building.outcomes.meeting_co2_ppm,
  kwh: snapshot.building.kwh_year,
});

/** The building's year-1 vital signs, today and with the plan. One engine run (about 13 ms) per change. */
export function usePulse(scenario: Scenario): Pulse {
  const [pulse, setPulse] = useState<Pulse>({ today: null, plan: null, loading: true, offline: false });
  const key = JSON.stringify(scenario);
  const scenarioRef = useRef(scenario);
  scenarioRef.current = scenario;

  useEffect(() => {
    let live = true;
    setPulse(previous => ({ ...previous, loading: true }));
    const timer = setTimeout(() => {
      api.simulate({ scenario: scenarioRef.current })
        .then(result => {
          if (live) setPulse({ today: vitals(result.snapshot_baseline), plan: vitals(result.snapshot), loading: false, offline: false });
        })
        .catch(() => { if (live) setPulse(previous => ({ ...previous, loading: false, offline: true })); });
    }, 60);
    return () => { live = false; clearTimeout(timer); };
  }, [key]);

  return pulse;
}

/** Eases a number to its new value, so a change reads as movement. Jumps straight there with reduced motion. */
export function useTween(target: number | null, ms = 650): number | null {
  const [shown, setShown] = useState(target);
  const from = useRef(target);
  const frame = useRef(0);

  useEffect(() => {
    if (target === null) { setShown(null); from.current = null; return; }
    const start = from.current;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (start === null || reduced || start === target) { setShown(target); from.current = target; return; }
    const began = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - began) / ms);
      const eased = t === 1 ? 1 : 1 - 2 ** (-10 * t); // exponential ease-out
      const value = start + (target - start) * eased;
      from.current = value;
      setShown(value);
      if (t < 1) frame.current = requestAnimationFrame(step);
    };
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame.current);
  }, [target, ms]);

  return shown;
}
