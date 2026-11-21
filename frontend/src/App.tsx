import { lazy, Suspense } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router';
import AppHeader from './components/AppHeader';
import AssistantPage from './routes/assistant/AssistantPage';
import NotFoundPage from './routes/not-found/NotFoundPage';
import PlayPage from './routes/play/PlayPage';
import ResultsPage from './routes/results/ResultsPage';

const BuildingPage = lazy(() => import('./routes/building/BuildingPage'));

const pages = [
  { path: '/', label: 'Building', Page: BuildingPage },
  { path: '/assistant', label: 'Assistant', Page: AssistantPage },
  { path: '/results', label: 'Results', Page: ResultsPage },
  { path: '/play', label: 'Play', Page: PlayPage },
];

export default function App() {
  return (
    <BrowserRouter>
      <div className="flex h-dvh flex-col">
        <AppHeader pages={pages} />
        <div className="min-h-0 flex-1 overflow-auto">
          <Suspense fallback={<p role="status" className="p-6">Loading the building…</p>}>
            <Routes>
              {pages.map(({ path, Page }) => <Route key={path} path={path} element={<Page />} />)}
              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </Suspense>
        </div>
      </div>
    </BrowserRouter>
  );
}
