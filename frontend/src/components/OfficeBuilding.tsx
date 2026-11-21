import GroundFloor from './GroundFloor';
import Staircase from './Staircase';
import { FLOOR_COUNT, FLOOR_HEIGHT, WIDTH, LENGTH, LAYOUT_WIDTH, LAYOUT_LENGTH } from '../data/building';
import { Box, Desk, Plant } from './Furniture';

const white = '#d9ddda';
const metal = '#9ca8a9';
const red = '#c52d3f';

function Glass({ size, position }: { size: [number, number, number]; position: [number, number, number] }) {
  return <mesh position={position}><boxGeometry args={size}/><meshStandardMaterial color="#a4c6ce" transparent opacity={.18} roughness={.22} metalness={.15} depthWrite={false}/></mesh>;
}

function Floor({ level }: { level: number }) {
  const y = level * FLOOR_HEIGHT;
  return <group position={[0, y, 0]}>
    {/* Ring slabs leave a genuine open atrium through all upper floors. */}
    {level === 0 ? <Box size={[LAYOUT_WIDTH, .25, LAYOUT_LENGTH]} color="#d7d2c7" position={[0, -.125, 0]}/> : <>
      {[-14, 14].map(x => <Box key={x} size={[12, .22, 100]} color="#e0ded5" position={[x, -.11, 0]}/>)}
      {[-41, 41].map(z => <Box key={z} size={[16, .22, 18]} color="#e0ded5" position={[0, -.11, z]}/>)}
    </>}
    {[-1, 1].map(side => <group key={side}>
      {/* Offices, interior glazing, and corridor balustrades. */}
      {level > 0 && Array.from({ length: 12 }, (_, i) => {
        const z = -44 + i * 8;
        return <group key={i}>
          <Box size={[7.5, 2.7, .12]} color={white} position={[side * 16.1, 1.35, z]}/>
          <Glass size={[.05, 2.8, 7.8]} position={[side * 12.3, 1.4, z + 4]}/>
          <Box size={[.1, 3.3, .1]} color={metal} position={[side * 12.3, 1.65, z]}/>
          <Desk position={[side * 16, 0, z + 3]}/>
        </group>;
      })}
      {level > 0 && <>
        <Glass size={[.06, 1.05, 64]} position={[side * 8, .55, 0]}/>
        <Box size={[.09, .08, 64]} color={metal} position={[side * 8, 1.1, 0]}/>
      </>}
      {[-32, -16, 0, 16, 32].map(z => <Box key={z} size={[.45, FLOOR_HEIGHT, .45]} color={white} position={[side * 8.3, FLOOR_HEIGHT/2, z]}/>)}
    </group>)}
    {level > 0 && <>
      <Glass size={[16, 1.05, .06]} position={[0, .55, -32]}/>
      {/* Leave a clear opening where the staircase landing meets the corridor. */}
      {[-4.5, 4.5].map(x => <Glass key={x} size={[7, 1.05, .06]} position={[x, .55, 32]}/>)}
    </>}
    {[-40, 40].map(z => <group key={z}>
      <Box size={[5, 3, 5]} color="#bdc4c1" position={[12, 1.5, z]}/>
      <Box size={[1.8, 2.4, .06]} color="#7e9195" position={[12, 1.2, z + 2.55]}/>
      <Plant position={[-7, 0, z]}/>
    </group>)}
    {level === 0 && <>
      <GroundFloor/>
    </>}
  </group>;
}

function Facade() {
  return <group>
    {Array.from({ length: 5 }, (_, f) => {
      const top = f === 4;
      const y = f * FLOOR_HEIGHT;
      const xEdge = top ? 18 : 20;
      const zEdge = top ? 47 : 50;
      return <group key={f} position={[0,y,0]} scale={[1,FLOOR_HEIGHT/3.5,1]}><group position={[0,-y,0]}>
        {[-1, 1].map(side => <group key={side}>
          <Glass size={[.08, 3.2, zEdge * 2]} position={[side * xEdge, y + 1.7, 0]}/>
          <Glass size={[xEdge * 2, 3.2, .08]} position={[0, y + 1.7, side * zEdge]}/>
          <Box size={[.22, .28, zEdge * 2]} color={white} position={[side * xEdge, y + .14, 0]}/>
          <Box size={[xEdge * 2, .28, .22]} color={white} position={[0, y + .14, side * zEdge]}/>
          {Array.from({ length: 33 }, (_, i) => <Box key={i} size={[.16, 3.5, .18]} color={metal} position={[side * xEdge, y + 1.75, -zEdge + i * zEdge / 16]}/>)}
          {Array.from({ length: 17 }, (_, i) => <Box key={i} size={[.16, 3.5, .18]} color={metal} position={[-xEdge + i * xEdge / 8, y + 1.75, side * zEdge]}/>)}
        </group>)}
      </group></group>;
    })}
    {/* Red portal and ground-level horizontal louvres from the front reference. */}
    <Box size={[13, .55, .7]} color={red} position={[0, 2.85, 50.35]}/>
    {[-6.25, 6.25].map(x => <Box key={x} size={[.5, 2.85, .7]} color={red} position={[x, 1.425, 50.35]}/>)}
    {[-1, 1].flatMap(side => Array.from({ length: 9 }, (_, i) => <Box key={`${side}-${i}`} size={[13, .09, .25]} color={metal} position={[side * 13.5, .3 + i * .3, 50.2]}/>))}
  </group>;
}

export default function OfficeBuilding() {
  return <group scale={[WIDTH / LAYOUT_WIDTH, 1, LENGTH / LAYOUT_LENGTH]}>
    <Box size={[48, .4, 108]} color="#bfc5bc" position={[0, -.5, 0]}/>
    {Array.from({ length: FLOOR_COUNT }, (_, level) => <Floor key={level} level={level}/>)}
    <Staircase/>
    <Facade/>
    {/* Broad canopy frames the long transparent atrium skylight. */}
    <group position={[0, FLOOR_COUNT * FLOOR_HEIGHT + .3, 0]}>
      {[-16, 16].map(x => <Box key={x} size={[14, .35, 106]} color="#aeb5b2" position={[x, 0, 0]}/>)}
      {[-44, 44].map(z => <Box key={z} size={[18, .35, 18]} color="#aeb5b2" position={[0, 0, z]}/>)}
      <Glass size={[18, .08, 70]} position={[0, .12, 0]}/>
      {Array.from({ length: 18 }, (_, i) => <Box key={i} size={[18, .15, .09]} color={white} position={[0, .2, -34 + i * 4]}/>)}
      {[-6, -3, 0, 3, 6].map(x => <Box key={x} size={[.08, .15, 70]} color={white} position={[x, .2, 0]}/>)}
    </group>
  </group>;
}
