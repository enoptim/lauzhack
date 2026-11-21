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
const walls = [perimeter, ...rooms.flatMap(room => room.polygons.map(([outer]) => outer.map(toPlan)))];

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

export default function Basement({ waterHeaterSelection }: { waterHeaterSelection?: FloorEquipmentSelection['water_heater'] }) {
  const [tankX, tankZ] = toPlan([12.54, 59.32]);
  return <group position={[0, -FLOOR_HEIGHT, 0]}>
    <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <shapeGeometry args={[slab]} />
      <meshStandardMaterial color="#a6a7a2" />
    </mesh>
    <CarPark />
    {walls.flatMap((ring, ringIndex) => ring.slice(1).map(([x, z], i) => {
      const [a, b] = ring[i];
      return <Box key={`${ringIndex}:${i}`} position={[(a + x) / 2, .55, (b + z) / 2]}
        rotation={[0, Math.atan2(b - z, x - a), 0]} size={[Math.hypot(x - a, z - b), 1.1, .22]} color="#d2d2cb" />;
    }))}
    <mesh name="BC_991.0:water_heater:building" position={[tankX, 1.1, tankZ]} castShadow onClick={waterHeaterSelection && (event => {
      event.stopPropagation();
      if (event.delta <= 4) waterHeaterSelection.onSelect();
    })}>
      <cylinderGeometry args={[.68, .68, 2.2, 16]} />
      <meshStandardMaterial color="#cbd2d3" metalness={.35} roughness={.6} />
      {waterHeaterSelection && <Edges threshold={25} lineWidth={2} color={waterHeaterSelection.outline} />}
      <Box position={[.62, .24, 0]} size={[.18, .25, .3]} color="#35454e" />
      <Box position={[-.26, 1.3, 0]} size={[.12, .4, .12]} color="#ab593c" />
      <Box position={[.26, 1.3, 0]} size={[.12, .4, .12]} color="#527b8e" />
    </mesh>
  </group>;
}
