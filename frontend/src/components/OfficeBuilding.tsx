import Basement from './Basement';
import TopCantina from './TopCantina';
import TopLanding from './TopLanding';
import GroundFloor from './GroundFloor';
import Staircase from './Staircase';
import { FLOOR_COUNT, FLOOR_HEIGHT, WIDTH, LENGTH, LAYOUT_WIDTH, LAYOUT_LENGTH, STAIR_CENTER_Z, STAIR_OPENING_HALF } from '../data/building';
import { Box, Desk, Plant, type FloorEquipmentSelection } from './Furniture';
import BuildingBoxBatch, { type BuildingBoxPart } from './BuildingBoxBatch';

const white = '#d9ddda';
const metal = '#9ca8a9';
const red = '#c52d3f';

function Glass({ size, position }: { size: [number, number, number]; position: [number, number, number] }) {
  return <mesh position={position}><boxGeometry args={size}/><meshStandardMaterial color="#a4c6ce" transparent opacity={.18} roughness={.22} metalness={.15} depthWrite={false}/></mesh>;
}

// Leave the same opening in both the ground slab and the foundation below it.
function GroundSlab({ width, length, y, thickness, color }: {
  width: number; length: number; y: number; thickness: number; color: string;
}) {
  const half = STAIR_OPENING_HALF;
  const front = STAIR_CENTER_Z - half;
  const back = STAIR_CENTER_Z + half;
  return <>
    <Box size={[width, thickness, front + length / 2]} color={color} position={[0, y, (front - length / 2) / 2]}/>
    <Box size={[width, thickness, length / 2 - back]} color={color} position={[0, y, (back + length / 2) / 2]}/>
    {[-1, 1].map(side => <Box key={side} size={[width / 2 - half, thickness, half * 2]} color={color}
      position={[side * (width / 2 + half) / 2, y, STAIR_CENTER_Z]}/>)}
  </>;
}

