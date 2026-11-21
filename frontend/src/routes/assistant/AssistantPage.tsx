// The assistant: chat with the building. It talks to POST /api/chat (chat/README.md).
// A reply can carry a plan, which "Show results" opens on /results.
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { ArrowUpIcon, RotateCcwIcon } from 'lucide-react';
import { api } from '@/api/client';
import type { Catalog, ChatOptimization, ChatProposal, ChatScenario, OptimizationProblem, Scenario } from '@/api/types';
import { Bubble, BubbleContent } from '@/components/ui/bubble';
import { Button } from '@/components/ui/button';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from '@/components/ui/input-group';
import { Message, MessageContent } from '@/components/ui/message';
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from '@/components/ui/message-scroller';
import { Spinner } from '@/components/ui/spinner';
import Markdown from './Markdown';
import { PlanCard, ProposalCard, type ProposalState } from './PlanCard';

type Turn = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  scenario?: ChatScenario | null;
  /** An optimization the assistant set up, waiting for the user's OK. */
  proposal?: ChatProposal | null;
  /** Set once the user ran this turn's proposal. */
  ran?: boolean;
  optimization?: ChatOptimization | null;
  failed?: boolean;
};

const suggestions = [
  'Cut our electricity use by 10% as cheaply as possible.',
  'Lowest running costs for at most CHF 200,000, but don’t touch the ventilation.',
  'Which single upgrades pay back fastest?',
];

// The conversation survives a trip to /results and back (this browser tab only).
const storageKey = 'assistant-conversation-v2';

function loadTurns(): Turn[] {
  try {
    const saved = JSON.parse(sessionStorage.getItem(storageKey) ?? '[]') as unknown;
    return Array.isArray(saved) ? saved as Turn[] : [];
  } catch {
    return [];
  }
}

// getRandomValues also works over plain http (e.g. the LAN address), unlike randomUUID.
const newId = () => crypto.getRandomValues(new Uint32Array(2)).join('-');

function errorText(error: unknown) {
  const detail = /"detail":"((?:[^"\\]|\\.)*)"/.exec(String(error))?.[1];
  return detail ?? 'The assistant could not answer. Is the API running? Start it with make dev.';
}

/** The plan the conversation is about: the latest one the assistant showed. */
function latestPlan(turns: Turn[]): Scenario {
  for (let i = turns.length - 1; i >= 0; i--) {
    const plan = turns[i].scenario;
    if (plan) return plan.scenario;
  }
  return [];
}

