import { Blinds, Coffee, Fan, Flag, Heater, Lightbulb, ListChecks, Monitor, PcCase, Server, Sun } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FLOOR_COUNT } from '@/data/building';
import ConfigurationComparison from './ConfigurationComparison';
import { configurationName, type SavedConfiguration } from './configurations';
import { draftKey, equipmentForFloor, equipmentLabels, isBuildingWide, type EquipmentGroup, type EquipmentSwap } from './equipment';

export const keepCurrent = 'keep-current';
const floors = Array.from({ length: FLOOR_COUNT + 1 }, (_, index) => FLOOR_COUNT - 1 - index);
const floorLabel = (floor: number) => floor === -1 ? 'Basement' : floor === 0 ? 'Ground floor' : `Floor ${floor}`;
const icons = {
  ventilation: Fan, blinds: Blinds, solar_pv: Sun, water_heater: Heater, servers: Server,
  lighting: Lightbulb, monitors: Monitor, computers: PcCase, coffee: Coffee, lauzhack_banner: Flag,
};

function changesByFloor(draft: ReadonlyMap<string, EquipmentSwap>) {
  const groups = new Map<number | null, [string, EquipmentSwap][]>();
  for (const [key, swap] of draft) {
    const level = isBuildingWide(swap.group) ? null : swap.floor ?? null;
    const changes = groups.get(level);
    if (changes) changes.push([key, swap]);
    else groups.set(level, [[key, swap]]);
  }
  return [null, ...floors].flatMap(level => {
    const changes = groups.get(level);
    return changes ? [{ level, changes }] : [];
  });
}

function equipmentGroups(floor: number | null): EquipmentGroup[] {
  if (floor === null) return ['ventilation', 'blinds', 'solar_pv'];
  if (floor === -1) return ['water_heater', 'servers'];
  const groups: EquipmentGroup[] = ['lighting', 'monitors', 'computers'];
  if (floor === FLOOR_COUNT - 1) groups.push('coffee');
  if (floor === 0) groups.push('lauzhack_banner');
  return groups;
}

interface BuildingInspectorProps {
  floor: number | null;
  selectedGroup: EquipmentGroup | null;
  draft: ReadonlyMap<string, EquipmentSwap>;
  onFloorChange: (floor: number | null) => void;
  onSelectGroup: (group: EquipmentGroup | null) => void;
  onChooseOption: (group: EquipmentGroup, option: string) => void;
  saved: SavedConfiguration[];
  storageError: boolean;
  onSaveAndStartNew: () => void;
  onRemoveConfiguration: (id: number) => void;
}

