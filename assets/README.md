# Demo office building

- `office-building.glb` — self-contained 3.3 MB glTF 2.0 asset, no external textures or decoder required.
- `office-building-preview.png` — overview render.
- `office-building.blend` — editable source, including preview camera/lighting.
- Regenerate: `blender -b -t 6 --python assets/generate_office.py` (no third-party Python dependencies).

Three-storey cutaway, 18 × 12 metres, 3.5 m storeys. Front and right walls and most roof panels are deliberately omitted to expose the interior. Includes 18 furnished workstations with monitors and computer towers, conference tables, chairs, sofas, plants, six toilets, sinks, 12 emissive pendant fixtures, and a rooftop twin-fan heat pump. No stairs or enclosed circulation core; this is a demo asset, not a construction model.

GLB uses Y up, ground centred around the origin; front is +Z. Suggested Three.js camera position: `[24, 24, 32]`, controls target `[0, 5, 0]`. Add environment/scene lights; fixture surfaces are emissive, not exported punctual lights.

Hierarchy: building → floor → component → mesh. Nodes have `component_type` extras, imported as `object.userData.component_type` by Three.js GLTFLoader. Walk up from a raycast mesh to find a monitor/computer/heat_pump/etc. Named floor groups can be hidden independently for inspection. `power_w` and heat pump `cop` metadata are illustrative placeholders, not calibrated simulation inputs.

All geometry and materials are procedurally authored here; no downloaded assets.
