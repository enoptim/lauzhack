import type { RunRequest, Scenario } from '@/api/types';

/** The configuration the building view sends in the page address: /results?config=<JSON>. */
export type Config = Required<Pick<RunRequest, 'scenario' | 'events' | 'overrides'>>;

/** Shown when the page address has no configuration. */
export const demoConfig: Config = {
  scenario: [{ group: 'ventilation', option: 'ventilation_mid' }],
  events: [],
  overrides: {},
};

/** Reads ?config=. Returns the demo configuration if it is missing, and null if it is broken. */
export function readConfig(params: URLSearchParams): { config: Config; isDemo: boolean } | null {
  const raw = params.get('config');
  if (!raw) return { config: demoConfig, isDemo: true };
  try {
    const parsed = JSON.parse(raw) as Partial<Config>;
    if (!Array.isArray(parsed.scenario)) return null;
    return {
      config: { scenario: parsed.scenario as Scenario, events: parsed.events ?? [], overrides: parsed.overrides ?? {} },
      isDemo: false,
    };
  } catch {
    return null;
  }
}
