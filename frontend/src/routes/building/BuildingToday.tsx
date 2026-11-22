// The building's financial state before any change, like a bank statement: what it costs to run,
// the money it has, and the equipment already wearing out (money it owes its future).
import { MessageSquare } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import type { Catalog } from '@/api/types';
import { chfShort } from '@/twin/format';
import { useTwin } from '@/twin/TwinProvider';

/** Like-for-like value of equipment past its normal life now, and of what reaches it within `years`. */
function wearingOut(catalog: Catalog, years: number) {
  const options = new Map(Object.values(catalog.groups).flat().map(option => [option.option_id, option]));
  let now = 0;
  let soon = 0;
  for (const item of catalog.items) {
    const option = options.get(item.option_id);
    if (!option?.lifetime_years || item.age_years === null) continue;
    const left = option.lifetime_years - item.age_years;
    const value = item.units * option.price_chf_per_unit;
    if (left <= 0) now += value;
    else if (left <= years) soon += value;
  }
  return { now, soon };
}

export default function BuildingToday() {
  const { catalog, send, pending } = useTwin();
  const [costs, setCosts] = useState<{ running: number; energy: number } | null>(null);

  useEffect(() => {
    let live = true;
    api.simulate({ scenario: [] }).then(result => {
      const c = result.snapshot_baseline.building.costs_chf;
      if (live) setCosts({ running: c.energy + c.pv_export + c.maintenance + c.consumables, energy: c.energy });
    }).catch(() => undefined);
    return () => { live = false; };
  }, []);

  if (!catalog || !costs) return null;
  const worn = wearingOut(catalog, 5);
  const rows: [string, string, string?][] = [
    ['Running costs', `${chfShort(costs.running)} a year`, `${chfShort(costs.energy)} of it is energy`],
    ['Savings reserve', chfShort(catalog.limits.opening_reserve_chf), `Must stay above ${chfShort(catalog.limits.min_reserve_chf)}`],
    ['Upgrade budget', chfShort(catalog.limits.capex_budget_chf), 'For the extra cost of an upgrade, above replacing worn-out units like for like. Paying today must also keep the reserve above its minimum.'],
    ['Worn out', chfShort(worn.now), `Equipment past its normal life. Another ${chfShort(worn.soon)} reaches it within 5 years.`],
  ];

  return (
    <section aria-labelledby="today-heading" className="flex flex-col gap-3 border-t pt-4">
      <h2 id="today-heading" className="text-sm font-semibold">The building today</h2>
      <dl className="grid grid-cols-[1fr_auto] gap-x-4 text-sm">
        {rows.map(([label, value, note]) => (
          <div key={label} className="col-span-2 grid grid-cols-subgrid border-b border-border/60 py-2 last:border-b-0">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="text-right font-medium tabular-nums">{value}</dd>
            {note && <dd className="col-span-2 text-xs text-muted-foreground">{note}</dd>}
          </div>
        ))}
      </dl>
      <Button variant="outline" size="sm" className="w-fit" disabled={pending !== null}
        onClick={() => void send('Which worn-out equipment should we replace first, and what does it cost?')}>
        <MessageSquare data-icon="inline-start" />
        Ask what to replace first
      </Button>
    </section>
  );
}
