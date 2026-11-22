import { Edges } from '@react-three/drei';
import { useEffect, useState } from 'react';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { readSavedConfigurations, storeConfigurations, type SavedConfiguration } from './configurations';
import BuildingScene from '@/components/BuildingScene';
import { draftKey, isBuildingWide, lightingItems, type EquipmentGroup } from './equipment';

import BuildingInspector, { keepCurrent } from './BuildingInspector';
import ExteriorBlinds from './ExteriorBlinds';
import RoofEquipment from './RoofEquipment';
import PlayPanel from './play/PlayPanel';
import { brokenNow, sceneView, usePlay } from './play/usePlay';

const selectableOutline = '#f5ad20';
const selectedOutline = '#b7530c'; // Matches the inspector's brand-orange selection.
const brokenOutline = '#d4361f'; // Play mode: equipment that just broke.

type Mode = 'plan' | 'play';
const MODE_KEY = 'building-mode';

function savedMode(): Mode {
  try { return sessionStorage.getItem(MODE_KEY) === 'play' ? 'play' : 'plan'; } catch { return 'plan'; }
}

export default function BuildingPage() {
  // Plan: choose upgrades and simulate them. Play: live through the next 15 years and react when something happens.
  const [mode, setMode] = useState<Mode>(savedMode);
  const play = usePlay(mode === 'play');
  const broken = mode === 'play' ? brokenNow(play.state) : [];
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
  const playSolar = [...(play.state?.plan.done ?? []), ...(play.state?.plan.planned ?? [])].some(swap => swap.group === 'solar_pv');
  const solarDraft = mode === 'play' ? playSolar : draft.get(draftKey(null, 'solar_pv'));
  const showBanner = mode === 'plan' && draft.get(draftKey(0, 'lauzhack_banner'))?.option === 'lauzhack_banner_add';

  function switchMode(next: Mode) {
    setMode(next);
    setSelectedGroup(null);
    try { sessionStorage.setItem(MODE_KEY, next); } catch { /* no storage */ }
  }

  // When the game stops because something broke, look at it: the floor (or roof) it's on.
  const pauseKey = play.state ? `${play.state.session_id}|${play.state.t}` : '';
  useEffect(() => {
    if (mode !== 'play' || !play.state) return;
    const first = play.state.reasons.find(reason => reason.type === 'failure' && reason.group
      && sceneView(reason.group, reason.floors) !== undefined);
    if (first?.group) {
      setFloor(sceneView(first.group, first.floors) ?? null);
      setSelectedGroup(null);
    }
  }, [pauseKey]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Outline colour for a group in the current view: red if it just broke here (play), brand if selected. */
  function outlineFor(group: EquipmentGroup) {
    if (broken.some(b => b.group === group && b.view === floor)) return brokenOutline;
    return selectedGroup === group ? selectedOutline : selectableOutline;
  }

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
      outline: outlineFor(group),
      onSelect: () => setSelectedGroup(group),
    };
  }

  return (
    <main aria-label="Building viewer" className="grid min-h-full grid-rows-[minmax(20rem,55dvh)_auto] md:h-full md:grid-cols-[minmax(0,1fr)_clamp(21rem,26vw,25rem)] md:grid-rows-[minmax(0,1fr)]">
      <div className="relative min-h-0">
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
              <Edges lineWidth={2} color={outlineFor('lighting')} />
            </mesh>
          ))}
        </BuildingScene>
        <ToggleGroup type="single" variant="outline" value={mode} aria-label="Mode"
          onValueChange={value => value && switchMode(value as Mode)}
          className="absolute top-3 left-3 bg-background/95 shadow-sm">
          <ToggleGroupItem value="plan" className="px-4">Plan</ToggleGroupItem>
          <ToggleGroupItem value="play" className="px-4">Play</ToggleGroupItem>
        </ToggleGroup>
      </div>
      {mode === 'play' ? (
        <PlayPanel play={play} floor={floor}
          onFloorChange={level => { if (level !== floor) { setFloor(level); setSelectedGroup(null); } }}
          selectedGroup={selectedGroup} onSelectGroup={group => setSelectedGroup(group as EquipmentGroup | null)} />
      ) : <BuildingInspector
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
      />}
    </main>
  );
}
