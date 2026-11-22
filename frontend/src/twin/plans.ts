// Plans are the one object every part of the twin works on: the building edits them,
// the assistant adds them, and Results compares them.
import type { Catalog, Scenario, Swap } from '@/api/types';

export type PlanSource = 'you' | 'assistant';

export interface Plan {
  id: number;
  name: string;
  scenario: Scenario;
  source: PlanSource;
  /** Fixed when the plan is made, so it never changes when other plans come and go. */
  color: string;
}

/** One colour per plan, in every view. The first is the brand orange. */
export const PLAN_COLORS = ['#c34e00', '#2f6fc0', '#a3368f', '#0f766e', '#6f7f1f', '#7c5a00'];

/** At most this many plans: Results draws at most six on one chart, one colour each. */
export const MAX_PLANS = 6;

const storageKey = 'bc-twin:plans:v2';
/** Plans the building saved before they were shared with the assistant and Results. */
const legacyKey = 'bc-twin:saved-configurations:v1';

const isSwap = (swap: unknown): swap is Swap => {
  const s = swap as Swap | null;
  return typeof s?.group === 'string' && typeof s.option === 'string' && (s.floor === undefined || Number.isInteger(s.floor));
};

/** The first colour no other plan uses. */
export function freeColor(plans: Pick<Plan, 'color'>[]) {
  const used = new Set(plans.map(plan => plan.color));
  return PLAN_COLORS.find(color => !used.has(color)) ?? PLAN_COLORS[plans.length % PLAN_COLORS.length];
}

/** Gives every plan a colour of its own, keeping the ones already set. */
function withColors(plans: (Omit<Plan, 'color'> & { color?: string })[]): Plan[] {
  const out: Plan[] = [];
  for (const plan of plans) {
    const color = plan.color && PLAN_COLORS.includes(plan.color) && !out.some(p => p.color === plan.color) ? plan.color : freeColor(out);
    out.push({ ...plan, color });
  }
  return out;
}

export function readPlans(): Plan[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(storageKey) ?? 'null');
    if (Array.isArray(saved)) {
      return withColors(saved.filter((plan: Plan) => Number.isSafeInteger(plan?.id) && plan.id > 0 && typeof plan.name === 'string'
        && Array.isArray(plan.scenario) && plan.scenario.every(isSwap))
        .slice(0, MAX_PLANS)
        .map((plan: Plan) => ({ ...plan, source: plan.source === 'assistant' ? 'assistant' as const : 'you' as const })));
    }
    const legacy: unknown = JSON.parse(localStorage.getItem(legacyKey) ?? '[]');
    if (!Array.isArray(legacy)) return [];
    return withColors(legacy.filter(entry => Number.isSafeInteger(entry?.id) && Array.isArray(entry.scenario) && entry.scenario.every(isSwap))
      .slice(0, MAX_PLANS)
      .map((entry, index) => ({ id: entry.id, name: `Plan ${index + 1}`, scenario: entry.scenario, source: 'you' as const })));
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
  const plan = plans.find(p => p.id === id);
  return plan && plan.scenario.length > 0 ? plan.color : null;
}

/** "Plan 3": the first number not taken by a plan you made. */
export function nextPlanName(plans: Plan[]) {
  const taken = new Set(plans.map(plan => plan.name));
  let n = 1;
  while (taken.has(`Plan ${n}`)) n += 1;
  return `Plan ${n}`;
}

/** The page address that opens Results on these plans, the given one shown in detail, each in its own colour. */
export function resultsHref(plans: Plan[], focusId: number | null, events: string[] = []) {
  const withChanges = plans.filter(plan => plan.scenario.length > 0).slice(0, MAX_PLANS);
  const selected = Math.max(0, withChanges.findIndex(plan => plan.id === focusId));
  const config = withChanges.length
    ? { plans: withChanges.map(({ name, scenario, color }) => ({ name, scenario, color })), selected, events }
    : { plans: [{ name: 'Current setup', scenario: [] }], selected: 0, events };
  return `/results?config=${encodeURIComponent(JSON.stringify(config))}`;
}

export const sameScenario = (a: Scenario, b: Scenario) => JSON.stringify(a) === JSON.stringify(b);

/** Plain names for every kind of equipment the engine knows, including ones the 3D view can't pick. */
export const groupLabels: Record<string, string> = {
  lighting: 'Lighting', monitors: 'Monitors', computers: 'Computers', coffee: 'Coffee machines',
  water_heater: 'Water heaters', servers: 'Server racks', ventilation: 'Ventilation', solar_pv: 'Solar panels',
  blinds: 'Blinds', lauzhack_banner: 'LauzHack banner', heating_cooling: 'Heating and cooling', printers_3d: '3D printers',
};
export const groupLabel = (group: string) => groupLabels[group] ?? group.replaceAll('_', ' ');

/** "Basement, ground floor and floors 1–4"; null means the whole building. */
export function levelsText(levels: (number | null)[]) {
  if (levels.includes(null)) return 'Whole building';
  const sorted = [...new Set(levels as number[])].sort((a, b) => a - b);
  const parts: string[] = [];
  if (sorted.includes(-1)) parts.push('basement');
  if (sorted.includes(0)) parts.push('ground floor');
  const upper = sorted.filter(level => level > 0);
  const runs: string[] = [];
  for (let i = 0; i < upper.length; i++) {
    let j = i;
    while (j + 1 < upper.length && upper[j + 1] === upper[j] + 1) j++;
    runs.push(j - i >= 2 ? `${upper[i]}–${upper[j]}` : upper.slice(i, j + 1).join(', '));
    i = j;
  }
  if (upper.length) parts.push(`${upper.length === 1 ? 'floor' : 'floors'} ${runs.join(', ')}`);
  const text = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0] ?? '';
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Building-wide groups have one unit for the whole building, wherever it sits. */
const buildingWide = new Set(['water_heater', 'ventilation', 'solar_pv', 'blinds']);

/** A plan's changes grouped by what they install: one row per kind of equipment and new option. */
export function groupedChanges(scenario: Scenario, catalog: Catalog | null) {
  const rows = new Map<string, { group: string; option: string; name: string; levels: (number | null)[]; first: Swap }>();
  for (const swap of scenario) {
    const key = `${swap.group}|${swap.option}`;
    const level = buildingWide.has(swap.group) || swap.floor === undefined ? null : swap.floor;
    const row = rows.get(key);
    if (row) row.levels.push(level);
    else rows.set(key, {
      group: swap.group, option: swap.option, levels: [level], first: swap,
      name: catalog?.groups[swap.group]?.find(option => option.option_id === swap.option)?.name ?? swap.option.replaceAll('_', ' '),
    });
  }
  return [...rows.values()].map(row => ({ ...row, label: groupLabel(row.group), where: levelsText(row.levels) }));
}
