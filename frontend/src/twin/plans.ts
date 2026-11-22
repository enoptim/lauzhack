// Plans are the one object every part of the twin works on: the building edits them,
// the assistant adds them, and Results compares them.
import type { Catalog, Scenario, Swap } from '@/api/types';

export type PlanSource = 'you' | 'assistant';

export interface Plan {
  id: number;
  name: string;
  scenario: Scenario;
  source: PlanSource;
}

/** One fixed colour per plan, by its place among the plans with changes. The first is the brand orange. */
export const PLAN_COLORS = ['#c34e00', '#2f6fc0', '#a3368f', '#0f766e', '#6f7f1f', '#7c5a00'];

/** Results draws at most this many plans on one chart. */
export const MAX_PLANS = 6;

const storageKey = 'bc-twin:plans:v2';
/** Plans the building saved before they were shared with the assistant and Results. */
const legacyKey = 'bc-twin:saved-configurations:v1';

const isSwap = (swap: unknown): swap is Swap => {
  const s = swap as Swap | null;
  return typeof s?.group === 'string' && typeof s.option === 'string' && (s.floor === undefined || Number.isInteger(s.floor));
};

export function readPlans(): Plan[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(storageKey) ?? 'null');
    if (Array.isArray(saved)) {
      return saved.filter((plan: Plan) => Number.isSafeInteger(plan?.id) && plan.id > 0 && typeof plan.name === 'string'
        && Array.isArray(plan.scenario) && plan.scenario.every(isSwap))
        .map((plan: Plan) => ({ ...plan, source: plan.source === 'assistant' ? 'assistant' : 'you' }));
    }
    const legacy: unknown = JSON.parse(localStorage.getItem(legacyKey) ?? '[]');
    if (!Array.isArray(legacy)) return [];
    return legacy.filter(entry => Number.isSafeInteger(entry?.id) && Array.isArray(entry.scenario) && entry.scenario.every(isSwap))
      .map((entry, index) => ({ id: entry.id, name: `Plan ${index + 1}`, scenario: entry.scenario, source: 'you' as const }));
  } catch {
    return [];
  }
}

/** Throws when browser storage is unavailable; the caller says so. */
export function storePlans(plans: Plan[]) {
  localStorage.setItem(storageKey, JSON.stringify(plans));
}

/** The colour of a plan, or null while it has no changes (it is still today's building). */
export function planColor(plans: Plan[], id: number): string | null {
  const index = plans.filter(plan => plan.scenario.length > 0).findIndex(plan => plan.id === id);
  return index < 0 ? null : PLAN_COLORS[index % PLAN_COLORS.length];
}

/** "Plan 3": the first number not taken by a plan you made. */
export function nextPlanName(plans: Plan[]) {
  const taken = new Set(plans.map(plan => plan.name));
  let n = 1;
  while (taken.has(`Plan ${n}`)) n += 1;
  return `Plan ${n}`;
}

/** The page address that opens Results on these plans, the given one shown in detail. */
export function resultsHref(plans: Plan[], focusId: number | null, events: string[] = []) {
  const withChanges = plans.filter(plan => plan.scenario.length > 0).slice(0, MAX_PLANS);
  const selected = Math.max(0, withChanges.findIndex(plan => plan.id === focusId));
  const config = withChanges.length
    ? { plans: withChanges.map(({ name, scenario }) => ({ name, scenario })), selected, events }
    : { plans: [{ name: 'Current setup', scenario: [] }], selected: 0, events };
  return `/results?config=${encodeURIComponent(JSON.stringify(config))}`;
}

/** What the plan costs to buy: each new option's price times the units it replaces. Matches Results. */
export function purchasePrice(catalog: Catalog | null, scenario: Scenario) {
  if (!catalog) return null;
  return scenario.reduce((sum, swap) => {
    const price = catalog.groups[swap.group]?.find(option => option.option_id === swap.option)?.price_chf_per_unit ?? 0;
    const units = catalog.items.filter(item => item.group === swap.group
      && (swap.floor === undefined || item.serves_floor === swap.floor)).reduce((n, item) => n + item.units, 0);
    return sum + price * units;
  }, 0);
}

export const sameScenario = (a: Scenario, b: Scenario) => JSON.stringify(a) === JSON.stringify(b);
