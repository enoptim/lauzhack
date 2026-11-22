import type { ChatChart, ChatEvent, ChatOptimization, ChatProposal, ChatScenario } from '@/api/types';

/** What the assistant did on the way to its reply, in order. */
export type Step =
  /** Its thinking. seconds is set once it stops thinking. */
  | { kind: 'thinking'; text: string; startedAt: number; seconds?: number }
  /** A job in the building model, e.g. the optimizer. */
  | { kind: 'job'; id: string; name: string; args: Record<string, unknown>; status: 'running' | 'done' | 'failed'; startedAt: number; seconds?: number }
  /** Words it wrote before starting a job. */
  | { kind: 'note'; text: string };

export type Turn = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** Where the user was when they asked, e.g. "Floor 2 · Lighting". Shown above their message. */
  where?: string;
  scenario?: ChatScenario | null;
  /** An optimization the assistant set up, waiting for the user's OK. */
  proposal?: ChatProposal | null;
  /** Set once the user ran this turn's proposal. */
  ran?: boolean;
  optimization?: ChatOptimization | null;
  chart?: ChatChart | null;
  /** The plan this turn's scenario became, once the user kept it. */
  planId?: number;
  failed?: boolean;
  /** How the assistant got to this reply: thinking and jobs. */
  steps?: Step[];
  /** The reply is still arriving. */
  streaming?: boolean;
};

// The conversation survives a reload of this browser tab.
const storageKey = 'assistant-conversation-v4';

/** A saved plan has what its card reads: the swaps, and a summary with figures and lists. */
function validScenario(plan: ChatScenario) {
  const s = plan?.summary;
  return Array.isArray(plan?.scenario) && typeof plan.title === 'string' && typeof s === 'object' && s !== null
    && Array.isArray(s.flags) && typeof s.upfront_cost_chf === 'number' && typeof s.running_cost_saving_chf_year === 'number'
    && typeof s.energy_bill_chf_month?.today === 'number' && typeof s.energy_bill_chf_month?.scenario === 'number';
}

export function loadTurns(): Turn[] {
  try {
    const saved = JSON.parse(sessionStorage.getItem(storageKey) ?? '[]') as unknown;
    // Keep only turns with the shape the column draws, so one bad entry can't break the app after every reload.
    // A reply that was still arriving when the tab reloaded is gone: drop it.
    return Array.isArray(saved) ? saved.filter((turn): turn is Turn => typeof turn?.id === 'string'
      && (turn.role === 'user' || turn.role === 'assistant') && typeof turn.content === 'string'
      && !turn.streaming && (turn.steps == null || Array.isArray(turn.steps))
      && (turn.scenario == null || validScenario(turn.scenario))) : [];
  } catch {
    return [];
  }
}

export function saveTurns(turns: Turn[]) {
  try {
    sessionStorage.setItem(storageKey, JSON.stringify(turns));
  } catch {
    // Storage can be unavailable (private mode); the chat still works without it.
  }
}

// getRandomValues also works over plain http (e.g. the LAN address), unlike randomUUID.
export const newId = () => crypto.getRandomValues(new Uint32Array(2)).join('-');

export function errorText(error: unknown) {
  const detail = /"detail":"((?:[^"\\]|\\.)*)"/.exec(String(error))?.[1];
  if (detail) return detail;
  // Errors from the live stream are already written for people.
  const message = error instanceof Error ? error.message : '';
  if (message && !message.startsWith('/api/') && !(error instanceof TypeError)) return message;
  return 'The assistant could not answer. Is the API running? Start it with make dev.';
}

/** Folds one live event into the reply being written. Returns a new turn; the old one is not changed. */
export function applyEvent(turn: Turn, event: ChatEvent, now: number): Turn {
  const steps = [...(turn.steps ?? [])];
  const last = steps.at(-1);
  // Thinking ends when anything else happens.
  const endThinking = () => {
    if (last?.kind === 'thinking' && last.seconds === undefined) {
      steps[steps.length - 1] = { ...last, seconds: Math.max(1, Math.round((now - last.startedAt) / 1000)) };
    }
  };
  switch (event.type) {
    case 'thinking':
      if (last?.kind === 'thinking' && last.seconds === undefined) steps[steps.length - 1] = { ...last, text: last.text + event.text };
      else steps.push({ kind: 'thinking', text: event.text, startedAt: now });
      return { ...turn, steps };
    case 'text':
      endThinking();
      return { ...turn, steps, content: turn.content + event.text };
    case 'tool_start':
      endThinking();
      // Words written before a job are a note about it, not the reply.
      if (turn.content.trim()) steps.push({ kind: 'note', text: turn.content.trim() });
      steps.push({ kind: 'job', id: event.id, name: event.name, args: event.args ?? {}, status: 'running', startedAt: now });
      return { ...turn, steps, content: '' };
    case 'tool_end':
      return {
        ...turn,
        steps: steps.map(step => step.kind === 'job' && step.id === event.id
          ? { ...step, status: event.ok ? 'done' : 'failed', seconds: event.seconds } : step),
      };
    default:
      return turn;
  }
}