export default function BuildingInspector({ floor, selectedGroup, draft, onFloorChange, onSelectGroup, onChooseOption, saved,
  storageError, onSaveAndStartNew, onRemoveConfiguration }: BuildingInspectorProps) {
  const inspectorBody = useRef<HTMLDivElement>(null);
  const activeTrigger = useRef<HTMLButtonElement>(null);
  const groups = equipmentGroups(floor);
  const location = floor === null ? 'Whole building' : floorLabel(floor);

  useEffect(() => {
    const body = inspectorBody.current;
    const trigger = activeTrigger.current;
    if (!selectedGroup || !body || !trigger || !window.matchMedia('(min-width: 48rem)').matches) return;

    const panel = body.getBoundingClientRect();
    const row = trigger.getBoundingClientRect();
    if (row.top < panel.top) body.scrollTop += row.top - panel.top;
    else if (row.bottom > panel.bottom) body.scrollTop += row.bottom - panel.bottom;
  }, [selectedGroup]);

  return (
    <aside aria-label="Building explorer" className="flex min-h-0 min-w-0 flex-col border-t bg-background md:border-t-0 md:border-l">
      <header className="shrink-0 border-b px-5 py-4">
        <p className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">EPFL · Digital twin</p>
        <h1 className="mt-1 text-xl font-semibold tracking-tight">BC Building</h1>
      </header>

      <div ref={inspectorBody} className="flex min-h-0 flex-1 flex-col gap-5 p-5 md:overflow-y-auto md:overscroll-contain md:[overflow-anchor:none] md:[scrollbar-gutter:stable]">
        <div className="flex shrink-0 flex-col gap-2">
          <label htmlFor="building-floor" className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">Floor</label>
          <Select value={floor === null ? 'all' : String(floor)} onValueChange={value => onFloorChange(value === 'all' ? null : Number(value))}>
            <SelectTrigger id="building-floor" className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent position="popper" className="w-(--radix-select-trigger-width)">
              <SelectGroup>
                <SelectItem value="all">Whole building</SelectItem>
                {floors.map(level => <SelectItem key={level} value={String(level)}>{floorLabel(level)}</SelectItem>)}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>

        <section aria-labelledby="equipment-heading" className="flex shrink-0 flex-col gap-2 border-t pt-4">
          <h2 id="equipment-heading" className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">Equipment · {location}</h2>
          <Accordion type="single" collapsible value={selectedGroup ?? ''}
            onValueChange={value => onSelectGroup(groups.find(group => group === value) ?? null)}
            className="flex flex-col gap-1.5 [&_[data-slot=accordion-trigger]>svg]:transition-none">
            {groups.map(group => {
              const Icon = icons[group];
              const change = draft.get(draftKey(floor, group));
              const { installed, choices } = equipmentForFloor(floor, group);
              return (
                <AccordionItem key={group} value={group} className="rounded-lg border bg-card last:border-b">
                                    <AccordionTrigger ref={selectedGroup === group ? activeTrigger : undefined} className="min-h-10 items-center gap-2 px-3 py-2 transition-none">
                    <span className="flex flex-1 items-center gap-2">
                      <Icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                      {equipmentLabels[group]}
                    </span>
                    {change && <><span className="sr-only">, change planned</span><span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-primary" /></>}
                  </AccordionTrigger>
                  <AccordionContent className="px-3 pb-2.5" style={{ animation: 'none' }}>
                    <fieldset className="flex min-w-0 flex-col gap-1">
                      <legend className="sr-only">{equipmentLabels[group]} options{isBuildingWide(group) ? ' for the whole building' : ''}</legend>
                      {[{ option_id: keepCurrent, name: installed?.name ?? 'Mixed equipment' }, ...choices.filter(option => option.option_id !== installed?.option_id)].map(option => (
                        <label key={option.option_id} className="flex min-h-8 cursor-pointer items-center gap-2 rounded-md border px-2 py-1 text-xs hover:bg-sidebar-accent has-checked:border-primary/50 has-checked:bg-primary/10 focus-within:outline-2 focus-within:outline-ring">
                          <input type="radio" name={`equipment-${group}`} className="size-4 shrink-0 accent-primary"
                            checked={(change?.option ?? keepCurrent) === option.option_id} onChange={() => onChooseOption(group, option.option_id)} />
                          <span>{option.name}</span>
                        </label>
                      ))}
                    </fieldset>
                  </AccordionContent>
                </AccordionItem>
              );
            })}
          </Accordion>
          {!selectedGroup && <p className="text-xs text-muted-foreground">Pick equipment here or click an outlined item in 3D.</p>}
        </section>
        {saved.length > 0 && (
          <section aria-labelledby="saved-configurations" className="flex shrink-0 flex-col gap-2 border-t pt-4">
            <h2 id="saved-configurations" className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">Saved configurations</h2>
            <ul className="flex flex-col gap-2">
              {saved.map(({ id, scenario }) => (
                <li key={id} className="flex items-start justify-between gap-2 rounded-lg border px-3 py-2 text-sm">
                  <details className="min-w-0">
                    <summary className="cursor-pointer">{configurationName(id)} <span className="text-xs text-muted-foreground">· {scenario.length}</span></summary>
                    <ul className="mt-2 flex flex-col gap-1 text-xs text-muted-foreground">
                      {scenario.map(swap => {
                        const level = swap.floor ?? null;
                        const option = equipmentForFloor(level, swap.group).choices.find(choice => choice.option_id === swap.option);
                        return <li key={draftKey(level, swap.group)}>{level === null ? 'Whole building' : floorLabel(level)} · {equipmentLabels[swap.group]}: {option?.name ?? swap.option}</li>;
                      })}
                    </ul>
                  </details>
                  <button type="button" aria-label={`Remove ${configurationName(id)}`} onClick={() => onRemoveConfiguration(id)} className="text-xs text-muted-foreground underline underline-offset-4">Remove</button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      <footer className="flex shrink-0 flex-col gap-2 border-t bg-background px-5 py-4">
        <Dialog>
          <DialogTrigger asChild>
            <button type="button" className="flex min-h-10 items-center gap-2.5 rounded-lg border bg-card px-4 py-2 text-left text-sm font-medium hover:bg-sidebar-accent focus-visible:outline-2 focus-visible:outline-ring">
              <ListChecks aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
              <span className="flex-1">Review changes</span>
              <span aria-live="polite" className="text-xs tabular-nums text-muted-foreground">{draft.size}</span>
            </button>
          </DialogTrigger>
          <DialogContent className="max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto]">
            <DialogHeader>
              <DialogTitle>Planned changes</DialogTitle>
              <DialogDescription>
                {draft.size === 0 ? 'No changes yet. Pick an equipment option to add one.'
                  : `${draft.size} ${draft.size === 1 ? 'change' : 'changes'} to test across the building.`}
              </DialogDescription>
            </DialogHeader>
            <div className="min-h-0 overflow-y-auto" role={draft.size ? 'region' : undefined}
              aria-label={draft.size ? 'Change details' : undefined} tabIndex={draft.size ? 0 : undefined}>
              {draft.size > 0 && (
                <ul className="flex flex-col gap-3 rounded-lg border bg-card px-3 py-2.5">
                  {changesByFloor(draft).map(({ level, changes }) => (
                    <li key={level ?? 'building'}>
                      <h3 className="text-sm font-semibold">{level === null ? 'Whole building' : floorLabel(level)}</h3>
                      <ul className="mt-1 ml-1.5 border-l pl-3">
                        {changes.map(([key, swap]) => {
                          const planned = equipmentForFloor(level, swap.group).choices.find(option => option.option_id === swap.option);
                          return (
                            <li key={key} className="relative py-0.5 text-xs before:absolute before:top-2.5 before:-left-3 before:w-2 before:border-t">
                              <span className="font-medium">{equipmentLabels[swap.group]}:</span>{' '}
                              <span className="text-muted-foreground">{planned?.name ?? swap.option}</span>
                            </li>
                          );
                        })}
                      </ul>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <button type="button" className="min-h-10 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                  Done
                </button>
              </DialogClose>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <button type="button" onClick={onSaveAndStartNew} disabled={!draft.size}
          className="min-h-10 rounded-lg border bg-card px-4 py-2 text-left text-sm font-medium hover:bg-sidebar-accent focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50">
          Save &amp; start new
        </button>
        <p role="status" className="text-xs text-muted-foreground">
          {storageError ? 'Browser storage is unavailable. Changes to saved configurations may not survive a reload.'
            : `${saved.length} saved${draft.size ? ' · Unsaved draft will also be simulated' : ''}`}
        </p>
        <ConfigurationComparison saved={saved} draft={draft} />
      </footer>
    </aside>
  );
}
