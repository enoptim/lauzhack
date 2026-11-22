import { TriangleAlert } from 'lucide-react';
import { useEffect } from 'react';
import { Link } from 'react-router';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import ChartPanel from './ChartPanel';
import DetailPanels from './DetailPanels';
import Inspector from './Inspector';
import Overview from './Overview';
import PlanRail from './PlanRail';
import SimulationIntro from './SimulationIntro';
import { groupLabels } from './labels';
import { optionName, useResultsModel } from './useResultsModel';
import './results.css';

/**
 * The Results page: one instrument in three columns.
 * - Left, the plans: which one is in focus, what it changes, what it costs.
 * - Middle, the outcome: the verdict, the key numbers, the chart of 200 futures, then where the money comes from and how sure we are.
 * - Right, the assumptions: everything the viewer can move. Every change reruns the futures and shows what moved.
 */
export default function ResultsPage() {
  const m = useResultsModel();

  // Keyboard: Space plays or pauses, 1–6 focus a plan. Not while typing or using a control that needs the key.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (m.intro || event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
      if (target?.closest('input, textarea, select, [contenteditable], #assistant')) return;
      if (event.key === ' ') {
        // Space on a focused control presses that control instead.
        if (target?.closest('button, a, [role=slider], [role=radio], [role=switch]')) return;
        if (m.futures) { event.preventDefault(); m.play(); }
        return;
      }
      const k = Number(event.key);
      if (Number.isInteger(k) && k >= 1 && k <= m.plans.length) m.selectPlan(k - 1);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (m.read === null) {
    return (
      <main className="mx-auto flex max-w-3xl flex-col gap-4 px-6 py-12">
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertTitle>The configuration in the page address is broken.</AlertTitle>
          <AlertDescription>Go back to the building and click Simulate again.</AlertDescription>
        </Alert>
        <Link to="/" className="text-sm underline underline-offset-4">Back to the building</Link>
      </main>
    );
  }

  if (m.engine.runs.error && !m.plan) {
    // The catalog loaded, so the engine runs: it refused this plan (e.g. unknown equipment). Otherwise it is not reachable.
    const refused = Boolean(m.catalog);
    return (
      <main className="mx-auto flex max-w-3xl flex-col gap-4 px-6 py-12">
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertTitle>{refused ? 'The simulation cannot run this plan.' : 'The simulation is not answering.'}</AlertTitle>
          <AlertDescription>
            <p>{refused ? 'The plan names equipment the building does not know. Go back to the building and pick it again.'
              : <>Start it with <code className="font-mono">make dev</code>, then reload this page.</>}</p>
          </AlertDescription>
        </Alert>
        <Link to="/" className="text-sm underline underline-offset-4">Back to the building</Link>
      </main>
    );
  }

  return (
    // The columns follow the width this view gets, not the window: the assistant can take a column on the left.
    // Wide: plans | outcome | assumptions. Medium: outcome | plans above assumptions. Narrow: one column.
    <div className="results-root @container/results h-full">
      {m.intro && (
        <SimulationIntro ready={Boolean(m.plan && (m.futures || m.outdated || m.engine.futures.error) && m.catalog)} onDone={m.endIntro}
          changes={m.chosen.map(swap => `${groupLabels[swap.group] ?? swap.group} → ${optionName(m.catalog, swap.group, swap.option) ?? swap.option}`)} />
      )}
      <div className="grid min-h-full @min-[56rem]/results:h-full @min-[56rem]/results:grid-cols-[minmax(0,1fr)_19rem]
        @min-[76rem]/results:grid-cols-[15rem_minmax(0,1fr)_19rem] @min-[88rem]/results:grid-cols-[16.5rem_minmax(0,1fr)_20rem]">
        <main className="min-w-0 overflow-x-clip @min-[56rem]/results:min-h-0 @min-[56rem]/results:overflow-y-auto @min-[76rem]/results:col-start-2 @min-[76rem]/results:row-start-1">
          <Overview m={m} />
          <ChartPanel m={m} />
          <DetailPanels m={m} />
        </main>
        <div className="flex min-w-0 flex-col overflow-x-clip bg-[var(--r-panel)] @min-[56rem]/results:min-h-0 @min-[56rem]/results:overflow-y-auto @min-[56rem]/results:border-l @min-[56rem]/results:border-[var(--r-line)]
          @min-[76rem]/results:contents">
          <aside aria-label="Plans" className="min-w-0 overflow-x-clip border-y border-[var(--r-line)] bg-[var(--r-panel)] @min-[56rem]/results:border-t-0
            @min-[76rem]/results:col-start-1 @min-[76rem]/results:row-start-1 @min-[76rem]/results:min-h-0 @min-[76rem]/results:overflow-y-auto @min-[76rem]/results:border-r @min-[76rem]/results:border-b-0">
            <PlanRail m={m} />
          </aside>
          <aside aria-label="Assumptions" className="min-w-0 overflow-x-clip bg-[var(--r-panel)]
            @min-[76rem]/results:col-start-3 @min-[76rem]/results:row-start-1 @min-[76rem]/results:min-h-0 @min-[76rem]/results:overflow-y-auto @min-[76rem]/results:border-l @min-[76rem]/results:border-[var(--r-line)]">
            <Inspector m={m} />
          </aside>
        </div>
      </div>
    </div>
  );
}
