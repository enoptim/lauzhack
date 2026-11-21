import { devices, FLOOR_COUNT, FLOOR_HEIGHT } from '../data/building';
import { Box, Desk, Plant } from './Furniture';
import Equipment from './Equipment';
export default function OfficeBuilding({ floor, selected, onSelect }: { floor: number; selected: string | null; onSelect: (id: string) => void }) {
  return <group>
    <Box size={[17, .4, 12]} color="#c8d0c5" position={[0, -.35, 0]}/>
    {Array.from({ length: FLOOR_COUNT }, (_, f) => f <= floor && <group key={f} position={[0, f * FLOOR_HEIGHT, 0]}>
      <Box size={[15, .2, 10]} color={f % 2 ? '#e5dfd1' : '#eee7d9'} position={[0, -.1, 0]}/>
      {/* Rear facade only: permanent cutaway keeps the interior readable. */}
      <Box size={[15, .65, .15]} color="#c2cdc4" position={[0, .325, -5]}/>
      <Box size={[15, .3, .18]} color="#d3dcd2" position={[0, 3.3, -5]}/>
      {[-7.3, -4.9, -2.5, -.1, 2.3, 4.7, 7.3].map(x => <Box key={x} size={[.16, 3.3, .18]} color="#9aaea5" position={[x, 1.65, -5]}/>)}
      <mesh position={[0, 1.9, -5]}><boxGeometry args={[14.5, 2.3, .04]}/><meshStandardMaterial color="#9acbd1" transparent opacity={.2} depthWrite={false}/></mesh>
      {/* Low restroom partitions avoid hiding equipment. */}
      <Box size={[.12, 1.3, 5]} color="#c2cdc4" position={[4.5, .65, -.7]}/>
      <Box size={[2.8, 1.3, .12]} color="#c2cdc4" position={[6, .65, -.8]}/>
      {[-5.2, -1.8, 1.6].flatMap(x => [-2.3, 1.2].map(z => <Desk key={`${x}-${z}`} position={[x, 0, z]}/>))}
      <Plant position={[-6.7, 0, -4]}/><Plant position={[6.6, 0, 3.7]}/>
      <Box size={[2, 1.4, .55]} color="#b5bfb2" position={[-3, .7, -4.4]}/>
      <Box size={[2, .12, .6]} color="#caa97a" position={[-3, 1.45, -4.4]}/>
      {[[-7.2, -4.7], [7.2, -4.7], [-7.2, 4.7], [7.2, 4.7]].map(([x, z], i) => <Box key={i} size={[.22, 3.6, .22]} color="#91a69a" position={[x, 1.8, z]}/>)}
    </group>)}
    {floor === FLOOR_COUNT && <Box size={[15.3, .25, 10.3]} color="#aebcaf" position={[0, FLOOR_COUNT * FLOOR_HEIGHT, 0]}/>}
    {devices.filter(d => d.floor <= floor).map(d => <Equipment key={d.id} device={d} selected={selected === d.id} onSelect={onSelect}/>)}
  </group>;
}
