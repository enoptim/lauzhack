// The twin's shared state: the plans, the conversation with the assistant, and what the user is looking at.
// Every view reads the same plans, so a plan the assistant finds is a plan you can edit in 3D and compare in Results.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api } from '@/api/client';
import type { Catalog, ChatScenario, OptimizationProblem, Scenario } from '@/api/types';
import { errorText, loadTurns, newId, saveTurns, type Turn } from './assistant/conversation';
import { freeColor, MAX_PLANS, nextPlanName, PLAN_COLORS, readPlans, sameScenario, storePlans, type Plan } from './plans';

/** What is on screen, published by the view. The assistant reads it to resolve "this" and "here". */
export type Focus = {
  /** Short words for the chip above the composer, e.g. "Floor 2 · Lighting". */
  label: string;
  /** One or two plain sentences for the assistant. */
  describe: string;
  /** Questions that fit what is on screen. */
  suggestions: string[];
  /** The plan on screen when it is not the plan being edited, e.g. the one selected on Results. */
  plan?: {
    name: string;
    /** As run on screen, e.g. with Results' timing applied. */
    scenario: Scenario;
    color: string | null;
    /** What gets bought, whenever it is bought: the upfront cost is worked out from this. */
    buy?: Scenario;
    /** Assumptions changed on screen, e.g. Results' electricity price. */
    overrides?: Record<string, number>;
  };
};

export type Pending = null | 'thinking' | 'optimizing';

type Twin = {
  catalog: Catalog | null;
  plans: Plan[];
  activePlan: Plan;
  storageError: boolean;
  setActivePlan: (id: number) => void;
  createPlan: () => number;
  removePlan: (id: number) => void;
  renamePlan: (id: number, name: string) => void;
  setScenario: (id: number, scenario: Scenario) => void;
  /** Keeps an assistant plan as one of the plans (once) and makes it the plan being edited. */
  keepPlan: (turnId: string, plan: ChatScenario, name: string) => { id: number; plans: Plan[] };

  focus: Focus | null;
  setFocus: (focus: Focus | null) => void;

  assistantOpen: boolean;
  setAssistantOpen: (open: boolean) => void;
  /** An answer arrived while the assistant was closed. */
  unread: boolean;
  turns: Turn[];
  pending: Pending;
  /** Send a message. With `confirm`, the server first runs the optimizer on exactly that problem. */
  send: (text: string, confirm?: { turnId: string; problem: OptimizationProblem }) => Promise<void>;
  newChat: () => void;
};

const TwinContext = createContext<Twin | null>(null);

const openKey = 'bc-twin:assistant-open';

/** Reopens the assistant after a reload only where it docks beside the view; on small screens it would cover it. */
function readOpen() {
  try {
    return window.matchMedia('(min-width: 80rem)').matches && localStorage.getItem(openKey) === '1';
  } catch {
    return false;
  }
}

