// The panel beside the 3D building: your plans (made by hand or found by the assistant), a floor picker,
// and the equipment you can change on the floor in view.
import {
  ArrowRight, Blinds, Coffee, Fan, Flag, Heater, Lightbulb, MessageSquare, Monitor, PcCase, Plus, Server, Sun, X,
} from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Button } from '@/components/ui/button';
import { FLOOR_COUNT } from '@/data/building';
import { cn } from '@/lib/utils';
import { groupedChanges, PLAN_COLORS, planColor, resultsHref } from '@/twin/plans';
import { useTwin } from '@/twin/TwinProvider';
import { draftKey, equipmentForFloor, equipmentLabels, isBuildingWide, type EquipmentGroup, type EquipmentSwap } from './equipment';
import BuildingToday from './BuildingToday';
import { levelName, pinLevel } from './PlanPins';

export const keepCurrent = 'keep-current';
/** Top floor first, like the buttons in a lift; null is the whole building. */
const levels: (number | null)[] = [null, ...Array.from({ length: FLOOR_COUNT + 1 }, (_, index) => FLOOR_COUNT - 1 - index)];
const shortLevel = (level: number | null) => level === null ? 'All' : level === 0 ? 'G' : level === -1 ? 'B' : String(level);
const icons = {
  ventilation: Fan, blinds: Blinds, solar_pv: Sun, water_heater: Heater, servers: Server,
  lighting: Lightbulb, monitors: Monitor, computers: PcCase, coffee: Coffee, lauzhack_banner: Flag,
};

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
  onGoTo: (level: number | null, group: string | null) => void;
}

