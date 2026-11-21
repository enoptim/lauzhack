/// <reference types="vite/client" />
// Typed client for the engine API (model/server.py).
// In development Vite proxies /api to http://localhost:8000 (see vite.config.ts).
// Set VITE_API_URL to call a different host.
import type {
  BandsResult, Catalog, FuturesRequest, FuturesResult, PreviewRequest, PreviewResult,
  RunRequest, SimulateResult, StressTestResult, TornadoResult,
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

export const api = {
  catalog: () => request<Catalog>('/api/catalog'),
  simulate: (body: RunRequest = {}) => request<SimulateResult>('/api/simulate', body),
  preview: (body: PreviewRequest) => request<PreviewResult>('/api/preview', body),
  stressTest: (body: RunRequest = {}) => request<StressTestResult>('/api/stress_test', body),
  tornado: (body: RunRequest = {}) => request<TornadoResult>('/api/tornado', body),
  bands: (body: RunRequest = {}) => request<BandsResult>('/api/bands', body),
  futures: (body: FuturesRequest) => request<FuturesResult>('/api/futures', body),
};
