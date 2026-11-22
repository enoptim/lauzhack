import { Edges } from '@react-three/drei';
import { ArrowLeft } from 'lucide-react';
import { useState } from 'react';
import BuildingScene from '@/components/BuildingScene';
import { usePublishFocus, useTwin, type Focus } from '@/twin/TwinProvider';
import { equipmentForFloor, equipmentLabels, isBuildingWide, lightingItems, plannedFor, withChoice, type EquipmentGroup } from './equipment';
import BuildingInspector, { keepCurrent } from './BuildingInspector';
import ExteriorBlinds from './ExteriorBlinds';
import PlanPins, { levelName } from './PlanPins';
import RoofEquipment from './RoofEquipment';

const selectableOutline = '#f5ad20';
const selectedOutline = '#b7530c'; // Matches the inspector's brand-orange selection.

/** What the assistant should know about the view, and what it could usefully be asked here. */
function focusFor(floor: number | null, group: EquipmentGroup | null): Focus {
  const where = levelName(floor);
  if (!group) {
    return floor === null ? {
      label: 'Whole building',
      describe: 'The user is in the 3D building view, looking at the whole building from outside.',
      suggestions: ['Which single upgrades pay back fastest?', 'Cheapest way to cut our energy bill by 10%?'],
    } : {
      label: where,
      describe: `The user is in the 3D building view, looking inside ${where.toLowerCase()}.`,
      suggestions: [`What is worth changing on ${where.toLowerCase()}?`],
    };
  }
  const label = equipmentLabels[group];
  const { installed, choices } = equipmentForFloor(floor, group);
  const scope = isBuildingWide(group) ? 'the whole building' : where.toLowerCase();
  return {
    label: `${isBuildingWide(group) ? 'Whole building' : where} · ${label}`,
    describe: `The user is in the 3D building view, looking at the ${label.toLowerCase()} (group "${group}") for ${scope}`
      + `${floor !== null && !isBuildingWide(group) ? ` (floor ${floor})` : ''}. Installed now: ${installed?.name ?? 'mixed equipment'}.`
      + ` Options: ${choices.map(option => `${option.name} (${option.option_id})`).join('; ')}.`,
    suggestions: [`Which ${label.toLowerCase()} option pays back fastest for ${scope}?`, `Is new ${label.toLowerCase()} worth it for ${scope}?`],
  };
}

export default function BuildingPage() {
  const twin = useTwin();
  const { activePlan } = twin;
  const [floor, setFloor] = useState<number | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<EquipmentGroup | null>(null);
  const scenario = activePlan.scenario;
  const color = activePlan.color;
  const floorLights = lightingItems.filter(item => item.floor === floor);
  const planned = (group: EquipmentGroup, level = floor) => plannedFor(scenario, level, group);
  const solar = planned('solar_pv', null);
  const banner = plannedFor(scenario, 0, 'lauzhack_banner');
  const showBanner = banner !== 'mixed' && banner?.option === 'lauzhack_banner_add';

  usePublishFocus(focusFor(floor, selectedGroup));

  function chooseOption(group: EquipmentGroup, option: string) {
    twin.setScenario(activePlan.id, withChoice(scenario, floor, group, option === keepCurrent ? null : option));
  }

  function goTo(level: number | null, group?: string | null) {
    if (level !== floor) setFloor(level);
    setSelectedGroup(group && group in equipmentLabels ? group as EquipmentGroup : null);
  }

  /** Planned equipment wears the plan's colour; the open one is darker. */
  function outlineFor(group: EquipmentGroup) {
    if (selectedGroup === group) return selectedOutline;
    const choice = planned(group);
    const installed = equipmentForFloor(floor, group).installed?.option_id;
    return choice && (choice === 'mixed' || choice.option !== installed) ? color : selectableOutline;
  }

  function selectionFor(group: EquipmentGroup) {
    return { outline: outlineFor(group), onSelect: () => setSelectedGroup(group) };
  }

  return (
    <main aria-label="Building viewer" className="grid min-h-full grid-rows-[minmax(20rem,55dvh)_auto] md:h-full md:grid-cols-[minmax(0,1fr)_clamp(20rem,25vw,24rem)] md:grid-rows-[minmax(0,1fr)]">
      <div className="relative min-h-0">
        <BuildingScene floor={floor} showBanner={showBanner} equipmentSelection={floor !== null ? {
          monitors: selectionFor('monitors'), computers: selectionFor('computers'), coffee: selectionFor('coffee'),
          water_heater: selectionFor('water_heater'), servers: selectionFor('servers'),
        } : undefined}>
          {floor === null && <>
            <RoofEquipment ventilation={selectionFor('ventilation')} solar={solar && solar !== 'mixed' && solar.option !== 'solar_pv_none' ? selectionFor('solar_pv') : undefined} />
            <ExteriorBlinds {...selectionFor('blinds')} />
            <PlanPins scenario={activePlan.scenario} color={color} onPick={goTo} />
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
              <Edges lineWidth={2} color={outlineFor('lighting')} />
            </mesh>
          ))}
        </BuildingScene>
        {floor !== null && (
          <button type="button" onClick={() => goTo(null)}
            className="absolute top-3 left-3 flex h-8 items-center gap-2 rounded-lg border bg-card/95 px-3 text-sm font-medium shadow-sm backdrop-blur-sm hover:bg-card focus-visible:outline-2 focus-visible:outline-ring">
            <ArrowLeft aria-hidden="true" className="size-4" /> Whole building
          </button>
        )}
      </div>
      <BuildingInspector
        floor={floor}
        selectedGroup={selectedGroup}
        planned={planned}
        onFloorChange={level => goTo(level)}
        onSelectGroup={setSelectedGroup}
        onChooseOption={chooseOption}
        onGoTo={goTo}
      />
    </main>
  );
}
