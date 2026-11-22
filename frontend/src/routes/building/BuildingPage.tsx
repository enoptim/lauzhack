import { Edges } from '@react-three/drei';
import { ArrowLeft } from 'lucide-react';
import { useEffect, useState } from 'react';
import BuildingScene from '@/components/BuildingScene';
import { usePublishFocus, useTwin, type Focus } from '@/twin/TwinProvider';
import { equipmentForFloor, equipmentLabels, isBuildingWide, lightingItems, optionOf, plannedFor, withChoice, type EquipmentGroup } from './equipment';
import BuildingInspector, { keepCurrent } from './BuildingInspector';
import ExteriorBlinds from './ExteriorBlinds';
import PlanPins, { levelName } from './PlanPins';
import RoofEquipment from './RoofEquipment';
import { EndCard, EventCard, StartCard } from './play/Overlays';
import PlayChart from './play/PlayChart';
import PlayHud from './play/PlayHud';
import PlayPanel from './play/PlayPanel';
import { usePathPlan } from './play/usePathPlan';
import { brokenNow, DEMO_FUTURE, sceneView, usePlay, type Play } from './play/usePlay';

const selectableOutline = '#f5ad20';
const selectedOutline = '#b7530c'; // Matches the inspector's brand-orange selection.
const brokenOutline = '#d4361f'; // Play: equipment that just broke.

/** In Play, the assistant hears what happened at this stop. */
function playFocus(play: Play): Focus {
  const state = play.state;
  if (!state) return { label: 'Explore', describe: 'The user is about to explore the next years of the building, one stop at a time.', suggestions: [] };
  const happened = state.reasons.map(reason => reason.title).join('; ');
  return {
    label: state.ended ? 'Explore · the end' : `Explore · year ${state.t}`,
    describe: `The user is exploring one future of the building, ${state.horizon} years long, now at the end of year ${state.t}.`
      + (happened ? ` What just happened: ${happened}.` : '') + ` Changes so far: ${state.decisions.length}.`,
    suggestions: happened ? ['What should I do about this?'] : [],
  };
}

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

