import { X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '@/api/client';
import type { Catalog, PlaySwap, SessionPreview, SessionState } from '@/api/types';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { floorLabel, groupLabels } from './format';
import OptionRow from './OptionRow';

/** Groups that change for the whole building at once (the 3D shows one set of them). */
const BUILDING_WIDE = new Set(['ventilation', 'blinds', 'solar_pv', 'water_heater', 'servers']);

type Props = {
  state: SessionState;
  catalog: Catalog | null;
  group: string;
  /** The 3D view the player is looking at: a floor, the basement (-1), or the whole building (null). */
  floor: number | null;
  busy: boolean;
  onDecide: (swaps: PlaySwap[]) => void;
  onClose: () => void;
};

/** Equipment the player clicked: every option, with its cost now and yearly saving, to add to the plan now. */
export default function ChangeNow({ state, catalog, group, floor, busy, onDecide, onClose }: Props) {
  const perFloor = !BUILDING_WIDE.has(group) && floor !== null && floor >= 0;
  const [scope, setScope] = useState<'all' | 'floor'>('all');
  const onFloor = perFloor && scope === 'floor';
  const options = (catalog?.groups[group] ?? []).filter(option => option.tier !== 'current');
  const swapFor = (option: string): PlaySwap => ({ group, option, year: 'now', ...(onFloor ? { floor: floor as number } : {}) });
  const [previews, setPreviews] = useState<Record<string, SessionPreview>>({});
  const key = `${state.session_id}|${state.t}|${JSON.stringify(state.decisions)}|${group}|${onFloor ? floor : 'all'}|${options.length}`;

  useEffect(() => {
    let stale = false;
    setPreviews({});
    Promise.all(options.map(option => api.sessionPreview(state.session_id, swapFor(option.option_id))
      .then(preview => [option.option_id, preview] as const)))
      .then(entries => { if (!stale) setPreviews(Object.fromEntries(entries)); })
      .catch(() => undefined);
    return () => { stale = true; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const inPlan = (option: string) => [...state.plan.done, ...state.plan.planned].some(d => d.group === group
    && d.option === option && (onFloor ? d.floor === floor : d.floor === undefined && !d.item_id));

  return (
    <Card className="gap-3 py-4">
      <CardHeader className="px-4">
        <CardTitle>Change {(groupLabels[group] ?? group).toLowerCase()} now</CardTitle>
        <CardDescription>{onFloor ? `Only on the ${floorLabel(floor as number)}.` : 'For the whole building.'} It goes in now and works from next year.</CardDescription>
        <CardAction>
          <Button size="icon-sm" variant="ghost" aria-label="Close" onClick={onClose}><X /></Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 px-4">
        {perFloor && (
          <ToggleGroup type="single" variant="outline" size="sm" value={scope} aria-label="Where"
            onValueChange={value => value && setScope(value as 'all' | 'floor')}>
            <ToggleGroupItem value="all">Whole building</ToggleGroupItem>
            <ToggleGroupItem value="floor">Only the {floorLabel(floor as number)}</ToggleGroupItem>
          </ToggleGroup>
        )}
        <ul className="flex flex-col gap-2">
          {options.map(option => (
            <OptionRow key={option.option_id} title={option.name} preview={previews[option.option_id]}
              inPlan={inPlan(option.option_id)} busy={busy} onAdd={() => onDecide([swapFor(option.option_id)])} />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
