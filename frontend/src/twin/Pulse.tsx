// The building's vital signs, always in view: what the plan on screen does to the energy bill and the air,
// and what it costs. It moves the moment anything changes the plan: a click in 3D, the assistant, or Results.
import { ArrowDown, ArrowUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import { changePct, chfShort, whole } from './format';
import { planColor, purchasePrice } from './plans';
import { useTwin } from './TwinProvider';
import { usePulse, useTween } from './usePulse';

function Delta({ pct, lowerIsBetter = true }: { pct: number | null; lowerIsBetter?: boolean }) {
  if (pct === null || pct === 0) return null;
  const better = lowerIsBetter ? pct < 0 : pct > 0;
  const Arrow = pct < 0 ? ArrowDown : ArrowUp;
  return (
    <span className={cn('inline-flex items-center gap-0.5 text-xs font-medium tabular-nums', better ? 'text-positive' : 'text-warning')}>
      <Arrow aria-hidden="true" className="size-3" strokeWidth={2.5} />
      <span className="sr-only">{pct < 0 ? 'down' : 'up'} </span>{Math.abs(pct)}%
    </span>
  );
}

function Vital({ label, value, today, pct, className }: {
  label: string; value: string | null; today?: string; pct?: number | null; className?: string;
}) {
  return (
    <div className={cn('flex min-w-0 flex-col leading-tight', className)} title={today ? `Today: ${today}` : undefined}>
      <span className="truncate text-[11px] text-muted-foreground">{label}</span>
      <span className="flex items-baseline gap-1.5 whitespace-nowrap">
        <span className="text-sm font-semibold tabular-nums">{value ?? '…'}</span>
        {pct !== undefined && <Delta pct={pct} />}
      </span>
    </div>
  );
}

export default function PulseBar({ className }: { className?: string }) {
  const { activePlan, plans, focus, catalog } = useTwin();
  // Results shows one plan in detail; everywhere else the pulse follows the plan being edited.
  const shown = focus?.plan ?? { name: activePlan.name, scenario: activePlan.scenario, color: planColor(plans, activePlan.id) };
  const changed = shown.scenario.length > 0;
  const pulse = usePulse(shown.scenario);
  const bill = useTween(pulse.plan?.bill ?? null);
  const co2 = useTween(pulse.plan?.co2 ?? null);
  const price = purchasePrice(catalog, shown.scenario);
  const upfront = useTween(changed ? price : null);

  if (pulse.offline && !pulse.plan) {
    return <p className={cn('text-xs text-muted-foreground', className)}>The engine is not answering. Start it with make dev.</p>;
  }

  return (
    <section aria-label="The building now" aria-live="polite" aria-busy={pulse.loading}
      className={cn('flex min-w-0 items-center gap-5', className)}>
      <span className="flex min-w-0 items-center gap-2 text-xs font-medium">
        {changed ? (
          <>
            <span aria-hidden="true" className="size-2 shrink-0 rounded-full" style={{ background: shown.color ?? 'var(--muted-foreground)' }} />
            <span className="max-w-36 truncate">{shown.name}</span>
          </>
        ) : (
          <span className="text-muted-foreground">Today</span>
        )}
      </span>
      <Vital label="Energy bill a year" value={bill === null ? null : chfShort(bill)}
        today={pulse.today ? chfShort(pulse.today.bill) : undefined}
        pct={changed ? changePct(pulse.today?.bill, pulse.plan?.bill) : undefined} />
      <Vital label="Meeting-room CO₂" value={co2 === null ? null : `${whole(co2)} ppm`} className="max-xl:hidden"
        today={pulse.today ? `${whole(pulse.today.co2)} ppm` : undefined}
        pct={changed ? changePct(pulse.today?.co2, pulse.plan?.co2) : undefined} />
      {changed && <Vital label="Upfront cost" value={upfront === null ? null : chfShort(upfront)} className="twin-enter" />}
    </section>
  );
}
