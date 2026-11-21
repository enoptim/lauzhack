// Developer-only overlay: the raw /api/simulate result for the current scenario.
// Toggle with the ` key, or open the app with ?debug in the URL.
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { Catalog, Scenario, SimulateResult } from '../api/types';

interface Props {
  catalog: Catalog | null;
  catalogError: string | null;
  scenario: Scenario;
  events: string[];
}

export default function DebugPanel({ catalog, catalogError, scenario, events }: Props) {
  const [open, setOpen] = useState(() => new URLSearchParams(window.location.search).has('debug'));
  const [result, setResult] = useState<SimulateResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === '`') setOpen(o => !o); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!open) return;
    let stale = false;
    setError(null);
    api.simulate({ scenario, events })
      .then(r => { if (!stale) setResult(r); })
      .catch(e => { if (!stale) setError(String(e)); });
    return () => { stale = true; };
  }, [open, scenario, events]);

  if (!open) return null;
  return (
    <div className="debug-panel">
      <strong>Engine debug</strong> <small>(press ` to close)</small>
      <p>
        Catalog: {catalogError ? `error: ${catalogError}` : catalog
          ? `${catalog.rooms.length} rooms, ${catalog.items.length} items, ${Object.keys(catalog.groups).length} groups, ${catalog.events.length} events`
          : 'loading…'}
      </p>
      <p>Scenario: <code>{JSON.stringify(scenario)}</code> Events: <code>{JSON.stringify(events)}</code></p>
      {error && <p className="debug-error">{error}</p>}
      {!result && !error && <p>Simulating…</p>}
      {result && (Object.keys(result) as (keyof SimulateResult)[]).map(key => (
        <details key={key} open={key === 'finance'}>
          <summary>{key}</summary>
          <pre>{JSON.stringify(result[key], null, 2)}</pre>
        </details>
      ))}
    </div>
  );
}