/** The 3D building. mode "play": live through the next years, with the game panel instead of the plan inspector. */
export default function BuildingPage({ mode = 'plan' }: { mode?: 'plan' | 'play' }) {
  const twin = useTwin();
  const playing = mode === 'play';
  const play = usePlay(playing);
  const broken = playing ? brokenNow(play.state) : [];
  const { activePlan } = twin;
  const [floor, setFloor] = useState<number | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<EquipmentGroup | null>(null);
  const scenario = activePlan.scenario;
  const color = activePlan.color;
  const floorLights = lightingItems.filter(item => item.floor === floor);
  const planned = (group: EquipmentGroup, level = floor) => plannedFor(scenario, level, group);
  const solar = playing
    ? [...(play.state?.plan.done ?? []), ...(play.state?.plan.planned ?? [])].find(swap => swap.group === 'solar_pv')
    : planned('solar_pv', null);
  const banner = plannedFor(scenario, 0, 'lauzhack_banner');
  const showBanner = optionOf(banner) === 'lauzhack_banner_add';

  usePublishFocus(playing ? playFocus(play) : focusFor(floor, selectedGroup));

  // Which future this is: "Future 4821" for a drawn one, so people can see each run is new.
  const seed = /seed (\d+)/.exec(play.state?.future ?? '')?.[1];
  const which = !play.state ? null : seed ? `Future ${seed}` : 'Demo story';
  const path = usePathPlan(play, which);
  const game = playing ? play.state : null;

  function startGame(years: number, withPlan: boolean) {
    // Every run draws a new future. ?story=demo plays the fixed demo story instead (handy to rehearse).
    const demo = new URLSearchParams(window.location.search).get('story') === 'demo';
    play.start(demo ? DEMO_FUTURE : { seed: Math.floor(Math.random() * 1e4) }, years, withPlan ? activePlan.scenario : undefined);
  }

  // Space moves time on, as in a game. Not while typing, and not while the simulation is busy.
  useEffect(() => {
    if (!playing) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.code !== 'Space' || event.repeat || target?.closest('input, textarea, select, button, [contenteditable="true"]')) return;
      if (!play.state || play.state.ended || play.busy !== null) return;
      event.preventDefault();
      play.next();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Play: when the game stops because something broke, look at it (its floor, or the roof).
  const pauseKey = play.state ? `${play.state.session_id}|${play.state.t}` : '';
  useEffect(() => {
    if (!playing || !play.state) return;
    const first = play.state.reasons.find(reason => reason.type === 'failure' && reason.group
      && sceneView(reason.group, reason.floors) !== undefined);
    if (first?.group) {
      setFloor(sceneView(first.group, first.floors) ?? null);
      setSelectedGroup(null);
    }
  }, [pauseKey]); // eslint-disable-line react-hooks/exhaustive-deps

  function chooseOption(group: EquipmentGroup, option: string) {
    twin.setScenario(activePlan.id, withChoice(scenario, floor, group, option === keepCurrent ? null : option));
  }

  function goTo(level: number | null, group?: string | null) {
    if (level !== floor) setFloor(level);
    setSelectedGroup(group && group in equipmentLabels ? group as EquipmentGroup : null);
  }

  /** Planned equipment wears the plan's colour; the open one is darker. */
  function outlineFor(group: EquipmentGroup) {
    if (broken.some(b => b.group === group && b.view === floor)) return brokenOutline;
    if (selectedGroup === group) return selectedOutline;
    if (playing) return selectableOutline;
    const choice = planned(group);
    const installed = equipmentForFloor(floor, group).installed?.option_id;
    return choice && (choice === 'mixed' || optionOf(choice) !== installed) ? color : selectableOutline;
  }

  function selectionFor(group: EquipmentGroup) {
    return { outline: outlineFor(group), onSelect: () => setSelectedGroup(group) };
  }

  return (
    <main aria-label="Building viewer" className={playing
      ? `results-root grid min-h-full md:h-full md:grid-rows-[minmax(0,1fr)] ${game ? 'md:grid-cols-[minmax(0,1fr)_clamp(22rem,28vw,28rem)]' : ''}`
      : 'grid min-h-full grid-rows-[minmax(20rem,55dvh)_auto] md:h-full md:grid-cols-[minmax(0,1fr)_clamp(20rem,25vw,24rem)] md:grid-rows-[minmax(0,1fr)]'}>
      <div className={playing ? 'flex min-h-[32rem] min-w-0 flex-col md:min-h-0' : 'contents'}>
      {game && <PlayHud state={game} stops={play.stops} which={which} />}
      <div className="relative min-h-0 flex-1">
        <BuildingScene floor={floor} showBanner={showBanner} equipmentSelection={floor !== null ? {
          monitors: selectionFor('monitors'), computers: selectionFor('computers'), coffee: selectionFor('coffee'),
          water_heater: selectionFor('water_heater'), servers: selectionFor('servers'),
        } : undefined}>
          {floor === null && <>
            <RoofEquipment ventilation={selectionFor('ventilation')} solar={optionOf(solar) && optionOf(solar) !== 'solar_pv_none' ? selectionFor('solar_pv') : undefined} />
            <ExteriorBlinds {...selectionFor('blinds')} />
            {!playing && <PlanPins scenario={activePlan.scenario} color={color} onPick={goTo} />}
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
        {playing && !play.state && <StartCard plan={activePlan} busy={play.busy === 'start'} onStart={startGame} />}
        {game && !game.ended && game.reasons.length > 0 && (
          <EventCard key={`${game.session_id}|${game.t}`} state={game} catalog={play.catalog} busy={play.busy} onDecide={play.decide} onContinue={play.next} />
        )}
        {game?.ended && <EndCard key={game.session_id} state={game} path={path} onAgain={play.restart} />}
      </div>
      {game && (
        <div className="h-48 shrink-0 border-t border-[var(--r-line)] bg-background px-5 pt-2">
          <PlayChart history={game.history} horizon={game.horizon} now={game.t} ended={game.ended} stops={play.stops} className="h-full" />
        </div>
      )}
      </div>
      {playing ? (
        <PlayPanel play={play} path={path} floor={floor} onFloorChange={level => goTo(level)}
          selectedGroup={selectedGroup} onSelectGroup={group => setSelectedGroup(group as EquipmentGroup | null)} />
      ) : <BuildingInspector
        floor={floor}
        selectedGroup={selectedGroup}
        planned={planned}
        onFloorChange={level => goTo(level)}
        onSelectGroup={setSelectedGroup}
        onChooseOption={chooseOption}
        onGoTo={goTo}
      />}
    </main>
  );
}
