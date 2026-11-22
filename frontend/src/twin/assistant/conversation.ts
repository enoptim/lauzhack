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
    return Array.isArray(saved) ? saved.filter((turn): turn is Turn => typeof turn?.id === 'string'
      && (turn.role === 'user' || turn.role === 'assistant') && typeof turn.content === 'string'
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
  return detail ?? 'The assistant could not answer. Is the API running? Start it with make dev.';
}
