import { Edges } from '@react-three/drei';
import { Shape } from 'three';
import geometry from '../../../data/geometry.json';
import { FLOOR_HEIGHT, LENGTH, WIDTH } from '../data/building';
import { Box, type FloorEquipmentSelection } from './Furniture';

const toPlan = ([east, north]: number[]): [number, number] => [east - WIDTH / 2, LENGTH / 2 - north];
const perimeter = geometry.footprint.map(toPlan);
const slab = new Shape();
perimeter.forEach(([x, z], i) => i === 0 ? slab.moveTo(x, -z) : slab.lineTo(x, -z));
slab.closePath();

const rooms = geometry.rooms.filter(room => room.floor === -1 && ['plant_room', 'server_room'].includes(room.type));
const doorways = {
  plant_room: [10, 55.11],
  server_room: [10, 8.2],
} as const;
const doorwayHalfWidth = .9;
const wallRuns = [
  { ring: perimeter, doorway: undefined },
  ...rooms.flatMap(room => room.polygons.map(([outer]) => ({
    ring: outer.map(toPlan),
    doorway: toPlan([...doorways[room.type as keyof typeof doorways]]),
  }))),
];

const parkingColors = ['#426988', '#a24940', '#d7d6cc', '#52665e', '#343b46', '#777b80', '#a38d69'];
const parkingRows = [47.5, 35.5, 30.5, 18.5];
const bayCount = 12;
const bayWidth = 2.8;

function ParkedCar({ x, z, color, reverse }: { x: number; z: number; color: string; reverse: boolean }) {
  return <group position={[x, 0, z]} rotation={[0, reverse ? Math.PI : 0, 0]}>
    <Box size={[1.68, .53, 3.75]} position={[0, .49, 0]} color={color} />
    <Box size={[1.39, .45, 1.92]} position={[0, .91, -.1]} color="#34444e" />
    <Box size={[1.33, .07, 1.48]} position={[0, 1.16, -.1]} color={color} />
    {[-1, 1].flatMap(side => [-1.16, 1.16].map(offset => (
      <mesh key={`${side}:${offset}`} position={[side * .82, .28, offset]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[.28, .28, .18, 12]} />
        <meshStandardMaterial color="#222427" />
      </mesh>
    )))}
    {[-.56, .56].map(side => <group key={side}>
      <Box size={[.32, .12, .05]} position={[side, .55, 1.88]} color="#eee5c8" />
      <Box size={[.32, .12, .05]} position={[side, .55, -1.88]} color="#a83338" />
    </group>)}
  </group>;
}

function CarPark() {
  // Four full rows face two drive aisles. Keep the stair landing clear.
  return <group>
    {parkingRows.map((north, row) => {
      const [start, z] = toPlan([4, north]);
      const reverse = row % 2 === 1;
      const width = bayCount * bayWidth;
      return <group key={north}>
        {row !== 2 && <Box size={[width, .025, .07]}
          position={[start + width / 2, .02, z + (reverse ? 2.5 : -2.5)]} color="#e4dfd1" />}
        {Array.from({ length: bayCount + 1 }, (_, i) => (
          <Box key={i} size={[.07, .025, 5]} position={[start + i * bayWidth, .02, z]} color="#e4dfd1" />
        ))}
        {Array.from({ length: bayCount }, (_, i) => (
          <ParkedCar key={i} x={start + (i + .5) * bayWidth} z={z} reverse={reverse}
            color={parkingColors[(i * 3 + row * 2) % parkingColors.length]} />
        ))}
      </group>;
    })}
  </group>;
}

type BasementSelection = Pick<FloorEquipmentSelection, 'water_heater' | 'servers'>;

function ServerRack({ east, selection }: { east: number; selection?: BasementSelection['servers'] }) {
  const [x, z] = toPlan([east, 4]);
  return <mesh position={[x, 1.05, z]} castShadow onClick={selection && (event => {
    event.stopPropagation();
    if (event.delta <= 4) selection.onSelect();
  })}>
    <boxGeometry args={[.68, 2.1, .95]} />
    <meshStandardMaterial color="#252c32" roughness={.7} />
    {selection && <Edges lineWidth={2} color={selection.outline} />}
    {Array.from({ length: 8 }, (_, slot) => <group key={slot} position={[0, -.82 + slot * .22, -.485]}>
      <Box size={[.53, .16, .025]} color="#4d575d" />
      <Box size={[.045, .035, .025]} position={[.2, .01, -.02]} color={slot % 3 ? '#69b38d' : '#91bbc8'} />
    </group>)}
  </mesh>;
}

export default function Basement({ equipmentSelection }: { equipmentSelection?: BasementSelection }) {
  const waterHeaterSelection = equipmentSelection?.water_heater;
  return <group position={[0, -FLOOR_HEIGHT, 0]}>
    <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <shapeGeometry args={[slab]} />
      <meshStandardMaterial color="#a6a7a2" />
    </mesh>
    <CarPark />
    {wallRuns.flatMap(({ ring, doorway }, ringIndex) => ring.slice(1).flatMap(([x, z], i) => {
      const [a, b] = ring[i];
      const [doorX, doorZ] = doorway ?? [NaN, NaN];
      const left = doorX - doorwayHalfWidth;
      const right = doorX + doorwayHalfWidth;
      const segments = z === b && z === doorZ && Math.min(a, x) < left && Math.max(a, x) > right
        ? [[Math.min(a, x), b, left, z], [right, b, Math.max(a, x), z]]
        : [[a, b, x, z]];
      return segments.map(([fromX, fromZ, toX, toZ], segment) => (
        <Box key={`${ringIndex}:${i}:${segment}`} position={[(fromX + toX) / 2, .55, (fromZ + toZ) / 2]}
          rotation={[0, Math.atan2(fromZ - toZ, toX - fromX), 0]}
          size={[Math.hypot(toX - fromX, toZ - fromZ), 1.1, .22]} color="#d2d2cb" />
      ));
    }))}
    {/* Four tanks depict one central hot-water system in the inventory. */}
    {[7.54, 10.04, 12.54, 15.04].map(east => {
      const [x, z] = toPlan([east, 59.32]);
      return <mesh key={east} name="BC_991.0:water_heater:building" position={[x, 1.1, z]} castShadow onClick={waterHeaterSelection && (event => {
      event.stopPropagation();
      if (event.delta <= 4) waterHeaterSelection.onSelect();
    })}>
      <cylinderGeometry args={[.68, .68, 2.2, 16]} />
      <meshStandardMaterial color="#cbd2d3" metalness={.35} roughness={.6} />
      {waterHeaterSelection && <Edges threshold={25} lineWidth={2} color={waterHeaterSelection.outline} />}
      <Box position={[.62, .24, 0]} size={[.18, .25, .3]} color="#35454e" />
      <Box position={[-.26, 1.3, 0]} size={[.12, .4, .12]} color="#ab593c" />
      <Box position={[.26, 1.3, 0]} size={[.12, .4, .12]} color="#527b8e" />
      </mesh>;
    })}
    {[4, 5.7, 7.4, 9.1, 10.8, 12.5].map(east => (
      <ServerRack key={east} east={east} selection={equipmentSelection?.servers} />
    ))}
  </group>;
}
