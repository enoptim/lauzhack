import type { RunRequest, Scenario } from '@/api/types';

/** One plan from the building view: a name and its equipment changes. */
export type Plan = { name: string; scenario: Scenario; color?: string };

/**
 * The configuration the building view sends in the page address: /results?config=<JSON>.
 * `plans` holds every plan to compare; `selected` is the one shown in detail.
 * An older address with only `scenario` still works: it becomes one plan.
 */
export type Config = Required<Pick<RunRequest, 'events' | 'overrides'>> & { plans: Plan[]; selected: number };

/** Shown when the page address has no configuration. */
export const demoConfig: Config = {
  plans: [{ name: 'Demo plan', scenario: [{ group: 'ventilation', option: 'ventilation_mid' }] }],
  selected: 0,
  events: [],
  overrides: {},
};

/** At most this many plans go on one chart; more lines become hard to read. */
export const MAX_PLANS = 6;

/** Reads ?config=. Returns the demo configuration if it is missing, and null if it is broken. */
export function readConfig(params: URLSearchParams): { config: Config; isDemo: boolean } | null {
  const raw = params.get('config');
  if (!raw) return { config: demoConfig, isDemo: true };
  try {
    const parsed = JSON.parse(raw) as Partial<Config> & { scenario?: Scenario };
    const plans = Array.isArray(parsed.plans)
      ? parsed.plans.filter(plan => plan && typeof plan.name === 'string' && Array.isArray(plan.scenario)).slice(0, MAX_PLANS)
      : Array.isArray(parsed.scenario) ? [{ name: 'Your plan', scenario: parsed.scenario }] : null;
    if (!plans?.length) return null;
    const selected = Number.isInteger(parsed.selected) && parsed.selected! >= 0 && parsed.selected! < plans.length ? parsed.selected! : 0;
    return { config: { plans, selected, events: parsed.events ?? [], overrides: parsed.overrides ?? {} }, isDemo: false };
  } catch {
    return null;
  }
}
