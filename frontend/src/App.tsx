import { useEffect, useState } from 'react';
import BuildingScene from './components/BuildingScene';
import DebugPanel from './components/DebugPanel';
import { api } from './api/client';
import type { Catalog, Scenario } from './api/types';

export default function App() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  // The current plan: a list of swaps, and which events are switched on.
  const [scenario] = useState<Scenario>([]);
  const [events] = useState<string[]>([]);

  useEffect(() => {
    api.catalog().then(setCatalog).catch(e => setCatalogError(String(e)));
  }, []);

  return (
    <>
      <BuildingScene />
      <DebugPanel catalog={catalog} catalogError={catalogError} scenario={scenario} events={events} />
    </>
  );
}