export default function AssistantPage() {
  const [turns, setTurns] = useState<Turn[]>(loadTurns);
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState<null | 'thinking' | 'optimizing'>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const navigate = useNavigate();
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    api.catalog().then(setCatalog).catch(() => undefined);
    input.current?.focus();
  }, []);

  useEffect(() => {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(turns));
    } catch {
      // Storage can be unavailable (private mode); the chat still works without it.
    }
  }, [turns]);

  /** Send a message. With `confirm`, the server first runs the optimizer on exactly that problem. */
  async function send(text: string, confirm?: { turnId: string; problem: OptimizationProblem }) {
    const content = text.trim();
    if (!content || pending) return;
    const marked = confirm ? turns.map(turn => turn.id === confirm.turnId ? { ...turn, ran: true } : turn) : turns;
    const history: Turn[] = [...marked, { id: newId(), role: 'user', content }];
    setTurns(history);
    setDraft('');
    setPending(confirm ? 'optimizing' : 'thinking');
    try {
      const reply = await api.chat({
        messages: history.filter(turn => !turn.failed).map(({ role, content }) => ({ role, content })),
        scenario: latestPlan(turns),
        confirm: confirm?.problem,
      });
      setTurns(previous => [...previous, {
        id: newId(), role: 'assistant', content: reply.reply,
        scenario: reply.scenario, proposal: reply.proposal, optimization: reply.optimization,
      }]);
    } catch (error) {
      setTurns(previous => [
        ...previous.map(turn => turn.id === confirm?.turnId ? { ...turn, ran: false } : turn),
        { id: newId(), role: 'assistant', content: errorText(error), failed: true },
      ]);
    } finally {
      setPending(null);
    }
  }

  const latestProposalId = [...turns].reverse().find(turn => turn.proposal)?.id ?? null;

  function proposalState(turn: Turn): ProposalState {
    if (turn.ran) return pending === 'optimizing' && turn.id === latestProposalId ? 'running' : 'ran';
    return turn.id === latestProposalId ? 'open' : 'replaced';
  }

  function showPlan(plan: ChatScenario) {
    navigate(`/results?config=${encodeURIComponent(JSON.stringify({ scenario: plan.scenario, events: plan.events }))}`);
  }

  return (
    <main className="mx-auto flex h-full w-full max-w-2xl flex-col">
      <div className="flex items-center gap-2 px-4 pt-4 pb-2">
        <h1 className="flex-1 text-lg font-semibold">Ask the building</h1>
        <Button variant="ghost" size="sm" disabled={pending !== null || turns.length === 0} onClick={() => setTurns([])}>
          <RotateCcwIcon data-icon="inline-start" />
          New chat
        </Button>
      </div>

      <MessageScrollerProvider autoScroll>
        <MessageScroller className="min-h-0 flex-1">
          <MessageScrollerViewport>
            <MessageScrollerContent className="gap-4 p-4">
              {turns.length === 0 && (
                <MessageScrollerItem messageId="intro">
                  <div className="flex flex-col gap-3 text-sm">
                    <p className="text-muted-foreground">
                      Tell me what you want and what I can’t change: a budget, equipment to keep, a target.
                      I’ll set it up as an optimization for you to check. When you run it, I test plans in the
                      building model and show you the best one.
                    </p>
                    <div className="flex flex-col items-start gap-2">
                      {suggestions.map(text => (
                        <Button key={text} variant="outline" size="sm" className="h-auto py-1.5 text-left whitespace-normal" onClick={() => send(text)}>
                          {text}
                        </Button>
                      ))}
                    </div>
                  </div>
                </MessageScrollerItem>
              )}
              {turns.map(turn => (
                <MessageScrollerItem key={turn.id} messageId={turn.id} scrollAnchor={turn.role === 'user'}>
                  <Message align={turn.role === 'user' ? 'end' : 'start'}>
                    <MessageContent>
                      {turn.role === 'user' ? (
                        <Bubble align="end"><BubbleContent>{turn.content}</BubbleContent></Bubble>
                      ) : (
                        <Bubble variant={turn.failed ? 'destructive' : 'ghost'}>
                          <BubbleContent><Markdown text={turn.content} /></BubbleContent>
                        </Bubble>
                      )}
                      {turn.proposal && (
                        <ProposalCard
                          proposal={turn.proposal}
                          state={proposalState(turn)}
                          catalog={catalog}
                          onRun={() => send('Looks good. Run the optimization.', { turnId: turn.id, problem: turn.proposal!.problem })}
                        />
                      )}
                      {turn.scenario && <PlanCard scenario={turn.scenario} optimization={turn.optimization} onShow={showPlan} />}
                    </MessageContent>
                  </Message>
                </MessageScrollerItem>
              ))}
              {pending && (
                <MessageScrollerItem messageId="pending">
                  <Message>
                    <MessageContent>
                      <Bubble variant="muted">
                        <BubbleContent className="flex flex-row items-center gap-2">
                          <Spinner />
                          {pending === 'optimizing'
                            ? 'Running the optimization and explaining the result. This takes 10–30 seconds.'
                            : 'Thinking about your request…'}
                        </BubbleContent>
                      </Bubble>
                    </MessageContent>
                  </Message>
                </MessageScrollerItem>
              )}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton />
        </MessageScroller>
      </MessageScrollerProvider>

      <form
        className="p-4 pt-2"
        onSubmit={event => {
          event.preventDefault();
          void send(draft);
        }}
      >
        <InputGroup>
          <InputGroupTextarea
            ref={input}
            value={draft}
            onChange={event => setDraft(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void send(draft);
              }
            }}
            placeholder="e.g. Best plan for CHF 300,000, keep the coffee machines"
            aria-label="Message the assistant"
            rows={2}
            className="max-h-40"
          />
          <InputGroupAddon align="block-end" className="justify-end">
            <InputGroupButton type="submit" variant="default" size="icon-xs" aria-label="Send" disabled={pending !== null || !draft.trim()}>
              <ArrowUpIcon />
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      </form>
    </main>
  );
}
