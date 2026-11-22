// One workspace: the building and the results are two views of the same twin,
// the pulse shows what the plan on screen does, and the assistant docks beside both.
import { Box, ChartSpline, MessageSquare } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { cn } from '@/lib/utils';
import AssistantColumn from './assistant/AssistantColumn';
import Mark from './Mark';
import { resultsHref } from './plans';
import PulseBar from './Pulse';
import { useTwin } from './TwinProvider';

function ViewTab({ active, onClick, icon: Icon, children }: {
  active: boolean; onClick: () => void; icon: typeof Box; children: ReactNode;
}) {
  return (
    <button type="button" onClick={onClick} aria-current={active ? 'page' : undefined}
      className={cn('flex h-8 items-center gap-2 rounded-md px-3 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-ring',
        active ? 'bg-secondary text-foreground shadow-[inset_0_0_0_1px_var(--border)]' : 'text-muted-foreground hover:bg-secondary/70 hover:text-foreground')}>
      <Icon aria-hidden="true" className="size-4 max-sm:hidden" />
      {children}
    </button>
  );
}

export default function AppShell({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { plans, activePlan, assistantOpen, setAssistantOpen, pending, unread } = useTwin();
  const onResults = pathname.startsWith('/results');

  return (
    <div className="flex h-dvh flex-col">
      <header className="relative z-50 flex h-14 shrink-0 items-center gap-3 border-b bg-background px-3 sm:gap-5 sm:px-4">
        <Link to="/" className="flex shrink-0 items-center gap-2.5 rounded-md pr-1 focus-visible:outline-2 focus-visible:outline-ring">
          <Mark busy={pending !== null} />
          <span className="flex flex-col leading-tight max-sm:sr-only">
            <span className="text-sm font-semibold tracking-tight">Building twin</span>
            <span className="text-xs text-muted-foreground max-sm:hidden">EPFL building BC, Lausanne</span>
          </span>
        </Link>

        <nav aria-label="Views" className="flex items-center gap-1">
          <ViewTab active={pathname === '/'} icon={Box} onClick={() => navigate('/')}>Building</ViewTab>
          <ViewTab active={onResults} icon={ChartSpline} onClick={() => { if (!onResults) navigate(resultsHref(plans, activePlan.id)); }}>
            Results
          </ViewTab>
        </nav>

        <span aria-hidden="true" className="h-5 w-px bg-border max-sm:hidden" />
        <button type="button" onClick={() => setAssistantOpen(!assistantOpen)} aria-expanded={assistantOpen} aria-controls="assistant"
          className={cn('flex h-9 shrink-0 items-center gap-2.5 rounded-lg border px-3 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-ring',
            assistantOpen ? 'border-primary/40 bg-primary/8 text-foreground' : 'bg-card hover:border-primary/40 hover:bg-primary/5')}>
          <MessageSquare aria-hidden="true" className="size-4 text-muted-foreground" />
          <span className="max-sm:hidden">Ask the building</span>
          <span className="sm:hidden">Ask</span>
          {unread && <span className="size-2 rounded-full bg-primary"><span className="sr-only">, new answer</span></span>}
          <kbd className="grid h-5 min-w-5 place-items-center rounded border bg-background px-1 font-mono text-[11px] text-muted-foreground max-sm:hidden">/</kbd>
        </button>

        <div className="min-w-0 flex-1" />
        <PulseBar className="max-md:hidden" />

      </header>

      <div className="flex min-h-0 flex-1">
        <AssistantColumn />
        <div className="relative min-h-0 min-w-0 flex-1 overflow-auto">{children}</div>
      </div>
    </div>
  );
}
