import type { EquipmentSwap } from './equipment';

export interface SavedConfiguration {
  id: number;
  scenario: EquipmentSwap[];
}

const storageKey = 'bc-twin:saved-configurations:v1';

export function readSavedConfigurations(): SavedConfiguration[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(storageKey) ?? '[]');
    if (!Array.isArray(value)) return [];
    return value.filter(entry => Number.isSafeInteger(entry?.id) && entry.id > 0
      && Array.isArray(entry.scenario)
      && entry.scenario.every((swap: EquipmentSwap) => typeof swap?.group === 'string' && typeof swap.option === 'string'
        && (swap.floor === undefined || Number.isInteger(swap.floor))));
  } catch {
    return [];
  }
}

export function storeConfigurations(configurations: SavedConfiguration[]) {
  localStorage.setItem(storageKey, JSON.stringify(configurations));
}

export const configurationName = (position: number) => `Configuration ${position}`;
