# Atelier · Office building twin

Procedural three-floor office built with React, TypeScript, Vite, React Three Fiber and Drei. No Blender or external model required. Existing files in `../assets` are not used or modified.

## Run

```sh
cd frontend
pnpm install
pnpm dev
```

Open the URL printed by Vite (normally http://localhost:5173). A WebGL-capable browser is required for the scene. The dev server binds to all interfaces; use `pnpm dev --host 127.0.0.1` to restrict it.

```sh
pnpm build       # Typecheck and production build
pnpm preview    # Serve production output
```

Dependencies are pinned by `pnpm-lock.yaml`. `pnpm-workspace.yaml` explicitly permits esbuild's installation script with current pnpm.

## Interactions

- Left-drag to orbit, scroll to zoom, right-drag to pan.
- Floor buttons show the selected floor and floors below it; Roof adds the roof and central heat pump.
- The front/side facades are deliberately omitted for a cutaway view.
- Click monitors, computer towers, ceiling lights, toilets, or the rooftop heat pump to inspect them. The inspector dropdown is an accessible alternative for equipment selection and reveals its floor automatically.
- Edit electrical watts and daily operating hours. The whole-building total includes hidden floors.
- Reset scenario restores initial assumptions. Changes are in memory only.

## Source map

- `src/data/building.ts`: dimensions, stable equipment IDs, initial assumptions and illustrative annual electricity calculation.
- `src/components/BuildingScene.tsx`: renderer, lights, grid, orbit controls, viewer error fallback.
- `src/components/OfficeBuilding.tsx`: slabs, facade, partitions, furniture placement and equipment visibility.
- `src/components/Furniture.tsx`: reusable box, desk/chair and plant geometry.
- `src/components/Equipment.tsx`: equipment geometry, picking, highlight and labels.
- `src/components/Inspector.tsx`: equipment selector and assumption editor.
- `src/App.tsx`: shared scenario state, floor state, baseline comparison and layout.
- `src/styles.css`: responsive UI.

## Connect the modelling backend

Use device IDs (for example `heat-pump-main` and `computer-0-0-0`) as keys in the scenario payload. Keep the baseline immutable. Replace `annualKWh` in the UI with results from the modelling API; geometry should not own simulation logic. Debounce requests and cancel/ignore stale responses.

The existing load calculation is **illustrative only**: watts × hours/day × 250 days/year. It does not simulate thermal loads, COP, weather, occupancy, water, tariffs, investment cost or ROI. Toilet assets are selectable but not included in electricity consumption. All physical values and dimensions are fictional demonstration inputs. Do not interpret this as a validated building model.

## Verification

`pnpm build` typechecks all source and produces the production bundle. The Three.js bundle currently triggers Vite's large-chunk advisory; this does not prevent the build. Browser/WebGL appearance must be checked locally. Google Fonts are optional; system sans-serif fonts are used when offline.