export function TwinProvider({ children }: { children: ReactNode }) {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [plans, setPlans] = useState<Plan[]>(() => {
    const saved = readPlans();
    return saved.length ? saved : [{ id: 1, name: 'Plan 1', scenario: [], source: 'you', color: PLAN_COLORS[0] }];
  });
  const [activeId, setActiveId] = useState(() => plans[0].id);
  const [storageError, setStorageError] = useState(false);
  const [focus, setFocus] = useState<Focus | null>(null);
  const [assistantOpen, setOpen] = useState(readOpen);
  const [turns, setTurns] = useState<Turn[]>(loadTurns);
  const [pending, setPending] = useState<Pending>(null);
  const [unread, setUnread] = useState(false);

  const activePlan = plans.find(plan => plan.id === activeId) ?? plans[0];
  // Refs let the callbacks below read the latest state without changing identity on every render.
  const live = useRef({ plans, turns, pending, activePlan, focus, assistantOpen });
  live.current = { plans, turns, pending, activePlan, focus, assistantOpen };

  useEffect(() => {
    api.catalog().then(setCatalog).catch(() => undefined);
  }, []);

  useEffect(() => saveTurns(turns), [turns]);

  const savePlans = useCallback((update: (previous: Plan[]) => Plan[]) => {
    setPlans(previous => {
      const next = update(previous);
      try {
        storePlans(next);
        setStorageError(false);
      } catch {
        setStorageError(true);
      }
      return next;
    });
  }, []);

  const createPlan = useCallback(() => {
    if (live.current.plans.length >= MAX_PLANS) return live.current.activePlan.id;
    const id = live.current.plans.reduce((last, plan) => Math.max(last, plan.id), 0) + 1;
    savePlans(previous => [...previous, { id, name: nextPlanName(previous), scenario: [], source: 'you', color: freeColor(previous) }]);
    setActiveId(id);
    return id;
  }, [savePlans]);

  const removePlan = useCallback((id: number) => {
    const remaining = live.current.plans.filter(plan => plan.id !== id);
    if (!remaining.length) return;
    if (live.current.activePlan.id === id) setActiveId(remaining[0].id);
    savePlans(previous => previous.filter(plan => plan.id !== id));
    setTurns(previous => previous.map(turn => turn.planId === id ? { ...turn, planId: undefined } : turn));
  }, [savePlans]);

  const renamePlan = useCallback((id: number, name: string) => {
    const clean = name.trim().slice(0, 48);
    if (clean) savePlans(previous => previous.map(plan => plan.id === id ? { ...plan, name: clean } : plan));
  }, [savePlans]);

  const setScenario = useCallback((id: number, scenario: Scenario) => {
    savePlans(previous => previous.map(plan => plan.id === id ? { ...plan, scenario } : plan));
  }, [savePlans]);

  const keepPlan = useCallback((turnId: string, chat: ChatScenario, name: string) => {
    // Worked out from the latest plans; the same rule runs again inside the state update, so nothing queued is lost.
    const place = (previous: Plan[], id: number): Plan[] => {
      if (previous.some(plan => sameScenario(plan.scenario, chat.scenario))) return previous;
      // An untouched first plan is just today's building: the assistant's plan takes its place.
      if (previous.length === 1 && previous[0].scenario.length === 0 && previous[0].source === 'you') {
        return [{ id, name, scenario: chat.scenario, source: 'assistant', color: previous[0].color }];
      }
      let room = previous;
      if (room.length >= MAX_PLANS) {
        // Full: make room by dropping an empty plan, else the oldest plan from the assistant, else the oldest plan.
        const active = live.current.activePlan.id;
        const drop = room.find(p => p.scenario.length === 0 && p.id !== active)
          ?? room.find(p => p.source === 'assistant' && p.id !== active)
          ?? room.find(p => p.id !== active)!;
        room = room.filter(p => p.id !== drop.id);
      }
      return [...room, { id, name, scenario: chat.scenario, source: 'assistant', color: freeColor(room) }];
    };
    const existing = live.current.plans.find(plan => sameScenario(plan.scenario, chat.scenario));
    const id = existing?.id ?? live.current.plans.reduce((last, plan) => Math.max(last, plan.id), 0) + 1;
    const next = place(live.current.plans, id);
    if (next !== live.current.plans) {
      live.current.plans = next;
      savePlans(previous => place(previous, id));
    }
    setActiveId(id);
    setTurns(turns => turns.map(turn => turn.id === turnId ? { ...turn, planId: id }
      : turn.planId !== undefined && !next.some(plan => plan.id === turn.planId) ? { ...turn, planId: undefined } : turn));
    return { id, plans: next };
  }, [savePlans]);

  const setAssistantOpen = useCallback((open: boolean) => {
    setOpen(open);
    live.current.assistantOpen = open;
    if (open) setUnread(false);
    try {
      localStorage.setItem(openKey, open ? '1' : '0');
    } catch {
      // Only a convenience: the panel just starts closed next time.
    }
  }, []);

  const send = useCallback(async (text: string, confirm?: { turnId: string; problem: OptimizationProblem }) => {
    const content = text.trim();
    const { turns: current, pending: busy, activePlan: active, focus: seen } = live.current;
    if (!content || busy) return;
    setAssistantOpen(true);
    const marked = confirm ? current.map(turn => turn.id === confirm.turnId ? { ...turn, ran: true } : turn) : current;
    const history: Turn[] = [...marked, { id: newId(), role: 'user', content, where: confirm ? undefined : seen?.label }];
    setTurns(history);
    setPending(confirm ? 'optimizing' : 'thinking');
    // The plan on screen. With nothing changed yet, the plan the assistant showed last.
    const latest = [...current].reverse().find(turn => turn.scenario)?.scenario?.scenario ?? [];
    const onScreen = seen?.plan?.scenario ?? active.scenario;
    try {
      const reply = await api.chat({
        messages: history.filter(turn => !turn.failed).map(({ role, content: words }) => ({ role, content: words })),
        scenario: onScreen.length ? onScreen : latest,
        confirm: confirm?.problem,
        context: seen ? `${seen.describe}${seen.plan ? '' : ` The plan being edited is "${active.name}" with ${active.scenario.length} change(s).`}` : undefined,
      });
      setTurns(previous => [...previous, {
        id: newId(), role: 'assistant', content: reply.reply,
        scenario: reply.scenario, proposal: reply.proposal, optimization: reply.optimization, chart: reply.chart,
      }]);
      if (!live.current.assistantOpen) setUnread(true);
    } catch (error) {
      setTurns(previous => [
        ...previous.map(turn => turn.id === confirm?.turnId ? { ...turn, ran: false } : turn),
        { id: newId(), role: 'assistant', content: errorText(error), failed: true },
      ]);
    } finally {
      setPending(null);
    }
  }, [setAssistantOpen]);

  const newChat = useCallback(() => setTurns([]), []);

  const value = useMemo<Twin>(() => ({
    catalog, plans, activePlan, storageError, setActivePlan: setActiveId, createPlan, removePlan, renamePlan, setScenario, keepPlan,
    focus, setFocus, assistantOpen, setAssistantOpen, unread, turns, pending, send, newChat,
  }), [catalog, plans, activePlan, storageError, createPlan, removePlan, renamePlan, setScenario, keepPlan,
    focus, assistantOpen, setAssistantOpen, unread, turns, pending, send, newChat]);

  return <TwinContext.Provider value={value}>{children}</TwinContext.Provider>;
}

export function useTwin() {
  const twin = useContext(TwinContext);
  if (!twin) throw new Error('useTwin needs a TwinProvider above it.');
  return twin;
}

/** A view says what is on screen while it is mounted. Pass a stable key so it only republishes on change. */
export function usePublishFocus(focus: Focus | null) {
  const { setFocus } = useTwin();
  const key = JSON.stringify(focus);
  useEffect(() => {
    setFocus(focus);
    return () => setFocus(null);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
}
