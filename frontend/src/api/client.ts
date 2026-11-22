/// <reference types="vite/client" />
// Typed client for the engine API (model/server.py).
// In development Vite proxies /api to http://localhost:8000 (see vite.config.ts).
// Set VITE_API_URL to call a different host.
import type {
  Assumption, BandsResult, BreakevenRequest, BreakevenResult, Catalog, ChatEvent, ChatRequest, ChatResult,
  Evaluation, FuturesRequest, FuturesResult, Granularity, Metric, OptimizationProblem, OptimizeResult,
  ParetoRequest, ParetoResult, PlaySwap, PreviewRequest, PreviewResult, RunRequest, Scenario, ScriptedFuture,
  SearchOptions, SearchRequest, SearchResult, SessionOutlook, SessionPreview, SessionState, SimulateResult,
  StressTestResult, TornadoResult,
} from './types';

const BASE: string = import.meta.env.VITE_API_URL ?? '';

async function request<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, body === undefined ? undefined : {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

/** How long the stream may stay silent. The server pings every 10 s, so silence this long means it is gone. */
const STREAM_SILENCE_MS = 35_000;

/** Reads /api/chat/stream line by line and hands each event to onEvent. Resolves when the stream ends. */
async function stream(path: string, body: unknown, onEvent: (event: ChatEvent) => void) {
  const abort = new AbortController();
  let timer = setTimeout(() => abort.abort(), STREAM_SILENCE_MS);
  const alive = () => { clearTimeout(timer); timer = setTimeout(() => abort.abort(), STREAM_SILENCE_MS); };
  try {
    const res = await fetch(`${BASE}${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: abort.signal,
    });
    if (!res.ok || !res.body) throw new Error(`${path}: ${res.status} ${await res.text()}`);
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      alive();
      buffer += value;
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) if (line.trim()) onEvent(JSON.parse(line) as ChatEvent);
    }
    if (buffer.trim()) onEvent(JSON.parse(buffer) as ChatEvent);
  } catch (error) {
    if (abort.signal.aborted) throw new Error('The assistant stopped responding. Is the API running? Restart it with make dev.');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export const api = {
  catalog: () => request<Catalog>('/api/catalog'),
  simulate: (body: RunRequest = {}) => request<SimulateResult>('/api/simulate', body),
  preview: (body: PreviewRequest) => request<PreviewResult>('/api/preview', body),
  stressTest: (body: RunRequest = {}) => request<StressTestResult>('/api/stress_test', body),
  tornado: (body: RunRequest = {}) => request<TornadoResult>('/api/tornado', body),
  bands: (body: RunRequest = {}) => request<BandsResult>('/api/bands', body),
  futures: (body: FuturesRequest) => request<FuturesResult>('/api/futures', body),
  assumptions: () => request<Assumption[]>('/api/assumptions'),
  breakeven: (body: BreakevenRequest = {}) => request<BreakevenResult>('/api/breakeven', body),
  metrics: () => request<Metric[]>('/api/metrics'),
  /** Best plan for a goal under limits. About 1 s, or a few seconds with per_floor. */
  optimize: (problem: OptimizationProblem) => request<OptimizeResult>('/api/optimize', { problem }),
  evaluate: (problem: OptimizationProblem, scenario: Scenario) => request<Evaluation>('/api/evaluate', { problem, scenario }),
  /** The search's goal presets (cheapest for a target, most savings for a budget, lowest total cost). 1-3 s. */
  search: (body: SearchRequest) => request<SearchResult>('/api/search', body),
  /** Cost against saving: the packages no other package beats on both. About 4 s, under 1 s once warmed up. */
  pareto: (body: ParetoRequest = {}) => request<ParetoResult>('/api/pareto', body),
  /** Metric names and zones, for building search menus. */
  searchOptions: (granularity: Granularity = 'floor') =>
    request<SearchOptions>(`/api/search/options?granularity=${granularity}`),
  /** The assistant. Takes 10-30 s: it runs the engine several times before answering. */
  chat: (body: ChatRequest) => request<ChatResult>('/api/chat', body),
  /** The assistant, live: its thinking, each job it runs and its reply as they happen, then the same result as chat. */
  chatStream: (body: ChatRequest, onEvent: (event: ChatEvent) => void) => stream('/api/chat/stream', body, onEvent),

  // Play through one future (model/session.py). Sessions live in the API's memory.
  sessionFutures: () => request<ScriptedFuture[]>('/api/session/futures'),
  /** years: how long the game runs (5, 10 or 15). */
  sessionStart: (future: string | { seed: number }, years?: number) =>
    request<SessionState>('/api/session/start', { future, ...(years ? { years } : {}) }),
  session: (sessionId: string) => request<SessionState>(`/api/session/${sessionId}`),
  sessionNext: (sessionId: string) => request<SessionState>('/api/session/next', { session_id: sessionId }),
  /** Add to the plan: changes for now ("now") or later years. */
  sessionDecide: (sessionId: string, swaps: PlaySwap[]) =>
    request<SessionState>('/api/session/decide', { session_id: sessionId, swaps }),
  /** Replace everything not done yet. */
  sessionPlan: (sessionId: string, plan: PlaySwap[]) =>
    request<SessionState>('/api/session/plan', { session_id: sessionId, plan }),
  sessionPreview: (sessionId: string, swap: PlaySwap | PlaySwap[]) =>
    request<SessionPreview>('/api/session/preview', { session_id: sessionId, swap }),
  sessionOutlook: (sessionId: string, n = 100, seed = 2026) =>
    request<SessionOutlook>('/api/session/outlook', { session_id: sessionId, n, seed }),
};
