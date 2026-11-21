import { useState } from 'react';
import BuildingScene from '@/components/BuildingScene';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FLOOR_COUNT } from '@/data/building';
import { lightingItems, lightingOptions, lightingScenario } from './lighting';

const keepCurrent = 'keep-current';
const floorLabel = (floor: number) => floor === 0 ? 'Ground floor' : `Floor ${floor}`;

export default function BuildingPage() {
  const [floor, setFloor] = useState<number | null>(null);
  const [lightingSelected, setLightingSelected] = useState(false);
  const [draft, setDraft] = useState(() => new Map<number, string>());
  const floorLights = lightingItems.filter(item => item.floor === floor);
  const installedIds = new Set(floorLights.map(item => item.installed));
  const installed = installedIds.size === 1
    ? lightingOptions.find(option => installedIds.has(option.option_id))
    : undefined;

  function chooseOption(option: string) {
    if (floor === null) return;
    setDraft(previous => {
      const next = new Map(previous);
      if (option === keepCurrent) next.delete(floor);
      else next.set(floor, option);
      return next;
    });
  }

  return (
    <main aria-label="Building viewer" className="grid min-h-full grid-rows-[minmax(20rem,55dvh)_auto] md:h-full md:grid-cols-[minmax(0,1fr)_20rem] md:grid-rows-[minmax(0,1fr)]">
      <div className="min-h-0">
        <BuildingScene floor={floor}>
          {floor !== null && floorLights.map(item => (
            <mesh
              key={item.id}
              name={item.id}
              position={item.position}
              onClick={event => {
                event.stopPropagation();
                if (event.delta <= 4) setLightingSelected(true);
              }}
            >
              <boxGeometry args={[.9, .25, .65]} />
              <meshBasicMaterial color={draft.has(floor) ? '#16a075' : lightingSelected ? '#007eab' : '#f5ad20'} />
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
            setLightingSelected(false);
          }}>
            <SelectTrigger id="building-floor" className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="all">Whole building</SelectItem>
                {Array.from({ length: FLOOR_COUNT }, (_, level) => (
                  <SelectItem key={level} value={String(level)}>{floorLabel(level)}</SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
        {lightingSelected && floor !== null ? (
          <section className="flex flex-col gap-2">
            <h2 className="font-medium">Lighting · {floorLabel(floor)}</h2>
            <p className="text-sm text-muted-foreground">Installed: {installed?.name ?? 'Mixed lighting'}</p>
            <label htmlFor="lighting-option" className="text-sm font-medium">Configuration for the whole floor</label>
            <Select value={draft.get(floor) ?? keepCurrent} onValueChange={chooseOption}>
              <SelectTrigger id="lighting-option" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent position="popper" className="w-(--radix-select-trigger-width)">
                <SelectGroup>
                  <SelectItem value={keepCurrent}>Keep current setup</SelectItem>
                  {lightingOptions.filter(option => option.option_id !== installed?.option_id).map(option => (
                    <SelectItem key={option.option_id} value={option.option_id}>{option.name}</SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </section>
        ) : (
          <p className="text-sm text-muted-foreground">
            {floor === null ? 'Choose a floor to see its lights.' : 'Click any light marker to configure lighting for the whole floor.'}
          </p>
        )}
        <div className="mt-auto flex flex-col gap-2 border-t border-border pt-4">
          <p aria-live="polite" className="text-sm text-muted-foreground">
            {draft.size} pending {draft.size === 1 ? 'change' : 'changes'}
          </p>
          <button
            type="button"
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            onClick={() => console.log({ scenario: lightingScenario(draft) })}
          >
            Simulate
          </button>
          <p className="text-xs text-muted-foreground">Logs the draft to the browser console. No simulation runs yet.</p>
        </div>
      </aside>
    </main>
  );
}
