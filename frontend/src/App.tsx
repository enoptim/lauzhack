import { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router';
import NotFoundPage from './routes/not-found/NotFoundPage';
import ResultsPage from './routes/results/ResultsPage';
import AppShell from './twin/AppShell';
import ErrorBoundary from './twin/ErrorBoundary';
import { TwinProvider, useTwin } from './twin/TwinProvider';

const BuildingPage = lazy(() => import('./routes/building/BuildingPage'));

/** The assistant used to be a page. Old links open it beside the building instead. */
function OpenAssistant() {
  const { setAssistantOpen } = useTwin();
  useEffect(() => setAssistantOpen(true), [setAssistantOpen]);
  return <Navigate to="/" replace />;
}

/** Results reads its plans once from the address; a new address (e.g. a plan sent by the assistant) starts it afresh. */
function ResultsRoute() {
  const { search } = useLocation();
  return <ErrorBoundary what="results view" resetKey={search}><ResultsPage key={search} /></ErrorBoundary>;
}

export default function App() {
  return (
    <BrowserRouter>
      <TwinProvider>
        <AppShell>
          <Suspense fallback={<p role="status" className="p-6 text-sm text-muted-foreground">Loading the building…</p>}>
            <Routes>
              <Route path="/" element={<ErrorBoundary what="3D building"><BuildingPage /></ErrorBoundary>} />
              <Route path="/explore" element={<ErrorBoundary what="3D building"><BuildingPage mode="play" /></ErrorBoundary>} />
              <Route path="/play" element={<Navigate to="/explore" replace />} />
              <Route path="/results" element={<ResultsRoute />} />
              <Route path="/assistant" element={<OpenAssistant />} />
              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </Suspense>
        </AppShell>
      </TwinProvider>
    </BrowserRouter>
  );
}
