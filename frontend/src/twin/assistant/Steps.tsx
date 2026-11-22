// What the assistant does on the way to its reply, shown live: its thinking, and each job it runs in the building model.
// Thinking is quiet grey text. A job is a framed row with a spinning cog and a timer, so waiting on the model is
// never mistaken for waiting on the engine. Once the reply is in, the steps fold into one line you can open.
import { Brain, Check, ChevronRight, Cog, TriangleAlert } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import type { Step } from './conversation';

/** What each job does, in words: [while it runs, once it is done]. */
const jobText: Record<string, [string, string]> = {
  get_building_overview: ['Reading the building as it is today', 'Read the building as it is today'],
  list_options: ['Looking up the products on offer', 'Looked up the products on offer'],
  rank_upgrades: ['Ranking single upgrades by payback', 'Ranked single upgrades by payback'],
  simulate_scenario: ['Simulating the change in the building model', 'Simulated the change'],
  show_scenario: ['Simulating the plan to show it', 'Simulated the plan'],
  list_metrics: ['Listing the goals and limits I can use', 'Listed the goals and limits'],
  propose_problem: ['Setting up the optimization for you to check', 'Set up the optimization'],
  optimize: ['Running the optimizer: testing plans', 'Ran the optimizer'],
  remove_plans: ['Removing plans', 'Removed plans'],
  upgrade_tradeoffs: ['Comparing packages: cost against saving', 'Compared packages by cost and saving'],
};

function jobLabel(step: Extract<Step, { kind: 'job' }>) {
  const [running, done] = jobText[step.name] ?? [`Running ${step.name}`, `Ran ${step.name}`];
  const group = typeof step.args.group === 'string' ? step.args.group.replaceAll('_', ' ') : null;
  const what = group && step.name === 'list_options' ? ` for ${group}` : '';
  return (step.status === 'running' ? running : done) + what;
}

/** Seconds since `since`, ticking while `active`. */
function useElapsed(since: number, active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [active]);
  return Math.max(0, Math.floor((now - since) / 1000));
}

function seconds(n: number) {
  return n < 10 ? `${n.toFixed(n < 1 ? 1 : 0)} s` : `${Math.round(n)} s`;
}

function Thinking({ step, live }: { step: Extract<Step, { kind: 'thinking' }>; live: boolean }) {
  const active = live && step.seconds === undefined;
  const elapsed = useElapsed(step.startedAt, active);
  const box = useRef<HTMLDivElement>(null);
  // While it thinks, keep the newest words in view.
  useLayoutEffect(() => {
    if (active && box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [active, step.text]);
  return (
    <li className="flex flex-col gap-1">
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Brain aria-hidden="true" className={cn('size-3.5', active && 'animate-pulse text-primary')} />
        {active ? <span className="twin-shimmer">Thinking… {elapsed > 0 && `${elapsed} s`}</span> : `Thought for ${step.seconds ?? 1} s`}
      </span>
      <div ref={box}
        className={cn('ml-[7px] border-l-2 pl-3 text-xs leading-relaxed whitespace-pre-wrap text-muted-foreground',
          active && 'max-h-36 overflow-y-auto scrollbar-thin')}>
        {step.text.trim()}
      </div>
    </li>
  );
}

function Job({ step }: { step: Extract<Step, { kind: 'job' }> }) {
  const running = step.status === 'running';
  const elapsed = useElapsed(step.startedAt, running);
  const Icon = running ? Cog : step.status === 'done' ? Check : TriangleAlert;
  return (
    <li role={running ? 'status' : undefined}
      className={cn('flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs transition-colors',
        running ? 'border-primary/30 bg-primary/6 text-foreground' : 'border-transparent bg-secondary/60 text-muted-foreground',
        step.status === 'failed' && 'bg-warning/8')}>
      <Icon aria-hidden="true" className={cn('size-3.5 shrink-0', running && 'animate-spin text-primary [animation-duration:2s]',
        step.status === 'done' && 'text-primary', step.status === 'failed' && 'text-warning')} />
      <span className={cn('min-w-0 flex-1 text-pretty', running && 'font-medium')}>
        {jobLabel(step)}{step.status === 'failed' && ' (failed)'}
      </span>
      {running && <span className="shrink-0 rounded bg-primary/12 px-1.5 py-px text-[10px] font-medium tracking-wide text-primary uppercase">Building model</span>}
      <span className="shrink-0 tabular-nums">{running ? `${elapsed} s` : step.seconds !== undefined && seconds(step.seconds)}</span>
    </li>
  );
}

function List({ steps, live }: { steps: Step[]; live: boolean }) {
  return (
    <ol className="flex flex-col gap-2">
      {steps.map((step, i) => step.kind === 'thinking' ? <Thinking key={i} step={step} live={live} />
        : step.kind === 'job' ? <Job key={step.id || i} step={step} />
          : <li key={i} className="text-xs text-pretty text-muted-foreground">{step.text}</li>)}
    </ol>
  );
}

/** A line saying the model is at work while nothing has arrived yet (before its first words, or after a job). */
export function Waiting({ text }: { text: string }) {
  return (
    <p role="status" className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <Brain aria-hidden="true" className="size-3.5 animate-pulse text-primary" />
      <span className="twin-shimmer">{text}</span>
    </p>
  );
}

export default function Steps({ steps, live }: { steps: Step[]; live: boolean }) {
  const [open, setOpen] = useState(false);
  if (!steps.length) return null;
  if (live) return <List steps={steps} live />;

  const thought = steps.reduce((sum, step) => sum + (step.kind === 'thinking' ? step.seconds ?? 0 : 0), 0);
  const jobs = steps.filter(step => step.kind === 'job').length;
  const summary = [thought > 0 && `Thought for ${thought} s`, jobs > 0 && `ran ${jobs} job${jobs > 1 ? 's' : ''} in the building model`]
    .filter(Boolean).join(', ');
  return (
    <div className="flex flex-col gap-2">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}
        className="flex w-fit items-center gap-1 rounded text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">
        <ChevronRight aria-hidden="true" className={cn('size-3.5 transition-transform duration-150', open && 'rotate-90')} />
        {summary.charAt(0).toUpperCase() + summary.slice(1) || 'Steps'}
      </button>
      {open && <List steps={steps} live={false} />}
    </div>
  );
}
