import { Edges } from '@react-three/drei';
import { useState } from 'react';
import { readSavedConfigurations, storeConfigurations, type SavedConfiguration } from './configurations';
import BuildingScene from '@/components/BuildingScene';
import { draftKey, isBuildingWide, lightingItems, type EquipmentGroup } from './equipment';

import BuildingInspector, { keepCurrent } from './BuildingInspector';
import ExteriorBlinds from './ExteriorBlinds';
import RoofEquipment from './RoofEquipment';

const selectableOutline = '#f5ad20';
const selectedOutline = '#b7530c'; // Matches the inspector's brand-orange selection.

export default function BuildingPage() {
  const [floor, setFloor] = useState<number | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<EquipmentGroup | null>(null);
  const [configurations, setConfigurations] = useState(() => {
    const saved = readSavedConfigurations();
    return saved.length ? saved : [{ id: 1, scenario: [] }];
  });
  const [activeId, setActiveId] = useState(() => configurations[0].id);
  const active = configurations.find(configuration => configuration.id === activeId) ?? configurations[0];
  const draft = new Map(active.scenario.map(swap => [draftKey(swap.floor ?? null, swap.group), swap]));
  const [storageError, setStorageError] = useState(false);
  const floorLights = lightingItems.filter(item => item.floor === floor);
  const solarDraft = draft.get(draftKey(null, 'solar_pv'));
  const showBanner = draft.get(draftKey(0, 'lauzhack_banner'))?.option === 'lauzhack_banner_add';

  function chooseOption(group: EquipmentGroup, option: string) {
    const key = draftKey(floor, group);
    const next = new Map(draft);
    if (option === keepCurrent) next.delete(key);
    else if (isBuildingWide(group)) next.set(key, { group, option });
    else if (floor !== null) next.set(key, { group, floor, option });
    saveConfigurations(configurations.map(configuration => configuration.id === active.id
      ? { ...configuration, scenario: Array.from(next.values()) }
      : configuration));
  }

  function saveConfigurations(next: SavedConfiguration[]) {
    setConfigurations(next);
    try {
      storeConfigurations(next);
      setStorageError(false);
    } catch {
      setStorageError(true);
    }
  }

  function createConfiguration() {
    const id = configurations.reduce((last, configuration) => Math.max(last, configuration.id), 0) + 1;
    saveConfigurations([...configurations, { id, scenario: [] }]);
    setActiveId(id);
    return id;
  }

  function removeConfiguration(id: number) {
    const remaining = configurations.filter(configuration => configuration.id !== id);
    if (!remaining.length) return;
    if (active.id === id) setActiveId(remaining[0].id);
    saveConfigurations(remaining);
  }

  function selectionFor(group: EquipmentGroup) {
    return {
      outline: selectedGroup === group ? selectedOutline : selectableOutline,
      onSelect: () => setSelectedGroup(group),
    };
  }

  return (
    <main aria-label="Building viewer" className="grid min-h-full grid-rows-[minmax(20rem,55dvh)_auto] md:h-full md:grid-cols-[minmax(0,1fr)_clamp(21rem,26vw,25rem)] md:grid-rows-[minmax(0,1fr)]">
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
      <BuildingInspector
        floor={floor}
        selectedGroup={selectedGroup}
        draft={draft}
        onFloorChange={level => {
          if (level === floor) return;
          setFloor(level);
          setSelectedGroup(null);
        }}
        onSelectGroup={setSelectedGroup}
        onChooseOption={chooseOption}
        configurations={configurations}
        activeId={active.id}
        storageError={storageError}
        onCreateConfiguration={createConfiguration}
        onEditConfiguration={setActiveId}
        onRemoveConfiguration={removeConfiguration}
      />
    </main>
  );
}