function Floor({ level, equipmentSelection, showBanner }: { level: number; equipmentSelection?: FloorEquipmentSelection; showBanner: boolean }) {
  const y = level * FLOOR_HEIGHT;
  return <group position={[0, y, 0]}>
    {/* Ring slabs leave a genuine open atrium through all upper floors. */}
    {level === 0 ? <GroundSlab width={LAYOUT_WIDTH} length={LAYOUT_LENGTH} thickness={.25} y={-.125} color="#d7d2c7" /> : <>
      {[-14, 14].map(x => <Box key={x} size={[12, .22, 100]} color="#e0ded5" position={[x, -.11, 0]}/>)}
      {[-41, 41].map(z => <Box key={z} size={[16, .22, 18]} color="#e0ded5" position={[0, -.11, z]}/>)}
    </>}
    {[-1, 1].map(side => <group key={side}>
      {/* Offices, interior glazing, and corridor balustrades. */}
      {level > 0 && Array.from({ length: 12 }, (_, i) => {
        const z = -44 + i * 8;
        if (level === 4 && ((side === 1 && z >= -4) || (side === -1 && z < 36))) return null;
        // The top floor steps back to x=±18 and z=±47. End each bay
        // just inside the glazing, including the last partial bay.
        const outer = level === 4 ? 17.8 : 19.85;
        const inner = 12.35;
        const depth = level === 4 ? Math.min(8, 46.8-z) : 8;
        return <group key={i}>
          <Box size={[outer-inner, 2.7, .12]} color={white} position={[side*(outer+inner)/2, 1.35, z]}/>
          <Glass size={[.05, 2.8, depth-.2]} position={[side * 12.3, 1.4, z + depth/2]}/>
          <Box size={[.1, 3.3, .1]} color={metal} position={[side * 12.3, 1.65, z]}/>
          {depth >= 4 && <Desk position={[side * 16, 0, z + 3]} workstationSelection={equipmentSelection}/>}
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
    {level === 4 && <><TopLanding/><TopCantina coffeeSelection={equipmentSelection?.coffee}/></>}
    {(level === 4 ? [-40] : [-40, 40]).map(z => <group key={z}>
      <Box size={[5, 3, 5]} color="#bdc4c1" position={[12, 1.5, z]}/>
      <Box size={[1.8, 2.4, .06]} color="#7e9195" position={[12, 1.2, z + 2.55]}/>
      <Plant position={[-7, 0, z]}/>
    </group>)}
    {level === 0 && <>
      <GroundFloor workstationSelection={equipmentSelection} showBanner={showBanner}/>
    </>}
  </group>;
}

const facadeLevels = Array.from({ length: FLOOR_COUNT }, (_, floor) => {
  const top = floor === FLOOR_COUNT - 1;
  const xEdge = top ? 18 : 20;
  const zEdge = top ? 47 : 50;
  const frames = [-1, 1].flatMap(side => [
    { size: [.22, .28, zEdge * 2], color: white, position: [side * xEdge, .14, 0] },
    { size: [xEdge * 2, .28, .22], color: white, position: [0, .14, side * zEdge] },
    ...Array.from({ length: 33 }, (_, i): BuildingBoxPart => ({
      size: [.16, 3.5, .18], color: metal, position: [side * xEdge, 1.75, -zEdge + i * zEdge / 16],
    })),
    ...Array.from({ length: 17 }, (_, i): BuildingBoxPart => ({
      size: [.16, 3.5, .18], color: metal, position: [-xEdge + i * xEdge / 8, 1.75, side * zEdge],
    })),
  ] satisfies BuildingBoxPart[]);
  return { xEdge, zEdge, frames };
});

function Facade({ floors }: { floors: number }) {
  return <group>
    {facadeLevels.slice(0, floors).map(({ xEdge, zEdge, frames }, floor) => (
      <group key={floor} position={[0, floor * FLOOR_HEIGHT, 0]} scale={[1, FLOOR_HEIGHT / 3.5, 1]}>
        <BuildingBoxBatch parts={frames} />
        {/* Keep glass separate so Three can sort the transparent panes. */}
        {[-1, 1].map(side => <group key={side}>
          <Glass size={[.08, 3.2, zEdge * 2]} position={[side * xEdge, 1.7, 0]}/>
          <Glass size={[xEdge * 2, 3.2, .08]} position={[0, 1.7, side * zEdge]}/>
        </group>)}
      </group>
    ))}
    {/* Red portal and ground-level horizontal louvres from the front reference. */}
    <Box size={[13, .55, .7]} color={red} position={[0, 2.85, 50.35]}/>
    {[-6.25, 6.25].map(x => <Box key={x} size={[.5, 2.85, .7]} color={red} position={[x, 1.425, 50.35]}/>)}
    {[-1, 1].flatMap(side => Array.from({ length: 9 }, (_, i) => <Box key={`${side}-${i}`} size={[13, .09, .25]} color={metal} position={[side * 13.5, .3 + i * .3, 50.2]}/>))}
  </group>;
}

export default function OfficeBuilding({ floor, equipmentSelection, showBanner }: { floor: number | null; equipmentSelection?: FloorEquipmentSelection; showBanner: boolean }) {
  if (floor === -1) return <>
    <Basement equipmentSelection={equipmentSelection} />
    <group scale={[WIDTH / LAYOUT_WIDTH, 1, LENGTH / LAYOUT_LENGTH]}>
      <Staircase floors={1} />
    </group>
  </>;
  const visibleFloors = floor === null ? FLOOR_COUNT : floor + 1;
  return <>
    <Basement />
    <group scale={[WIDTH / LAYOUT_WIDTH, 1, LENGTH / LAYOUT_LENGTH]}>
    <GroundSlab width={48} length={108} thickness={.4} y={-.5} color="#bfc5bc" />
    {Array.from({ length: visibleFloors }, (_, level) => <Floor key={level} level={level} showBanner={showBanner} equipmentSelection={level === floor ? equipmentSelection : undefined}/>)}
    <Staircase floors={visibleFloors}/>
    {floor !== 0 && <Facade floors={floor ?? FLOOR_COUNT}/>}
    {/* Broad canopy frames the long transparent atrium skylight. */}
    {floor === null && <group position={[0, FLOOR_COUNT * FLOOR_HEIGHT + .3, 0]}>
      {[-16, 16].map(x => <Box key={x} size={[14, .35, 106]} color="#aeb5b2" position={[x, 0, 0]}/>)}
      {[-44, 44].map(z => <Box key={z} size={[18, .35, 18]} color="#aeb5b2" position={[0, 0, z]}/>)}
      <Glass size={[18, .08, 70]} position={[0, .12, 0]}/>
      {Array.from({ length: 18 }, (_, i) => <Box key={i} size={[18, .15, .09]} color={white} position={[0, .2, -34 + i * 4]}/>)}
      {[-6, -3, 0, 3, 6].map(x => <Box key={x} size={[.08, .15, 70]} color={white} position={[x, .2, 0]}/>)}
    </group>}
    </group>
  </>;
}
