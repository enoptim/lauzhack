import type { ChatChart, ChatOptimization, ChatProposal, ChatScenario } from '@/api/types';

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
};

// The conversation survives a reload of this browser tab.
const storageKey = 'assistant-conversation-v3';

export function loadTurns(): Turn[] {
  try {
    const saved = JSON.parse(sessionStorage.getItem(storageKey) ?? '[]') as unknown;
    // Keep only turns with the shape the column draws, so one bad entry can't break the app after every reload.
    return Array.isArray(saved) ? saved.filter((turn): turn is Turn => typeof turn?.id === 'string'
      && (turn.role === 'user' || turn.role === 'assistant') && typeof turn.content === 'string'
      && (turn.scenario == null || (Array.isArray(turn.scenario.scenario) && typeof turn.scenario.summary === 'object'))) : [];
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
  return detail ?? 'The assistant could not answer. Is the API running? Start it with make dev.';
}
