import { Check } from 'lucide-react';
import type { SessionPreview } from '@/api/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { chf } from './format';

/** What a change costs today and what it saves each year from next year. Numbers come from the API's preview. */
export function costText(preview: SessionPreview | undefined): string {
  if (!preview) return 'Working out the cost…';
  const yearly = -(preview.delta_operating_cost ?? 0);
  const saving = yearly >= 0 ? `saves ${chf(yearly)} a year` : `costs ${chf(-yearly)} more a year`;
  return `${chf(preview.extra_capex_chf)} now · ${saving}`;
}

/** One option to add now: its name, cost and saving, and an Add button (or a note that it's already planned). */
export default function OptionRow({ title, preview, inPlan, busy, onAdd }: {
  title: string; preview: SessionPreview | undefined; inPlan: boolean; busy: boolean; onAdd: () => void;
}) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border bg-background p-2.5">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-sm font-medium">{title}</span>
        <span className="text-xs text-muted-foreground">{inPlan ? 'In your plan.' : costText(preview)}</span>
      </div>
      {inPlan ? (
        <Badge><Check data-icon="inline-start" />In your plan</Badge>
      ) : (
        <Button size="sm" variant="outline" disabled={busy} onClick={onAdd}>Add now</Button>
      )}
    </li>
  );
}
