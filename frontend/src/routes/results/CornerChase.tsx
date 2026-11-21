import { cn } from '@/lib/utils';

/** The eight outer cells of a 3 x 3 grid, in clockwise order from the top-left corner. */
const RING: [number, number][] = [[0, 0], [1, 0], [2, 0], [2, 1], [2, 2], [1, 2], [0, 2], [0, 1]];
const CYCLE_S = 1.6;

/** A quiet loader: small squares light up one after another around a square, in the brand colour. */
export default function CornerChase({ className }: { className?: string }) {
  return (
    <span role="status" aria-label="Loading" className={cn('grid size-12 grid-cols-3 grid-rows-3 gap-1', className)}>
      {RING.map(([col, row], index) => (
        <span key={`${col}-${row}`} className="corner-chase-cell rounded-[3px] bg-primary"
          style={{ gridColumn: col + 1, gridRow: row + 1, animationDelay: `${(index / RING.length) * CYCLE_S - CYCLE_S}s` }} />
      ))}
    </span>
  );
}
