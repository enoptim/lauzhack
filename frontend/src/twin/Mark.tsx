import { cn } from '@/lib/utils';

/** The eight outer cells of a 3 x 3 grid, clockwise from the top-left corner. */
const RING: [number, number][] = [[0, 0], [1, 0], [2, 0], [2, 1], [2, 2], [1, 2], [0, 2], [0, 1]];
const CYCLE_S = 1.6;

/**
 * The twin's mark: a building seen from above, its rooms around a green core.
 * While the twin works (the engine runs, the assistant thinks) the rooms light up in turn.
 */
export default function Mark({ busy = false, offline = false, className }: { busy?: boolean; offline?: boolean; className?: string }) {
  return (
    <span aria-hidden="true" className={cn('grid size-5 shrink-0 grid-cols-3 grid-rows-3 gap-[2px]', className)}>
      {RING.map(([col, row], index) => (
        <span key={`${col}-${row}`} className={cn('rounded-[1.5px] bg-primary', busy && 'corner-chase-cell')}
          style={{ gridColumn: col + 1, gridRow: row + 1, animationDelay: busy ? `${(index / RING.length) * CYCLE_S - CYCLE_S}s` : undefined }} />
      ))}
      <span className={cn('rounded-[1.5px]', offline ? 'bg-muted-foreground/40' : 'twin-core bg-brand-mid-green')} style={{ gridColumn: 2, gridRow: 2 }} />
    </span>
  );
}
