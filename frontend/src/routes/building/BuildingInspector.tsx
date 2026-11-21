import { Blinds, Coffee, Fan, Flag, Heater, Lightbulb, ListChecks, Monitor, PcCase, Server, Sun } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
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

function changesByFloor(scenario: EquipmentSwap[]) {
  const groups = new Map<number | null, EquipmentSwap[]>();
  for (const swap of scenario) {
    const level = isBuildingWide(swap.group) ? null : swap.floor ?? null;
    const changes = groups.get(level);
    if (changes) changes.push(swap);
    else groups.set(level, [swap]);
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
  configurations: SavedConfiguration[];
  activeId: number;
  storageError: boolean;
  onCreateConfiguration: () => number;
  onEditConfiguration: (id: number) => void;
  onRemoveConfiguration: (id: number) => void;
}

export default function BuildingInspector({ floor, selectedGroup, draft, onFloorChange, onSelectGroup, onChooseOption,
  configurations, activeId, storageError, onCreateConfiguration, onEditConfiguration, onRemoveConfiguration }: BuildingInspectorProps) {
  const [reviewed, setReviewed] = useState('');
  const [showResults, setShowResults] = useState(false);
  const dialogTitle = useRef<HTMLHeadingElement>(null);
  const hasAlternatives = configurations.some(({ scenario }) => scenario.length > 0);
  const reviewList = useRef<HTMLDivElement>(null);
  const reviewedItem = useRef<HTMLDivElement>(null);
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

  useLayoutEffect(() => {
    const list = reviewList.current;
    const item = reviewedItem.current;
    if (!list || !item) return;

    // Keep scrolling inside the dialog and position the new item before paint.
    const viewport = list.getBoundingClientRect();
    const row = item.getBoundingClientRect();
    if (row.top < viewport.top || row.height > list.clientHeight) {
      list.scrollTop += row.top - viewport.top;
    } else if (row.bottom > viewport.bottom) {
      list.scrollTop += row.bottom - viewport.bottom;
    }
  }, [reviewed, configurations.length, showResults]);

  useLayoutEffect(() => {
    dialogTitle.current?.focus({ preventScroll: true });
  }, [showResults]);

  return (
    <aside aria-label="Building explorer" className="flex min-h-0 min-w-0 flex-col border-t bg-background md:border-t-0 md:border-l">
      <header className="flex shrink-0 items-center justify-between gap-2 border-b px-5 py-4">
        <h1 className="text-xl font-semibold tracking-tight">BC Building</h1>
        <Select value={floor === null ? 'all' : String(floor)} onValueChange={value => onFloorChange(value === 'all' ? null : Number(value))}>
          <SelectTrigger aria-label="Floor" className="w-36 max-w-[55%]"><SelectValue /></SelectTrigger>
          <SelectContent position="popper" align="end" className="w-(--radix-select-trigger-width)">
            <SelectGroup>
              <SelectItem value="all">Whole building</SelectItem>
              {floors.map(level => <SelectItem key={level} value={String(level)}>{floorLabel(level)}</SelectItem>)}
            </SelectGroup>
          </SelectContent>
        </Select>
      </header>

      <div ref={inspectorBody} className="flex min-h-0 flex-1 flex-col gap-5 p-5 md:overflow-y-auto md:overscroll-contain md:[overflow-anchor:none] md:[scrollbar-gutter:stable]">
        <section aria-labelledby="equipment-heading" className="flex shrink-0 flex-col gap-2">
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
      </div>

      <footer className="flex shrink-0 flex-col gap-2 border-t bg-background px-5 py-4">
        <Dialog onOpenChange={open => {
          if (!open) return;
          setReviewed(String(activeId));
          setShowResults(false);
        }}>
          <DialogTrigger asChild>
            <button type="button" className="flex min-h-10 items-center gap-2.5 rounded-lg bg-primary px-4 py-2 text-left text-sm font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
              <ListChecks aria-hidden="true" className="size-4 shrink-0" />
              <span>Review configurations</span>
            </button>
          </DialogTrigger>
          <DialogContent
            className={showResults
              ? 'h-[min(28rem,calc(100dvh-2rem))] grid-rows-[auto_minmax(0,1fr)_auto] sm:max-w-5xl'
              : 'h-[min(28rem,calc(100dvh-2rem))] grid-rows-[auto_minmax(0,1fr)_auto]'}>
            <DialogHeader className="pr-5">
              <DialogTitle ref={dialogTitle} tabIndex={-1}>
                {showResults ? 'Simulation results' : 'Building configurations'}
              </DialogTitle>
              <DialogDescription>
                {showResults
                  ? 'Energy, air quality and operating costs are for the first year. Savings are measured against the current setup.'
                  : <>Open a configuration to see its planned changes.{' '}
                    {storageError ? 'Browser storage is unavailable. Changes may not survive a reload.' : 'Equipment changes are saved automatically in this browser.'}</>}
              </DialogDescription>
            </DialogHeader>
            {showResults ? <ConfigurationComparison configurations={configurations} /> : (
              <Accordion ref={reviewList} type="single" collapsible value={reviewed} onValueChange={setReviewed}
                className="flex min-h-0 flex-col gap-2 overflow-y-auto overscroll-contain p-1 [overflow-anchor:none] [scrollbar-gutter:stable]">
                {configurations.map(({ id, scenario }, index) => (
                  <AccordionItem key={id} ref={reviewed === String(id) ? reviewedItem : undefined}
                    value={String(id)} className="shrink-0 rounded-lg border last:border-b">
                    <AccordionTrigger className="items-center gap-2 px-3 py-2">
                      <span className="flex-1">{configurationName(index + 1)}</span>
                      <span className="text-xs font-normal text-muted-foreground">
                        {activeId === id && 'Editing · '}{scenario.length} {scenario.length === 1 ? 'change' : 'changes'}
                      </span>
                    </AccordionTrigger>
                    <AccordionContent className="flex flex-col gap-3 px-3 pb-3" style={{ animation: 'none' }}>
                      {scenario.length === 0 ? (
                        <p className="text-xs text-muted-foreground">No changes yet. Pick equipment in the building view to add some.</p>
                      ) : (
                        <ul className="flex flex-col gap-3">
                          {changesByFloor(scenario).map(({ level, changes }) => (
                            <li key={level ?? 'building'}>
                              <h3 className="text-sm font-semibold">{level === null ? 'Whole building' : floorLabel(level)}</h3>
                              <ul className="mt-1 border-l pl-3">
                                {changes.map(swap => {
                                  const planned = equipmentForFloor(level, swap.group).choices.find(option => option.option_id === swap.option);
                                  return (
                                    <li key={draftKey(level, swap.group)} className="py-0.5 text-xs">
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
                      {configurations.length > 1 && (
                        <div className="flex flex-wrap items-center gap-2">
                          {activeId !== id && (
                            <DialogClose asChild>
                              <button type="button" onClick={() => onEditConfiguration(id)}
                                className="rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-sidebar-accent focus-visible:outline-2 focus-visible:outline-ring">
                                Edit
                              </button>
                            </DialogClose>
                          )}
                          <button type="button" aria-label={'Remove ' + configurationName(index + 1)}
                            onClick={() => {
                              const next = configurations.find(configuration => configuration.id === activeId && configuration.id !== id)
                                ?? configurations.find(configuration => configuration.id !== id);
                              onRemoveConfiguration(id);
                              setReviewed(String(next?.id ?? ''));
                            }}
                            className="ml-auto rounded-md border border-status-expired bg-status-expired/20 px-3 py-1.5 text-xs font-medium text-foreground hover:bg-status-expired/35 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                            Remove
                          </button>
                        </div>
                      )}
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            )}
            <DialogFooter>
              {showResults ? (
                <button type="button" onClick={() => setShowResults(false)}
                  className="min-h-10 rounded-lg border bg-card px-4 text-sm font-medium hover:bg-sidebar-accent focus-visible:outline-2 focus-visible:outline-ring">
                  Back to configurations
                </button>
              ) : (
                <>
                  <button type="button" onClick={() => setReviewed(String(onCreateConfiguration()))}
                    className="min-h-10 rounded-lg border bg-card px-4 text-sm font-medium hover:bg-sidebar-accent focus-visible:outline-2 focus-visible:outline-ring">
                    + New configuration
                  </button>
                  <button type="button" onClick={() => setShowResults(true)}
                    className="min-h-10 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                    {hasAlternatives ? 'Simulate and compare' : 'Simulate current setup'}
                  </button>
                </>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>
        {storageError && <p role="status" className="text-xs text-muted-foreground">Browser storage is unavailable. Changes may not survive a reload.</p>}
      </footer>
    </aside>
  );
}
