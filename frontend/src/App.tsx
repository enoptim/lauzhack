import { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import NotFoundPage from './routes/not-found/NotFoundPage';
import ResultsPage from './routes/results/ResultsPage';
import AppShell from './twin/AppShell';
import { TwinProvider, useTwin } from './twin/TwinProvider';

const BuildingPage = lazy(() => import('./routes/building/BuildingPage'));

/** The assistant used to be a page. Old links open it beside the building instead. */
function OpenAssistant() {
  const { setAssistantOpen } = useTwin();
  useEffect(() => setAssistantOpen(true), [setAssistantOpen]);
  return <Navigate to="/" replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <TwinProvider>
        <AppShell>
          <Suspense fallback={<p role="status" className="p-6 text-sm text-muted-foreground">Loading the building…</p>}>
            <Routes>
              <Route path="/" element={<BuildingPage />} />
              <Route path="/results" element={<ResultsPage />} />
              <Route path="/assistant" element={<OpenAssistant />} />
              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </Suspense>
        </AppShell>
      </TwinProvider>
    </BrowserRouter>
  );
}
