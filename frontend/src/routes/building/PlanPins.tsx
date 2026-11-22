// The plan being edited, pinned onto the building: one pin per floor it changes, at the corner nearest the camera.
// A plan the assistant found shows up here the same way as one you made by hand.
import { Html } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import type { Swap } from '@/api/types';
import { FLOOR_COUNT, FLOOR_HEIGHT, LENGTH, WIDTH } from '@/data/building';
import { groupLabel } from '@/twin/plans';

/** null = the whole building (roof, facade, or every floor). */
export function pinLevel(swap: Swap): number | null {
  if (swap.floor !== undefined) return swap.floor;
  return swap.group === 'water_heater' ? -1 : null;
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
  // Lowest floor first, so the pins land from the ground up.
  const order = [...levels].sort(([a], [b]) => (a ?? 99) - (b ?? 99));
  // In a small view the floors sit too close for one pin each: one pin sums the plan up instead.
  const narrow = useThree(state => state.size.width) < 480;
  if (narrow && order.length > 2) {
    const kinds = [...new Set(order.flatMap(([, groups]) => groups))];
    return (
      <Html center position={[0, FLOOR_COUNT * FLOOR_HEIGHT + 6, 0]} zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
        <span className="twin-enter flex max-w-[16rem] items-center gap-1.5 rounded-full border bg-card/95 px-2.5 py-1 text-xs shadow-sm">
          <span aria-hidden="true" className="size-2 shrink-0 rounded-full" style={{ background: color }} />
          <span className="shrink-0 font-semibold">{scenario.length} changes</span>
          <span className="truncate text-muted-foreground">{kinds.map(groupLabel).join(', ')}</span>
        </span>
      </Html>
    );
  }
  return <>
    {order.map(([level, groups], index) => {
      // One floor apart on screen, so neighbouring pins never overlap; the basement sits just below the ground floor.
      const y = level === null ? FLOOR_COUNT * FLOOR_HEIGHT + 2.5 : level === -1 ? -2 : level * FLOOR_HEIGHT + 2;
      return (
        <Html key={String(level)} position={[WIDTH / 2 + 0.6, y, LENGTH / 2 + 0.6]} zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
          <div className="twin-enter twin-enter-stagger flex -translate-y-1/2 items-center" style={{ ['--i' as string]: index }}>
            <span className="size-2 shrink-0 rounded-full ring-2 ring-white" style={{ background: color }} />
            <span className="h-px w-5 shrink-0" style={{ background: color }} />
            <button type="button" onClick={() => onPick(level, groups[0])} style={{ pointerEvents: 'auto' }}
              className="flex items-center gap-1.5 rounded-full border bg-card/95 py-1 pr-3 pl-2.5 text-xs whitespace-nowrap shadow-[0_1px_2px_oklch(0_0_0/0.06),0_4px_12px_-6px_oklch(0.3_0.02_60/0.25)] backdrop-blur-sm transition-colors hover:border-foreground/25 focus-visible:outline-2 focus-visible:outline-ring">
              <span className="font-semibold">{levelName(level)}</span>
              <span className="text-muted-foreground">{groups.map(groupLabel).join(', ')}</span>
            </button>
          </div>
        </Html>
      );
    })}
  </>;
}
