import { Edges } from '@react-three/drei';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import BuildingScene from '@/components/BuildingScene';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FLOOR_COUNT } from '@/data/building';
import { draftKey, equipmentForFloor, equipmentLabels, lightingItems, type EquipmentGroup, type EquipmentSwap } from './equipment';

const keepCurrent = 'keep-current';
const selectableOutline = '#f5ad20';
const selectedOutline = '#007eab';
const floorLabel = (floor: number) => floor === -1 ? 'Basement' : floor === 0 ? 'Ground floor' : `Floor ${floor}`;

export default function BuildingPage() {
  const [floor, setFloor] = useState<number | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<EquipmentGroup | null>(null);
  const [draft, setDraft] = useState(() => new Map<string, EquipmentSwap>());
  const navigate = useNavigate();
  const floorLights = lightingItems.filter(item => item.floor === floor);
  const equipment = floor !== null && selectedGroup ? equipmentForFloor(floor, selectedGroup) : null;

  function chooseOption(option: string) {
    if (floor === null || !selectedGroup) return;
    const key = draftKey(floor, selectedGroup);
    setDraft(previous => {
      const next = new Map(previous);
      if (option === keepCurrent) next.delete(key);
      else next.set(key, selectedGroup === 'water_heater'
        ? { group: selectedGroup, option }
        : { group: selectedGroup, floor, option });
      return next;
    });
  }

  function selectionFor(group: EquipmentGroup) {
    return {
      outline: selectedGroup === group ? selectedOutline : selectableOutline,
      onSelect: () => setSelectedGroup(group),
    };
  }

  return (
    <main aria-label="Building viewer" className="grid min-h-full grid-rows-[minmax(20rem,55dvh)_auto] md:h-full md:grid-cols-[minmax(0,1fr)_20rem] md:grid-rows-[minmax(0,1fr)]">
      <div className="min-h-0">
        <BuildingScene floor={floor} equipmentSelection={floor !== null ? {
          monitors: selectionFor('monitors'), computers: selectionFor('computers'), coffee: selectionFor('coffee'),
          water_heater: selectionFor('water_heater'),
        } : undefined}>
          {floor !== null && floorLights.map(item => (
            <mesh
              key={item.id}
              name={item.id}
              position={item.position}
              onClick={event => {
                event.stopPropagation();
                if (event.delta <= 4) setSelectedGroup('lighting');
              }}
            >
              <boxGeometry args={[.9, .25, .65]} />
              <meshBasicMaterial color="#e6e8e6" />
              <Edges lineWidth={2} color={selectedGroup === 'lighting' ? selectedOutline : selectableOutline} />
            </mesh>
          ))}
        </BuildingScene>
      </div>
      <aside aria-label="Building configuration" className="flex flex-col gap-5 border-t border-border bg-background p-5 md:overflow-y-auto md:border-t-0 md:border-l">
        <h1 className="text-lg font-semibold">Building configuration</h1>
        <div className="flex flex-col gap-2">
          <label htmlFor="building-floor" className="text-sm font-medium">Floor</label>
          <Select value={floor === null ? 'all' : String(floor)} onValueChange={value => {
            setFloor(value === 'all' ? null : Number(value));
            setSelectedGroup(null);
          }}>
            <SelectTrigger id="building-floor" className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="all">Whole building</SelectItem>
                <SelectItem value="-1">Basement</SelectItem>
                {Array.from({ length: FLOOR_COUNT }, (_, level) => (
                  <SelectItem key={level} value={String(level)}>{floorLabel(level)}</SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
        {equipment && selectedGroup && floor !== null ? (
          <section className="flex flex-col gap-2">
            <h2 className="font-medium">{equipmentLabels[selectedGroup]} · {floorLabel(floor)}</h2>
            <p className="text-sm text-muted-foreground">Installed: {equipment.installed?.name ?? 'Mixed equipment'}</p>
            <label htmlFor="equipment-option" className="text-sm font-medium">
              {selectedGroup === 'water_heater' ? 'Configuration for the whole building' : 'Configuration for the whole floor'}
            </label>
            <Select value={draft.get(draftKey(floor, selectedGroup))?.option ?? keepCurrent} onValueChange={chooseOption}>
              <SelectTrigger id="equipment-option" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent position="popper" className="w-(--radix-select-trigger-width)">
                <SelectGroup>
                  <SelectItem value={keepCurrent}>Keep current setup</SelectItem>
                  {equipment.choices.filter(option => option.option_id !== equipment.installed?.option_id).map(option => (
                    <SelectItem key={option.option_id} value={option.option_id}>{option.name}</SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </section>
        ) : (
          <p className="text-sm text-muted-foreground">
            {floor === null ? 'Choose a floor to see its equipment.'
              : floor === -1 ? 'Click the outlined hot-water tank to configure the building’s water heating.'
              : 'Click any outlined item to configure that equipment for the whole floor.'}
          </p>
        )}
        <div className="mt-auto flex flex-col gap-2 border-t border-border pt-4">
          <p aria-live="polite" className="text-sm text-muted-foreground">
            {draft.size} pending {draft.size === 1 ? 'change' : 'changes'}
          </p>
          <button
            type="button"
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            onClick={() => navigate(`/results?config=${encodeURIComponent(JSON.stringify({ scenario: Array.from(draft.values()) }))}`)}
          >
            Simulate
          </button>
          <p className="text-xs text-muted-foreground">Opens the results for these changes.</p>
        </div>
      </aside>
    </main>
  );
}
