// The assistant: a button in the header (top-right, on every page) that opens a chat window.
// It talks to POST /api/chat (chat/README.md). The reply can carry a plan, which opens on /results.
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { ArrowUpIcon, MessageCircleIcon, RotateCcwIcon, XIcon } from 'lucide-react';
import { api } from '@/api/client';
import type { Catalog, ChatScenario, OptimizationProblem, Scenario } from '@/api/types';
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
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@/components/ui/popover';
import { Spinner } from '@/components/ui/spinner';
import Markdown from './Markdown';
import PlanCard from './PlanCard';

type Turn = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  scenario?: ChatScenario | null;
  problem?: OptimizationProblem | null;
  failed?: boolean;
};

const suggestions = [
  'Cut our electricity use by 15% as cheaply as possible.',
  'Lowest running costs for at most CHF 200,000, but don’t touch the ventilation.',
  'Which single upgrades pay back fastest?',
];

/** The scenario on screen, so the assistant can build on it. Only /results carries one in its address. */
function scenarioOnScreen(params: URLSearchParams): Scenario {
  try {
    const parsed = JSON.parse(params.get('config') ?? '') as { scenario?: unknown };
    return Array.isArray(parsed.scenario) ? parsed.scenario as Scenario : [];
  } catch {
    return [];
  }
}

function errorText(error: unknown) {
  const detail = /"detail":"((?:[^"\\]|\\.)*)"/.exec(String(error))?.[1];
  return detail ?? 'The assistant could not answer. Is the API running? Start it with make dev.';
}

export default function AssistantChat() {
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState(false);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const nextId = useRef(0);
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open && !catalog) api.catalog().then(setCatalog).catch(() => undefined);
  }, [open, catalog]);

  async function send(text: string) {
    const content = text.trim();
    if (!content || pending) return;
    const history: Turn[] = [...turns, { id: String(nextId.current++), role: 'user', content }];
    setTurns(history);
    setDraft('');
    setPending(true);
    try {
      const reply = await api.chat({
        messages: history.filter(turn => !turn.failed).map(({ role, content }) => ({ role, content })),
        scenario: scenarioOnScreen(params),
      });
      setTurns(previous => [...previous, {
        id: String(nextId.current++), role: 'assistant', content: reply.reply, scenario: reply.scenario, problem: reply.problem,
      }]);
    } catch (error) {
      setTurns(previous => [...previous, { id: String(nextId.current++), role: 'assistant', content: errorText(error), failed: true }]);
    } finally {
      setPending(false);
    }
  }

  function showPlan(plan: ChatScenario) {
    setOpen(false); // the conversation is kept; reopening shows it again
    navigate(`/results?config=${encodeURIComponent(JSON.stringify({ scenario: plan.scenario, events: plan.events }))}`);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button aria-label={open ? 'Close the assistant' : 'Open the assistant'}>
          {open ? <XIcon data-icon="inline-start" /> : <MessageCircleIcon data-icon="inline-start" />}
          <span className="sr-only sm:not-sr-only">Assistant</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="end"
        sideOffset={8}
        collisionPadding={8}
        // Stay open while people orbit the building; close with the button, the × or Escape.
        onInteractOutside={event => event.preventDefault()}
        onOpenAutoFocus={event => {
          event.preventDefault();
          input.current?.focus();
        }}
        className="flex h-[min(38rem,calc(100dvh-5rem))] w-[min(26rem,calc(100vw-2rem))] flex-col gap-0 p-0"
      >
        <div className="flex items-center gap-2 border-b py-2 pr-2 pl-4">
          <PopoverTitle className="flex-1">Ask the building</PopoverTitle>
          <Button variant="ghost" size="icon-sm" aria-label="Start a new chat" disabled={pending || turns.length === 0} onClick={() => setTurns([])}>
            <RotateCcwIcon />
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={() => setOpen(false)}>
            <XIcon />
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
                        I’ll test plans in the building model and show you the best one.
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
                        <PlanCard scenario={turn.scenario} problem={turn.problem} catalog={catalog} onShow={showPlan} />
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
                            Testing plans in the building model. This takes 10–30 seconds.
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
          className="border-t p-3"
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
              className="max-h-32"
            />
            <InputGroupAddon align="block-end" className="justify-end">
              <InputGroupButton type="submit" variant="default" size="icon-xs" aria-label="Send" disabled={pending || !draft.trim()}>
                <ArrowUpIcon />
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
        </form>
      </PopoverContent>
    </Popover>
  );
}
