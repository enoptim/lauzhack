# Office building preview

A full-screen procedural office building using React, TypeScript, Vite, React Three Fiber and Drei. No external model files required.

## Run

```sh
cd frontend
pnpm install
pnpm dev
```

Open the URL printed by Vite. A WebGL-capable browser is required.

- Left-drag to orbit.
- Scroll to zoom.
- Right-drag to pan.

The model shows three furnished floors and a rooftop heat pump. Front and side walls are omitted for a cutaway view. There are no panels, buttons, equipment interactions, or simulation logic.

## Files

- `src/App.tsx`: renders the viewer.
- `src/components/BuildingScene.tsx`: camera, lighting and renderer.
- `src/components/OfficeBuilding.tsx`: building geometry and furniture placement.
- `src/components/Furniture.tsx`: desks, chairs, storage primitives and plants.
- `src/components/Equipment.tsx`: monitors, computers, lights, toilets and heat pump geometry.
- `src/data/building.ts`: building dimensions and equipment placement.

`pnpm build` typechecks and builds production output. `pnpm preview` serves it.
