import BuildingBoxBatch, { type BuildingBoxPart } from '@/components/BuildingBoxBatch';
import { FLOOR_COUNT, FLOOR_HEIGHT, LAYOUT_LENGTH, LAYOUT_WIDTH, LENGTH, WIDTH } from '@/data/building';

const blindWidth = 2.25;
const blindHeight = 1.25;
const blind: BuildingBoxPart[] = [
  { size: [blindWidth, .2, .32], position: [0, .54, 0], color: '#6f7b80' },
  ...Array.from({ length: 7 }, (_, i): BuildingBoxPart => ({
    size: [blindWidth - .12, .055, .27], position: [0, .35 - i * .145, 0],
    rotation: [.36, 0, 0], color: '#a6b0b2',
  })),
];
const rim = [-1, 1].flatMap(side => [
  { size: [.075, blindHeight, .07], position: [side * blindWidth / 2, 0, .17] },
  { size: [blindWidth + .075, .075, .07], position: [0, side * blindHeight / 2, .17] },
] satisfies BuildingBoxPart[]);

const blindParts: BuildingBoxPart[] = [];
const rimParts: BuildingBoxPart[] = [];

function addBlind(x: number, y: number, z: number, yaw: number) {
  const sin = Math.sin(yaw);
  const cos = Math.cos(yaw);
  function place(part: BuildingBoxPart): BuildingBoxPart {
    const [dx, dy, dz] = part.position;
    return {
      ...part,
      position: [x + dx * cos + dz * sin, y + dy, z - dx * sin + dz * cos],
      // Tilt each slat in its local frame before turning the blind to face outwards.
      rotation: [part.rotation?.[0] ?? 0, yaw, 0, 'YXZ'],
    };
  }
  blindParts.push(...blind.map(place));
  rimParts.push(...rim.map(place));
}

for (let floor = 0; floor < FLOOR_COUNT; floor++) {
  const top = floor === FLOOR_COUNT - 1;
  const y = floor * FLOOR_HEIGHT + 2.8;
  const xEdge = top ? 18 : 20;
  const zEdge = top ? 47 : 50;
  for (const side of [-1, 1]) {
    for (const bay of [-7.5, 5.5]) addBlind(side * (xEdge + .22), y, bay * zEdge / 16, side * Math.PI / 2);
    for (const bay of [-4.5, 4.5]) addBlind(bay * xEdge / 8, y, side * (zEdge + .22), side === 1 ? 0 : Math.PI);
  }
}

export default function ExteriorBlinds({ outline, onSelect }: { outline: string; onSelect: () => void }) {
  return <group scale={[WIDTH / LAYOUT_WIDTH, 1, LENGTH / LAYOUT_LENGTH]} onClick={event => {
    event.stopPropagation();
    if (event.delta <= 4) onSelect();
  }}>
    <BuildingBoxBatch parts={blindParts} />
    <BuildingBoxBatch parts={rimParts} outline={outline} />
  </group>;
}
