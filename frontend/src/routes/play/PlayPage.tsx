// Play through one future: the plan runs until something happens, then the player can change what hasn't
// happened yet. The game lives in the API (model/session.py); this page only shows its state and sends choices.
import { ArrowRight, Dices, Play, RotateCcw, TriangleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '@/api/client';
import type { Catalog, PlaySwap, ScriptedFuture, SessionState } from '@/api/types';
import { Alert, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';
import { chf, mwh, signedChf } from './format';
import PlanPanel from './PlanPanel';
import PlayChart from './PlayChart';
import WhatHappened from './WhatHappened';

const DEMO = 'ventilation_failure';
const STORAGE_KEY = 'play-session-id';

type Busy = null | 'start' | 'next' | 'change';

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

/** Years as small blocks: played (filled), now (ring) and still to come (empty). */
function YearBar({ t, horizon }: { t: number; horizon: number }) {
  return (
    <ol className="flex gap-1" aria-label={`Year ${t} of ${horizon}`}>
      {Array.from({ length: horizon }, (_, k) => k + 1).map(year => (
        <li key={year} title={`Year ${year}`}
          className={cn('h-2 flex-1 rounded-full', year <= t ? 'bg-primary' : 'bg-muted', year === t && 'ring-2 ring-primary/30')} />
      ))}
    </ol>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-xl border bg-card p-4">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-xl font-semibold tabular-nums">{value}</span>
      <span className="text-xs text-muted-foreground">{note}</span>
    </div>
  );
}

function Stats({ state }: { state: SessionState }) {
  const row = state.history.at(-1);
  if (!row) {
    return (
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Money vs doing nothing" value="—" note="Appears once the first year has run" />
        <Stat label="Electricity" value="—" note="Per year, once it has run" />
        <Stat label="Building reserve" value="—" note="Money left for the building" />
      </div>
    );
  }
  const change = row.kwh_baseline ? (row.kwh / row.kwh_baseline - 1) * 100 : 0;
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <Stat label="Money vs doing nothing" value={signedChf(row.cumulative_cash_cf)} note="So far, purchases included" />
      <Stat label={`Electricity in year ${row.year}`} value={mwh(row.kwh)}
        note={Math.abs(change) < 0.5 ? 'Same as doing nothing' : `${change < 0 ? '' : '+'}${change.toFixed(0)}% vs doing nothing`} />
      <Stat label="Building reserve" value={chf(row.cash_closing)} note={`Doing nothing: ${chf(row.cash_closing_baseline)}`} />
    </div>
  );
}

function Start({ futures, busy, onStart }: { futures: ScriptedFuture[]; busy: Busy; onStart: (future: string | { seed: number }) => void }) {
  const demo = futures.find(f => f.name === DEMO);
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-10">
      <Card>
        <CardHeader>
          <CardTitle><h1 className="text-xl">Play the next 15 years</h1></CardTitle>
          <CardDescription>
            Your plan runs year by year. When something happens, like a breakdown, news or a price shock, the game
            stops and you decide what to do. What has happened can't be undone. At the end you see how your choices
            compare with doing nothing.
          </CardDescription>
        </CardHeader>
        {demo && <CardContent className="text-sm text-muted-foreground">The demo story: {demo.description}</CardContent>}
        <CardFooter className="flex flex-wrap gap-2">
          <Button size="lg" disabled={busy !== null} onClick={() => onStart(DEMO)}>
            {busy === 'start' ? <Spinner data-icon="inline-start" /> : <Play data-icon="inline-start" />}
            Play the demo story
          </Button>
          <Button size="lg" variant="outline" disabled={busy !== null} onClick={() => onStart({ seed: Math.floor(Math.random() * 1e6) })}>
            <Dices data-icon="inline-start" />
            Surprise me
          </Button>
        </CardFooter>
      </Card>
    </main>
  );
}