function Plans({ onGoTo }: { onGoTo: (level: number | null, group: string | null) => void }) {
  const { plans, activePlan, setActivePlan, createPlan, removePlan, catalog } = useTwin();
  return (
    <section aria-labelledby="plans-heading" className="flex max-h-[44%] shrink-0 flex-col border-b">
      <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b px-4">
        <h2 id="plans-heading" className="text-sm font-semibold">Plans</h2>
        <Button variant="ghost" size="xs" onClick={createPlan} disabled={plans.length >= PLAN_COLORS.length}
          className="text-muted-foreground hover:text-foreground">
          <Plus data-icon="inline-start" /> New plan
        </Button>
      </div>
      {/* The list fades out at the bottom edge when it scrolls, so a cut row reads as "more below". */}
      <ul className="flex min-h-0 flex-col gap-1 overflow-y-auto overscroll-contain px-2 py-2 [mask-image:linear-gradient(to_bottom,black_calc(100%-1.25rem),transparent)]">
        {plans.map(plan => {
          const active = plan.id === activePlan.id;
          const color = planColor(plans, plan.id);
          const n = plan.scenario.length;
          return (
            <li key={plan.id} className="flex flex-col">
              <div className={cn('group flex items-center gap-1 rounded-lg transition-colors',
                active ? 'bg-card shadow-[inset_0_0_0_1px_var(--border),0_1px_2px_oklch(0_0_0/0.04)]' : 'hover:bg-secondary/80')}>
                <button type="button" onClick={() => setActivePlan(plan.id)} aria-pressed={active}
                  className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2 py-1.5 text-left focus-visible:outline-2 focus-visible:outline-ring">
                  <span aria-hidden="true" className="size-2.5 shrink-0 rounded-full"
                    style={color ? { background: color } : { boxShadow: 'inset 0 0 0 1.5px var(--muted-foreground)' }} />
                  <span className="flex min-w-0 flex-1 flex-col leading-tight">
                    <span className="truncate text-sm font-medium">{plan.name}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {n === 0 ? 'No changes yet' : `${n} ${n === 1 ? 'change' : 'changes'}`}
                      {plan.source === 'assistant' && ' · from the assistant'}
                    </span>
                  </span>
                  {active && <span className="text-xs font-medium text-muted-foreground">Editing</span>}
                </button>
                {plans.length > 1 && (
                  <button type="button" onClick={() => removePlan(plan.id)} aria-label={`Remove ${plan.name}`} title="Remove plan"
                    className="mr-1 grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:bg-secondary hover:text-foreground focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-ring">
                    <X className="size-3.5" />
                  </button>
                )}
              </div>
              {active && n > 0 && (
                <ul aria-label={`Changes in ${plan.name}`} className="mt-1 mb-2 ml-[1.1rem] flex flex-col border-l pl-2">
                  {groupedChanges(plan.scenario, catalog).map(row => (
                    <li key={`${row.group}-${row.option}`}>
                      <button type="button" onClick={() => onGoTo(pinLevel(row.first), row.group)}
                        className="flex w-full min-w-0 flex-col rounded-md px-2 py-1 text-left hover:bg-secondary/80 focus-visible:outline-2 focus-visible:outline-ring">
                        <span className="truncate text-[13px]"><span className="font-medium">{row.label}</span> <span className="text-muted-foreground">→ {row.name}</span></span>
                        <span className="truncate text-xs text-muted-foreground">{row.where}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export default function BuildingInspector({ floor, selectedGroup, draft, onFloorChange, onSelectGroup, onChooseOption, onGoTo }: BuildingInspectorProps) {
  const twin = useTwin();
  const { plans, activePlan, storageError } = twin;
  const navigate = useNavigate();
  const inspectorBody = useRef<HTMLDivElement>(null);
  const activeTrigger = useRef<HTMLButtonElement>(null);
  const groups = equipmentGroups(floor);
  const color = planColor(plans, activePlan.id) ?? 'var(--primary)';
  const changedLevels = new Set(activePlan.scenario.map(pinLevel));
  const withChanges = plans.filter(plan => plan.scenario.length > 0);

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
    <aside aria-label="Plans and equipment" className="flex min-h-0 min-w-0 flex-col border-t bg-background md:border-t-0 md:border-l">
      <Plans onGoTo={onGoTo} />

      <div ref={inspectorBody} className="flex min-h-0 flex-1 flex-col gap-4 p-4 md:overflow-y-auto md:overscroll-contain md:[overflow-anchor:none] md:[scrollbar-gutter:stable]">
        <div role="radiogroup" aria-label="Floor" className="grid grid-cols-7 gap-0.5 rounded-lg bg-secondary p-0.5 shadow-[inset_0_0_0_1px_var(--border)]">
          {levels.map(level => {
            const checked = floor === level;
            return (
              <button key={String(level)} type="button" role="radio" aria-checked={checked} onClick={() => onFloorChange(level)}
                aria-label={levelName(level)} title={levelName(level)}
                className={cn('relative h-8 rounded-md text-sm font-medium tabular-nums transition-colors focus-visible:outline-2 focus-visible:outline-ring',
                  checked ? 'bg-card text-foreground shadow-[0_1px_2px_oklch(0_0_0/0.08),inset_0_0_0_1px_var(--border)]' : 'text-muted-foreground hover:text-foreground')}>
                {shortLevel(level)}
                {changedLevels.has(level) && <span aria-hidden="true" className="absolute top-1 right-1 size-1.5 rounded-full" style={{ background: color }} />}
              </button>
            );
          })}
        </div>

        <section aria-labelledby="equipment-heading" className="flex shrink-0 flex-col gap-2">
          <h2 id="equipment-heading" className="text-sm font-semibold">{levelName(floor)}</h2>
          <Accordion type="single" collapsible value={selectedGroup ?? ''}
            onValueChange={value => onSelectGroup(groups.find(group => group === value) ?? null)}
            className="flex flex-col gap-1.5 [&_[data-slot=accordion-trigger]>svg]:transition-none">
            {groups.map(group => {
              const Icon = icons[group];
              const change = draft.get(draftKey(floor, group));
              const { installed, choices } = equipmentForFloor(floor, group);
              const planned = change && choices.find(option => option.option_id === change.option);
              const scope = isBuildingWide(group) ? 'the whole building' : levelName(floor).toLowerCase();
              return (
                <AccordionItem key={group} value={group} className="rounded-lg border bg-card last:border-b">
                  <AccordionTrigger ref={selectedGroup === group ? activeTrigger : undefined} className="min-h-10 min-w-0 items-center gap-2 px-3 py-2 transition-none hover:no-underline">
                    <span className="flex min-w-0 flex-1 items-center gap-2.5">
                      <Icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                      <span className="flex min-w-0 flex-col">
                        <span>{equipmentLabels[group]}</span>
                        {planned && (
                          <span className="flex min-w-0 items-center gap-1.5 text-xs font-normal text-muted-foreground">
                            <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full" style={{ background: color }} />
                            <span className="sr-only">, change planned:</span>
                            <span className="truncate">{planned.name}</span>
                          </span>
                        )}
                      </span>
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="flex flex-col gap-2 px-3 pb-3" style={{ animation: 'none' }}>
                    <fieldset className="flex min-w-0 flex-col gap-1">
                      <legend className="sr-only">{equipmentLabels[group]} options for {scope}</legend>
                      {[{ option_id: keepCurrent, name: installed?.name ?? 'Mixed equipment' }, ...choices.filter(option => option.option_id !== installed?.option_id)].map(option => (
                        <label key={option.option_id} className="flex min-h-8 cursor-pointer items-center gap-2 rounded-md border px-2 py-1 text-xs hover:bg-secondary/70 has-checked:border-primary/50 has-checked:bg-primary/8 focus-within:outline-2 focus-within:outline-ring">
                          <input type="radio" name={`equipment-${group}`} className="size-4 shrink-0 accent-primary"
                            checked={(change?.option ?? keepCurrent) === option.option_id} onChange={() => onChooseOption(group, option.option_id)} />
                          <span className="flex-1">{option.name}</span>
                          {option.option_id === keepCurrent && <span className="text-[11px] text-muted-foreground">Today</span>}
                        </label>
                      ))}
                    </fieldset>
                    <button type="button" disabled={twin.pending !== null}
                      onClick={() => void twin.send(`Which ${equipmentLabels[group].toLowerCase()} option pays back fastest for ${scope}?`)}
                      className="flex w-fit items-center gap-1.5 rounded-md px-1 py-0.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-ring">
                      <MessageSquare aria-hidden="true" className="size-3.5" />
                      Ask which pays back fastest
                    </button>
                  </AccordionContent>
                </AccordionItem>
              );
            })}
          </Accordion>
          {!selectedGroup && <p className="text-xs text-muted-foreground">Pick equipment here, or click an outlined part in 3D.</p>}
        </section>

        {floor === null && <BuildingToday />}
      </div>

      <footer className="flex shrink-0 flex-col gap-2 border-t bg-background px-4 py-3.5">
        <Button size="lg" className="w-full justify-between" onClick={() => navigate(resultsHref(plans, activePlan.id), { state: { intro: true } })}>
          {withChanges.length > 1 ? `Compare ${Math.min(withChanges.length, PLAN_COLORS.length)} plans` : withChanges.length === 1 ? 'See what it changes' : 'See today’s results'}
          <ArrowRight data-icon="inline-end" />
        </Button>
        {storageError && <p role="status" className="text-xs text-muted-foreground">Browser storage is unavailable. Changes may not survive a reload.</p>}
      </footer>
    </aside>
  );
}
