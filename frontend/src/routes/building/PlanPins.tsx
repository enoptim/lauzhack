// The plan being edited, pinned onto the building: one pin per floor it changes, at the corner nearest the camera.
// A plan the assistant found shows up here the same way as one you made by hand.
import { Html } from '@react-three/drei';
import type { Swap } from '@/api/types';
import { FLOOR_COUNT, FLOOR_HEIGHT, LENGTH, WIDTH } from '@/data/building';
import { equipmentLabels, isBuildingWide, type EquipmentGroup } from './equipment';

const otherLabels: Record<string, string> = { heating_cooling: 'Heating and cooling', printers_3d: '3D printers' };
export const groupName = (group: string) => equipmentLabels[group as EquipmentGroup] ?? otherLabels[group] ?? group.replaceAll('_', ' ');

/** null = the whole building (roof, facade, or every floor). */
export function pinLevel(swap: Swap): number | null {
  if (swap.group === 'water_heater') return -1;
  if (isBuildingWide(swap.group as EquipmentGroup) || swap.floor === undefined) return null;
  return swap.floor;
}

export const levelName = (level: number | null) =>
  level === null ? 'Whole building' : level === -1 ? 'Basement' : level === 0 ? 'Ground floor' : `Floor ${level}`;

export default function PlanPins({ scenario, color, onPick }: {
  scenario: Swap[];
  color: string;
  onPick: (level: number | null, group: string) => void;
}) {
  const levels = new Map<number | null, string[]>();
  for (const swap of scenario) {
    const level = pinLevel(swap);
    levels.set(level, [...new Set([...(levels.get(level) ?? []), swap.group])]);
  }
  return <>
    {[...levels].map(([level, groups]) => {
      // One floor apart on screen, so neighbouring pins never overlap; the basement sits just below the ground floor.
      const y = level === null ? FLOOR_COUNT * FLOOR_HEIGHT + 2.5 : level === -1 ? -2 : level * FLOOR_HEIGHT + 2;
      return (
        <Html key={String(level)} position={[WIDTH / 2 + 0.6, y, LENGTH / 2 + 0.6]} zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
          <div className="twin-enter flex -translate-y-1/2 items-center">
            <span className="size-2 shrink-0 rounded-full ring-2 ring-white" style={{ background: color }} />
            <span className="h-px w-5 shrink-0" style={{ background: color }} />
            <button type="button" onClick={() => onPick(level, groups[0])} style={{ pointerEvents: 'auto' }}
              className="flex items-center gap-1.5 rounded-full border bg-card/95 py-1 pr-3 pl-2.5 text-xs whitespace-nowrap shadow-[0_1px_2px_oklch(0_0_0/0.06),0_4px_12px_-6px_oklch(0.3_0.02_60/0.25)] backdrop-blur-sm transition-colors hover:border-foreground/25 focus-visible:outline-2 focus-visible:outline-ring">
              <span className="font-semibold">{levelName(level)}</span>
              <span className="text-muted-foreground">{groups.map(groupName).join(', ')}</span>
            </button>
          </div>
        </Html>
      );
    })}
  </>;
}
