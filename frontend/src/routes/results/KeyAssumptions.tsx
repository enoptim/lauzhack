import type { Assumption, AssumptionLabel, TornadoResult } from '@/api/types';
import { Badge } from '@/components/ui/badge';
import { chfShort } from './format';

const labelVariant: Record<AssumptionLabel, 'default' | 'secondary' | 'outline'> = {
  fact: 'default',
  research: 'secondary',
  result: 'secondary',
  guess: 'outline',
};

/** The assumptions that move the 15-year result most, each with how sure we are of it. */
export default function KeyAssumptions({ tornado, assumptions }: { tornado: TornadoResult; assumptions: Assumption[] }) {
  const byKey = new Map(assumptions.map(item => [item.key, item]));
  const rows = tornado.rows.slice(0, 6);
  const max = Math.max(...rows.map(row => row.swing), 1);

  return (
    <ul className="flex flex-col gap-4">
      {rows.map(row => {
        const info = byKey.get(row.parameter);
        const low = Math.min(row.at_low, row.at_high);
        const high = Math.max(row.at_low, row.at_high);
        return (
          <li key={row.parameter} className="flex flex-col gap-1.5 text-sm">
            <span className="flex items-start justify-between gap-3">
              <span className="line-clamp-2">{info?.description || row.parameter}</span>
              {info && <Badge variant={labelVariant[info.label]} className="shrink-0 font-normal">{info.label}</Badge>}
            </span>
            <span className="flex items-center gap-3">
              <span className="relative h-1.5 flex-1 rounded-full bg-muted">
                <span className="absolute inset-y-0 left-0 rounded-full bg-chart-1/70" style={{ width: `${(row.swing / max) * 100}%` }} />
              </span>
              <span className="w-36 text-right text-muted-foreground tabular-nums">{chfShort(low)} to {chfShort(high)}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
