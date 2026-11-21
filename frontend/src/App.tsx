import { lazy, Suspense } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router';
import AssistantPage from './routes/assistant/AssistantPage';
import NotFoundPage from './routes/not-found/NotFoundPage';
import ResultsPage from './routes/results/ResultsPage';

const BuildingPage = lazy(() => import('./routes/building/BuildingPage'));

export default function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<p role="status" className="p-6">Loading the building…</p>}>
        <Routes>
          <Route path="/" element={<BuildingPage />} />
          <Route path="/assistant" element={<AssistantPage />} />
          <Route path="/results" element={<ResultsPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
