// The assistant, docked beside whatever view is open. It reads what is on screen (the focus),
// and the plans it finds become plans you can edit in 3D and compare in Results.
import { ArrowUp, ListPlus, LocateFixed, PanelLeftClose, SquarePen, Trash2, Undo2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { Button } from '@/components/ui/button';
import {
  MessageScroller, MessageScrollerButton, MessageScrollerContent, MessageScrollerItem, MessageScrollerProvider, MessageScrollerViewport,
} from '@/components/ui/message-scroller';
import { cn } from '@/lib/utils';
import ErrorBoundary from '../ErrorBoundary';
import { planColor, resultsHref, sameScenario } from '../plans';
import { useTwin } from '../TwinProvider';
import { planName, PlanCard, ProposalCard, type ProposalState } from './cards';
import Markdown from './Markdown';
import Steps, { Waiting } from './Steps';
import TradeoffChart from './TradeoffChart';
import { turnPlans, type Turn } from './conversation';
import type { ChatScenario } from '@/api/types';

const starters = [
  'Cut our electricity use by 10% as cheaply as possible.',
  'Lowest running costs for at most CHF 200,000, but don’t touch the ventilation.',
  'Which single upgrades pay back fastest?',
];

export default function AssistantColumn() {
  const twin = useTwin();
  const { turns, pending, send, assistantOpen, setAssistantOpen, focus, plans } = twin;
  const [draft, setDraft] = useState('');
  const input = useRef<HTMLTextAreaElement>(null);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const narrow = () => !window.matchMedia('(min-width: 80rem)').matches;

  // Only the keyboard shortcuts move focus into the composer: a click elsewhere keeps the user where they were.
  // The column is inert until it opens, so focus waits a frame for it to render.
  const focusComposer = () => requestAnimationFrame(() => input.current?.focus({ preventScroll: true }));
  /** Close, and give focus back to the button that opens the column (the column turns inert). */
  const close = () => {
    setAssistantOpen(false);
    document.getElementById('ask-button')?.focus({ preventScroll: true });
  };

  // "/" opens the assistant from anywhere; Ctrl/⌘ K toggles it.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target?.closest('input, textarea, select, [contenteditable="true"]');
      if (event.key === 'Escape' && !event.isComposing && assistantOpen && target?.closest('#assistant')) {
        event.preventDefault();
        close();
      } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setAssistantOpen(!assistantOpen);
        if (!assistantOpen) focusComposer();
      } else if (event.key === '/' && !typing && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        setAssistantOpen(true);
        focusComposer();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [assistantOpen, setAssistantOpen]);

  function submit(text: string) {
    if (!text.trim() || pending) return;
    setDraft('');
    void send(text);
  }

  const latestProposalId = [...turns].reverse().find(turn => turn.proposal)?.id ?? null;
  function proposalState(turn: Turn): ProposalState {
    if (turn.ran) return pending === 'optimizing' && turn.id === latestProposalId ? 'running' : 'ran';
    return turn.id === latestProposalId ? 'open' : 'replaced';
  }

  /** The reply's main plan (its last) is tied to the turn; the others in a set of several are found by their swaps. */
  const isMain = (turn: Turn, scenario: ChatScenario) => !!turn.scenario && sameScenario(scenario.scenario, turn.scenario.scenario);
  function keep(turn: Turn, scenario: ChatScenario) {
    const main = isMain(turn, scenario);
    return twin.keepPlan(main ? turn.id : `${turn.id}:${scenario.title}`, scenario, planName(scenario, main ? turn.optimization : null));
  }
  function keptPlan(turn: Turn, scenario: ChatScenario) {
    return isMain(turn, scenario) ? plans.find(p => p.id === turn.planId)
      : plans.find(p => sameScenario(p.scenario, scenario.scenario));
  }
  /** Adds every plan of a reply to the plan list at once; the last one ends up on the building. */
  function keepAll(turn: Turn) {
    if (turnPlans(turn).some(scenario => keep(turn, scenario).id === null)) setFull(turn.id);
  }

  const [full, setFull] = useState<string | null>(null);

  function showOnBuilding(turn: Turn, scenario: ChatScenario) {
    if (keep(turn, scenario).id === null) { setFull(turn.id); return; }
    if (pathname !== '/') navigate('/');
    if (narrow()) setAssistantOpen(false);
  }

  function compare(turn: Turn, scenario: ChatScenario) {
    const { id, plans: next } = keep(turn, scenario);
    if (id === null) { setFull(turn.id); return; }
    navigate(resultsHref(next, id, scenario.events ?? []), { state: { intro: true } });
    if (narrow()) setAssistantOpen(false);
  }

  const suggestions = [...(focus?.suggestions ?? []), ...starters].slice(0, 4);

  return (
    <>
      {/* Below desktop width the column floats over the view; this dims what is behind it. */}
      <div aria-hidden="true" onClick={() => setAssistantOpen(false)}
        className={cn('fixed inset-0 top-14 z-30 bg-foreground/10 transition-opacity duration-200 xl:hidden',
          assistantOpen ? 'opacity-100' : 'pointer-events-none opacity-0')} />
      <aside id="assistant" aria-label="Assistant" inert={!assistantOpen}
        className={cn('twin-column z-40 flex h-full shrink-0 flex-col overflow-hidden border-r bg-sidebar',
          'max-xl:fixed max-xl:top-14 max-xl:bottom-0 max-xl:left-0 max-xl:h-auto max-xl:shadow-xl',
          assistantOpen ? 'w-[min(25rem,100vw)] xl:w-[clamp(21rem,27vw,25rem)]' : 'w-0 border-r-0')}>
        <div className="flex h-full w-[min(25rem,100vw)] flex-col xl:w-[clamp(21rem,27vw,25rem)]">
          <header className="flex h-12 shrink-0 items-center gap-2.5 border-b px-4">
            <h2 className="flex-1 text-sm font-semibold">Ask the building</h2>
            <Button variant="ghost" size="icon-sm" aria-label="New conversation" title="New conversation"
              disabled={pending !== null || turns.length === 0} onClick={twin.newChat}>
              <SquarePen />
            </Button>
            <Button variant="ghost" size="icon-sm" aria-label="Close the assistant" title="Close (Esc)" onClick={close}>
              <PanelLeftClose />
            </Button>
          </header>

          <MessageScrollerProvider autoScroll>
            <MessageScroller className="min-h-0 flex-1">
              <MessageScrollerViewport>
                <MessageScrollerContent className="gap-5 px-4 py-5">
                  {turns.length === 0 && (
                    <MessageScrollerItem messageId="intro">
                      <div className="flex flex-col gap-4">
                        <p className="text-sm text-pretty text-muted-foreground">
                          Say what you want and what can’t change: a budget, a target, equipment to keep.
                          I set it up for you to check, the building model does every calculation, and the plan I find
                          shows up on the building and in Results.
                        </p>
                        <ul className="flex flex-col gap-1.5">
                          {suggestions.map(text => (
                            <li key={text}>
                              <button type="button" onClick={() => submit(text)}
                                className="w-full rounded-lg border bg-card px-3 py-2 text-left text-sm text-pretty transition-colors hover:border-primary/40 hover:bg-primary/5 focus-visible:outline-2 focus-visible:outline-ring">
                                {text}
                              </button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </MessageScrollerItem>
                  )}

                  {turns.map(turn => (
                    <MessageScrollerItem key={turn.id} messageId={turn.id} scrollAnchor={turn.role === 'user'}>
                      <ErrorBoundary what="message" fallback={() => <p className="text-xs text-muted-foreground">This message could not be shown.</p>}>
                      {turn.role === 'user' ? (
                        <div className="flex flex-col items-end gap-1 pl-8">
                          {turn.where && (
                            <span className="flex items-center gap-1 text-xs text-muted-foreground">
                              <LocateFixed aria-hidden="true" className="size-3" />{turn.where}
                            </span>
                          )}
                          <p className="rounded-2xl rounded-br-md bg-secondary px-3.5 py-2 text-sm text-pretty">{turn.content}</p>
                        </div>
                      ) : (
                        <div className="flex flex-col gap-3" aria-busy={turn.streaming || undefined}>
                          {turn.steps && <Steps steps={turn.steps} live={!!turn.streaming} />}
                          {turn.streaming && !turn.content && (() => {
                            // Nothing new is arriving yet: the model is reading, or reading a job's result.
                            const last = turn.steps?.at(-1);
                            if (last?.kind === 'thinking' || (last?.kind === 'job' && last.status === 'running')) return null;
                            return <Waiting text={last ? 'Reading the result…' : pending === 'optimizing' ? 'Starting the optimizer…' : 'Reading your question…'} />;
                          })()}
                          {(turn.content || !turn.streaming) && (
                            <div className={cn('text-sm leading-relaxed text-pretty', turn.failed && 'rounded-lg bg-warning/8 px-3 py-2 text-foreground')}>
                              <Markdown text={turn.content} caret={turn.streaming} />
                            </div>
                          )}
                          {turn.removedPlans && turn.removedPlans.length > 0 && (
                            <div role="status" className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-xs">
                              <Trash2 aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
                              <span className="min-w-0 flex-1 text-pretty">
                                {turn.restored ? 'Put back: ' : 'Removed from your plans: '}
                                <span className="font-medium">{turn.removedPlans.map(plan => plan.name).join(', ')}</span>
                              </span>
                              {!turn.restored && (
                                <Button variant="ghost" size="xs" onClick={() => twin.undoRemoval(turn.id)}>
                                  <Undo2 data-icon="inline-start" />Undo
                                </Button>
                              )}
                            </div>
                          )}
                          {turn.proposal && (
                            <ProposalCard proposal={turn.proposal} state={proposalState(turn)} catalog={twin.catalog}
                              onRun={() => void send('Looks good. Run the optimization.', { turnId: turn.id, problem: turn.proposal!.problem })} />
                          )}
                          {turn.chart && <TradeoffChart chart={turn.chart} />}
                          {full === turn.id && (
                            <p role="status" className="rounded-lg bg-secondary px-3 py-2 text-xs text-pretty">
                              There are already six plans you made or changed. Remove one in the plan list, then try again.
                            </p>
                          )}
                          {(() => {
                            const cards = turnPlans(turn);
                            const waiting = cards.filter(scenario => !keptPlan(turn, scenario)).length;
                            return (
                              <>
                                {cards.length > 1 && (
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="text-xs text-muted-foreground">{cards.length} plans</span>
                                    {waiting > 0 ? (
                                      <Button variant="outline" size="sm" onClick={() => keepAll(turn)}>
                                        <ListPlus />Add all {cards.length} to my plans
                                      </Button>
                                    ) : <span className="text-xs text-muted-foreground">All in your plans</span>}
                                  </div>
                                )}
                                {cards.map(scenario => {
                                  const plan = keptPlan(turn, scenario);
                                  return (
                                    <PlanCard key={scenario.title + JSON.stringify(scenario.scenario)} scenario={scenario} catalog={twin.catalog}
                                      optimization={isMain(turn, scenario) ? turn.optimization : null}
                                      kept={plan ? { name: plan.name, color: planColor(plans, plan.id) } : null}
                                      shown={pathname === '/' && plan?.id === twin.activePlan.id ? 'building'
                                        : pathname.startsWith('/results') && focus?.plan && sameScenario(focus.plan.scenario, scenario.scenario) ? 'results' : null}
                                      onShow={() => showOnBuilding(turn, scenario)} onCompare={() => compare(turn, scenario)} />
                                  );
                                })}
                              </>
                            );
                          })()}
                        </div>
                      )}
                      </ErrorBoundary>
                    </MessageScrollerItem>
                  ))}

                </MessageScrollerContent>
              </MessageScrollerViewport>
              <MessageScrollerButton />
            </MessageScroller>
          </MessageScrollerProvider>

          <form className="shrink-0 px-3 pt-1 pb-3" onSubmit={event => { event.preventDefault(); submit(draft); }}>
            <div className="flex flex-col rounded-xl border bg-card shadow-[0_1px_2px_oklch(0_0_0/0.04)] transition-[border-color,box-shadow] duration-200 focus-within:border-foreground/25 focus-within:shadow-[0_1px_2px_oklch(0_0_0/0.04),0_6px_16px_-10px_oklch(0.3_0.02_60/0.3)]">
              {focus && (
                <span className="flex items-center gap-1.5 px-3 pt-2.5 text-xs text-muted-foreground" title="The assistant sees what you are looking at">
                  <LocateFixed aria-hidden="true" className="size-3" />
                  <span className="truncate">{focus.label}</span>
                </span>
              )}
              <textarea ref={input} value={draft} rows={2} aria-label="Message the assistant"
                placeholder={focus?.suggestions[0] ? `e.g. ${focus.suggestions[0]}` : 'e.g. Best plan for CHF 300,000, keep the coffee machines'}
                onChange={event => setDraft(event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    submit(draft);
                  }
                }}
                className="field-sizing-content max-h-40 min-h-14 resize-none bg-transparent px-3 pt-2 pb-1 text-sm outline-none placeholder:text-muted-foreground" />
              <div className="flex items-center justify-between gap-2 px-2 pb-2">
                <span className="pl-1 text-xs text-muted-foreground">The building model does every calculation.</span>
                <Button type="submit" size="icon-sm" aria-label="Send" disabled={pending !== null || !draft.trim()} className="rounded-lg">
                  <ArrowUp />
                </Button>
              </div>
            </div>
          </form>
        </div>
      </aside>
    </>
  );
}