function End({ state, onRestart }: { state: SessionState; onRestart: () => void }) {
  const r = state.result;
  const last = state.history.at(-1);
  if (!r || !last) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle><h2 className="text-xl">15 years done</h2></CardTitle>
        <CardDescription>Compared with doing nothing in exactly the same 15 years.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-3xl font-semibold tabular-nums">{signedChf(last.cumulative_cash_cf)}</p>
        <p className="text-sm text-muted-foreground">
          What your choices gained over 15 years, after paying for them: the end of the line in the chart.
          In today’s money, with later francs discounted, that is {signedChf(r.npv_cash)}.
        </p>
        <p className="text-sm text-muted-foreground">
          Building reserve at the end: {chf(r.reserve_at_end)} (doing nothing: {chf(r.reserve_at_end_doing_nothing)}).
          {' '}{r.decisions === 0 ? 'You made no changes.' : `You made ${r.decisions} ${r.decisions === 1 ? 'change' : 'changes'}.`}
        </p>
        <p className="text-xs text-muted-foreground">Model estimates from our assumptions.</p>
      </CardContent>
      <CardFooter>
        <Button onClick={onRestart}><RotateCcw data-icon="inline-start" />Play again</Button>
      </CardFooter>
    </Card>
  );
}

export default function PlayPage() {
  const [state, setState] = useState<SessionState | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [futures, setFutures] = useState<ScriptedFuture[]>([]);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.catalog().then(setCatalog).catch(() => undefined);
    api.sessionFutures().then(setFutures).catch(() => undefined);
    let saved: string | null = null;
    try { saved = sessionStorage.getItem(STORAGE_KEY); } catch { /* no storage */ }
    if (saved) api.session(saved).then(setState).catch(() => remember(null));
  }, []);

  async function run(kind: Exclude<Busy, null>, call: () => Promise<SessionState>) {
    setBusy(kind);
    setError(null);
    try {
      const next = await call();
      setState(next);
      remember(next.session_id);
    } catch (e) {
      setError(errorText(e));
      if (String(e).includes(' 404 ')) { setState(null); remember(null); }
    } finally {
      setBusy(null);
    }
  }

  const restart = () => { setState(null); remember(null); setError(null); };

  if (!state) {
    return (
      <>
        {error && <Alert variant="destructive" className="mx-auto mt-6 max-w-2xl"><TriangleAlert /><AlertTitle>{error}</AlertTitle></Alert>}
        <Start futures={futures} busy={busy} onStart={future => run('start', () => api.sessionStart(future))} />
      </>
    );
  }

  const id = state.session_id;
  const decide = (swaps: PlaySwap[]) => run('change', () => api.sessionDecide(id, swaps));
  const remove = (index: number) => run('change', () =>
    api.sessionPlan(id, state.plan.planned.filter((_, k) => k !== index)));

  return (
    <main className="mx-auto grid w-full max-w-6xl gap-6 px-4 py-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <section className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h1 className="text-xl font-semibold">
              {state.ended ? 'The end' : state.t === 0 ? 'Today' : `End of year ${state.t}`}
              {!state.ended && <span className="font-normal text-muted-foreground"> of {state.horizon}</span>}
            </h1>
            <p className="text-sm text-muted-foreground">{state.future === DEMO ? 'The demo story' : 'A surprise future'}</p>
          </div>
          {state.ended ? (
            <Button size="lg" variant="outline" onClick={restart}><RotateCcw data-icon="inline-start" />Play again</Button>
          ) : (
            <Button size="lg" disabled={busy !== null} onClick={() => run('next', () => api.sessionNext(id))}>
              {busy === 'next' ? <Spinner data-icon="inline-start" /> : null}
              {state.t === 0 ? 'Start' : 'Continue'}
              <ArrowRight data-icon="inline-end" />
            </Button>
          )}
        </div>
        <YearBar t={state.t} horizon={state.horizon} />
        {error && <Alert variant="destructive"><TriangleAlert /><AlertTitle>{error}</AlertTitle></Alert>}
        {state.ended && <End state={state} onRestart={restart} />}
        <Stats state={state} />
        <Card className="gap-2">
          <CardHeader>
            <CardTitle>Money compared with doing nothing</CardTitle>
            <CardDescription>Above the line, your choices have paid off so far. Below it, they still have to.</CardDescription>
          </CardHeader>
          <CardContent>
            <PlayChart history={state.history} horizon={state.horizon} now={state.t} ended={state.ended} />
          </CardContent>
        </Card>
        {!state.ended && <WhatHappened state={state} catalog={catalog} busy={busy !== null} onDecide={decide} />}
        {busy === 'change' && <p role="status" className="text-sm text-muted-foreground">Updating your plan…</p>}
      </section>
      <PlanPanel state={state} catalog={catalog} busy={busy !== null}
        onAdd={swap => decide([swap])} onRemove={remove} />
    </main>
  );
}
