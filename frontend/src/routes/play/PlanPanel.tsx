import { Lock, Plus, X } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import type { Catalog, PlaySwap, SessionState, SessionSwap } from '@/api/types';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { floorLabel, groupLabels, optionName, whenLabel, whereLabel } from './format';

type Props = {
  state: SessionState;
  catalog: Catalog | null;
  busy: boolean;
  onAdd: (swap: PlaySwap) => void;
  onRemove: (index: number) => void;
};

function Change({ swap, catalog, now, action }: { swap: SessionSwap; catalog: Catalog | null; now: number; action: ReactNode }) {
  return (
    <li className="flex items-start gap-2 text-sm">
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="font-medium">{groupLabels[swap.group] ?? swap.group}: {optionName(catalog, swap.group, swap.option)}</span>
        <span className="text-muted-foreground">{whereLabel(catalog, swap)} · {whenLabel(swap.year, now)}</span>
      </div>
      {action}
    </li>
  );
}

/** The plan: what is done (locked) and what is still planned (can change), plus a small form to add a change. */
export default function PlanPanel({ state, catalog, busy, onAdd, onRemove }: Props) {
  const [group, setGroup] = useState('lighting');
  const [option, setOption] = useState('');
  const [where, setWhere] = useState('all');
  const [when, setWhen] = useState('now');
  const groups = Object.keys(catalog?.groups ?? {}).filter(g => groupLabels[g]);
  const options = (catalog?.groups[group] ?? []).filter(o => o.tier !== 'current');
  const floors = useMemo(() => [...new Set((catalog?.items ?? []).filter(i => i.group === group).map(i => i.serves_floor))]
    .sort((a, b) => a - b), [catalog, group]);
  const chosenOption = options.some(o => o.option_id === option) ? option : options[0]?.option_id ?? '';
  const years = Array.from({ length: Math.max(0, state.horizon - state.t - 1) }, (_, k) => state.t + 1 + k);

  function add() {
    if (!chosenOption) return;
    onAdd({ group, option: chosenOption, year: when === 'now' ? 'now' : Number(when),
            ...(where !== 'all' ? { floor: Number(where) } : {}) });
  }

  return (
    <aside aria-label="Your plan" className="flex flex-col gap-5 rounded-xl border bg-card p-5 lg:sticky lg:top-6 lg:self-start">
      <h2 className="text-lg font-semibold">Your plan</h2>
      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-medium text-muted-foreground">Done</h3>
        {state.plan.done.length === 0 ? <p className="text-sm text-muted-foreground">Nothing yet.</p> : (
          <ul className="flex flex-col gap-2">
            {state.plan.done.map((swap, k) => (
              <Change key={k} swap={swap} catalog={catalog} now={state.t}
                action={<Lock className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-label="Done, can't change" />} />
            ))}
          </ul>
        )}
      </section>
      {!state.ended && (
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-medium text-muted-foreground">Planned</h3>
          {state.plan.planned.length === 0 ? <p className="text-sm text-muted-foreground">Nothing planned.</p> : (
            <ul className="flex flex-col gap-2">
              {state.plan.planned.map((swap, k) => (
                <Change key={k} swap={swap} catalog={catalog} now={state.t} action={
                  <Button size="icon-sm" variant="ghost" disabled={busy} aria-label="Remove from the plan" onClick={() => onRemove(k)}>
                    <X />
                  </Button>
                } />
              ))}
            </ul>
          )}
        </section>
      )}
      {!state.ended && (
        <section className="flex flex-col gap-3 border-t pt-4">
          <h3 className="text-sm font-medium">Add a change</h3>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="play-group" className="text-sm">Equipment</label>
            <Select value={group} onValueChange={value => { setGroup(value); setWhere('all'); }}>
              <SelectTrigger id="play-group" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent><SelectGroup>
                {groups.map(g => <SelectItem key={g} value={g}>{groupLabels[g]}</SelectItem>)}
              </SelectGroup></SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="play-option" className="text-sm">New option</label>
            <Select value={chosenOption} onValueChange={setOption}>
              <SelectTrigger id="play-option" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent position="popper" className="w-(--radix-select-trigger-width)"><SelectGroup>
                {options.map(o => <SelectItem key={o.option_id} value={o.option_id}>{o.name}</SelectItem>)}
              </SelectGroup></SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="play-where" className="text-sm">Where</label>
              <Select value={where} onValueChange={setWhere}>
                <SelectTrigger id="play-where" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent><SelectGroup>
                  <SelectItem value="all">Whole building</SelectItem>
                  {floors.length > 1 && floors.map(f => <SelectItem key={f} value={String(f)}>{floorLabel(f)}</SelectItem>)}
                </SelectGroup></SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="play-when" className="text-sm">When</label>
              <Select value={when} onValueChange={setWhen}>
                <SelectTrigger id="play-when" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent><SelectGroup>
                  <SelectItem value="now">Now</SelectItem>
                  {years.map(y => <SelectItem key={y} value={String(y)}>End of year {y}</SelectItem>)}
                </SelectGroup></SelectContent>
              </Select>
            </div>
          </div>
          <Button variant="secondary" disabled={busy || !chosenOption} onClick={add}>
            <Plus data-icon="inline-start" />
            Add to plan
          </Button>
        </section>
      )}
    </aside>
  );
}
