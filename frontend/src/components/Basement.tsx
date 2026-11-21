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

export default function Basement({ waterHeaterSelection }: { waterHeaterSelection?: FloorEquipmentSelection['water_heater'] }) {
  const [tankX, tankZ] = toPlan([12.54, 59.32]);
  return <group position={[0, -FLOOR_HEIGHT, 0]}>
    <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <shapeGeometry args={[slab]} />
      <meshStandardMaterial color="#a6a7a2" />
    </mesh>
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
