// Play mode's state: one game from the API (model/session.py), shared by the 3D view and the play panel.
import { useEffect, useState } from 'react';
import { api } from '@/api/client';
import type { Catalog, PauseReason, PlaySwap, Scenario, SessionState } from '@/api/types';

export const DEMO_FUTURE = 'ventilation_failure';
const STORAGE_KEY = 'play-session-id';

/** Each stop so far: when, and what happened. Kept here because the API only sends the current stop. */
export type Stop = { t: number; reasons: Pick<PauseReason, 'type' | 'title'>[] };
type Memory = { stops: Stop[]; planId: number | null; planName: string | null };
const memoryKey = (id: string) => `play-memory:${id}`;

function readMemory(id: string): Memory {
  try {
    const saved = JSON.parse(sessionStorage.getItem(memoryKey(id)) ?? 'null');
    if (saved && Array.isArray(saved.stops)) return saved;
  } catch { /* no storage */ }
  return { stops: [], planId: null, planName: null };
}

function writeMemory(id: string, memory: Memory) {
  try { sessionStorage.setItem(memoryKey(id), JSON.stringify(memory)); } catch { /* no storage */ }
}

/** A plan's changes as play decisions: undated ones happen today. */
function toPlay(scenario: Scenario): PlaySwap[] {
  return scenario.map(({ timing: _timing, year, ...swap }) => ({ ...swap, year: year ?? 'now' }));
}

export type PlayBusy = null | 'start' | 'next' | 'change';

function remember(id: string | null) {
  try {
    if (id) sessionStorage.setItem(STORAGE_KEY, id);
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage can be unavailable (private mode); the game still works, it just won't survive a reload.
  }
}

function errorText(error: unknown): string {
  const text = String(error);
  if (text.includes(' 404 ')) return 'This game is gone: the simulation was restarted. Start a new one.';
  return /"detail":"((?:[^"\\]|\\.)*)"/.exec(text)?.[1] ?? 'The simulation is not answering. Start it with make dev.';
}

/** The game, loaded the first time play mode opens. A game in progress survives a page reload. */
export function usePlay(active: boolean) {
  const [state, setState] = useState<SessionState | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [busy, setBusy] = useState<PlayBusy>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [memory, setMemory] = useState<Memory>({ stops: [], planId: null, planName: null });

  function rememberStops(next: SessionState, base?: Memory) {
    const old = base ?? (memory && state?.session_id === next.session_id ? memory : readMemory(next.session_id));
    const stops = next.reasons.length && !old.stops.some(stop => stop.t === next.t)
      ? [...old.stops, { t: next.t, reasons: next.reasons.map(({ type, title }) => ({ type, title })) }]
      : old.stops;
    const updated = { ...old, stops };
    setMemory(updated);
    writeMemory(next.session_id, updated);
  }

  useEffect(() => {
    if (!active || loaded) return;
    setLoaded(true);
    api.catalog().then(setCatalog).catch(() => undefined);
    let saved: string | null = null;
    try { saved = sessionStorage.getItem(STORAGE_KEY); } catch { /* no storage */ }
    if (saved) api.session(saved).then(next => { setState(next); rememberStops(next, readMemory(next.session_id)); }).catch(() => remember(null));
  }, [active, loaded]);

  async function run(kind: Exclude<PlayBusy, null>, call: () => Promise<SessionState>) {
    setBusy(kind);
    setError(null);
    try {
      const next = await call();
      setState(next);
      remember(next.session_id);
      rememberStops(next, kind === 'start' ? { stops: [], planId: null, planName: null } : undefined);
    } catch (e) {
      setError(errorText(e));
      if (String(e).includes(' 404 ')) { setState(null); remember(null); }
    } finally {
      setBusy(null);
    }
  }

  const id = state?.session_id ?? '';
  return {
    state, catalog, busy, error,
    stops: memory.stops,
    /** The plan this path is kept as, once kept. */
    planId: memory.planId,
    planName: memory.planName,
    linkPlan: (planId: number | null, planName: string | null) => {
      if (!state) return;
      const updated = { ...memory, planId, planName };
      setMemory(updated);
      writeMemory(state.session_id, updated);
    },
    /** Starts a new future; with a plan, its changes are already decided (they can still change at each stop). */
    start: (future: string | { seed: number }, years?: number, scenario?: Scenario) => run('start', async () => {
      const started = await api.sessionStart(future, years);
      const fits = (scenario ?? []).filter(swap => (swap.year ?? 0) < started.horizon);
      return fits.length ? api.sessionPlan(started.session_id, toPlay(fits)) : started;
    }),
    next: () => run('next', () => api.sessionNext(id)),
    decide: (swaps: PlaySwap[]) => run('change', () => api.sessionDecide(id, swaps)),
    removePlanned: (index: number) => run('change', () =>
      api.sessionPlan(id, (state?.plan.planned ?? []).filter((_, k) => k !== index))),
    restart: () => { setState(null); remember(null); setError(null); setMemory({ stops: [], planId: null, planName: null }); },
  };
}

export type Play = ReturnType<typeof usePlay>;

/** Equipment drawn in the 3D view. */
const IN_SCENE = new Set(['lighting', 'monitors', 'computers', 'coffee', 'water_heater', 'servers', 'ventilation', 'blinds', 'solar_pv']);

/** Which 3D view shows a group: a floor, the basement (-1), or the whole building (null: roof and facade).
 *  undefined when the group isn't drawn in 3D (e.g. heating and cooling). */
export function sceneView(group: string, floors: number[]): number | null | undefined {
  if (!IN_SCENE.has(group)) return undefined;
  if (group === 'water_heater' || group === 'servers') return -1;
  if (group === 'ventilation' || group === 'blinds' || group === 'solar_pv') return null;
  return floors[0] ?? null;
}

/** What broke at this pause, with the 3D view each shows in. */
export function brokenNow(state: SessionState | null): { group: string; view: number | null }[] {
  if (!state || state.ended) return [];
  const out: { group: string; view: number | null }[] = [];
  for (const reason of state.reasons) {
    if (reason.type !== 'failure' || !reason.group) continue;
    for (const floor of reason.floors.length ? reason.floors : [undefined]) {
      const view = sceneView(reason.group, floor === undefined ? [] : [floor]);
      if (view !== undefined && !out.some(b => b.group === reason.group && b.view === view)) out.push({ group: reason.group, view });
    }
  }
  return out;
}
