import { Edges } from '@react-three/drei';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import BuildingScene from '@/components/BuildingScene';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FLOOR_COUNT } from '@/data/building';
import { draftKey, equipmentForFloor, equipmentLabels, isBuildingWide, lightingItems, type EquipmentGroup, type EquipmentSwap } from './equipment';

import ExteriorBlinds from './ExteriorBlinds';
import RoofEquipment from './RoofEquipment';

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
  const equipment = selectedGroup ? equipmentForFloor(floor, selectedGroup) : null;
  const solarDraft = draft.get(draftKey(null, 'solar_pv'));
  const showBanner = draft.get(draftKey(0, 'lauzhack_banner'))?.option === 'lauzhack_banner_add';

  function chooseOption(group: EquipmentGroup, option: string) {
    const key = draftKey(floor, group);
    setDraft(previous => {
      const next = new Map(previous);
      if (option === keepCurrent) next.delete(key);
      else if (isBuildingWide(group)) next.set(key, { group, option });
      else if (floor !== null) next.set(key, { group, floor, option });
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
        <BuildingScene floor={floor} showBanner={showBanner} equipmentSelection={floor !== null ? {
          monitors: selectionFor('monitors'), computers: selectionFor('computers'), coffee: selectionFor('coffee'),
          water_heater: selectionFor('water_heater'), servers: selectionFor('servers'),
        } : undefined}>
          {floor === null && <>
            <RoofEquipment ventilation={selectionFor('ventilation')} solar={solarDraft ? selectionFor('solar_pv') : undefined} />
            <ExteriorBlinds {...selectionFor('blinds')} />
          </>}
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
        {floor === 0 && (
          <button type="button" className="rounded-md border border-input px-4 py-2 text-sm font-medium hover:bg-accent"
            onClick={() => chooseOption('lauzhack_banner', showBanner ? keepCurrent : 'lauzhack_banner_add')}>
            {showBanner ? 'Remove the LauzHack banner' : 'Hang the LauzHack banner'}
          </button>
        )}
        {floor === null && !solarDraft && (
          <button type="button" className="rounded-md border border-input px-4 py-2 text-sm font-medium hover:bg-accent"
            onClick={() => {
              chooseOption('solar_pv', 'solar_pv_upgrade');
              setSelectedGroup('solar_pv');
            }}>
            Add solar panels
          </button>
        )}
        {equipment && selectedGroup ? (
          <section className="flex flex-col gap-2">
            <h2 className="font-medium">{equipmentLabels[selectedGroup]} · {isBuildingWide(selectedGroup) || floor === null ? 'Whole building' : floorLabel(floor)}</h2>
            <p className="text-sm text-muted-foreground">Installed: {equipment.installed?.name ?? 'Mixed equipment'}</p>
            <label htmlFor="equipment-option" className="text-sm font-medium">
              {isBuildingWide(selectedGroup) ? 'Configuration for the whole building' : 'Configuration for the whole floor'}
            </label>
            <Select value={draft.get(draftKey(floor, selectedGroup))?.option ?? keepCurrent} onValueChange={option => chooseOption(selectedGroup, option)}>
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
            {floor === null ? 'Click outlined rooftop equipment or a window blind, or choose a floor.'
              : floor === -1 ? 'Click an outlined hot-water tank or server rack to configure that equipment.'
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
