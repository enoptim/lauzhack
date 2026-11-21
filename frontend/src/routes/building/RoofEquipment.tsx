import { Edges } from '@react-three/drei';
import { Box } from '@/components/Furniture';
import { FLOOR_COUNT, FLOOR_HEIGHT, LAYOUT_LENGTH, LAYOUT_WIDTH, LENGTH, WIDTH } from '@/data/building';

type Selection = { outline: string; onSelect: () => void };

export default function RoofEquipment({ ventilation, solar }: { ventilation: Selection; solar?: Selection }) {
  return <group position={[0, FLOOR_COUNT * FLOOR_HEIGHT + .475, 0]} scale={[WIDTH / LAYOUT_WIDTH, 1, LENGTH / LAYOUT_LENGTH]}>
    <group onClick={event => {
      event.stopPropagation();
      if (event.delta <= 4) ventilation.onSelect();
    }}>
      {[-16, 16].flatMap(x => [-33, -23, -13].map(z => (
        <Box key={`${x}:${z}`} size={[3.4, 1.45, 6.5]} position={[x, .925, z]} color="#8e9a9c">
          {/* Mounting rails, cabinet seams, and service handles. */}
          {[-1.25, 1.25].map(side => <Box key={side} size={[.26, .2, 6.74]}
            position={[side, -.825, 0]} color="#555f64" />)}
          {[-2.12, 2.12].map(offset => <Box key={offset} size={[3.18, .035, .08]}
            position={[0, .737, offset]} color="#647076" />)}
          {[-1.5, 0, 1.5].map(offset => <group key={offset}>
            <Box size={[.055, 1.05, 1.36]} position={[-1.72, 0, offset]} color="#77868b" />
            <Box size={[.08, .29, .08]} position={[-1.77, 0, offset + .46]} color="#333d42" />
          </group>)}
          {/* A solid rim stays visible when the roof is viewed from a distance. */}
          {[-1, 1].map(side => <group key={side}>
            <mesh position={[side * 1.65, .74, 0]}>
              <boxGeometry args={[.22, .05, 6.56]} />
              <meshBasicMaterial color={ventilation.outline} toneMapped={false} />
            </mesh>
            <mesh position={[0, .74, side * 3.2]}>
              <boxGeometry args={[3.3, .05, .22]} />
              <meshBasicMaterial color={ventilation.outline} toneMapped={false} />
            </mesh>
          </group>)}
          {[-1.8, 0, 1.8].map(offset => <group key={offset}>
            <Box size={[.1, .78, 1.45]} position={[1.72, 0, offset]} color="#41494d" />
            {[-.24, 0, .24].map(y => <Box key={y} size={[.12, .06, 1.36]} position={[1.78, y, offset]} color="#707b80" />)}
          </group>)}
        </Box>
      )))}
    </group>
    {solar && <group onClick={event => {
      event.stopPropagation();
      if (event.delta <= 4) solar.onSelect();
    }}>
      {[-19, -13, 13, 19].flatMap(x => [3, 11, 19, 27, 35].map(z => (
        <Box key={`${x}:${z}`} size={[4.8, .13, 6.2]} position={[x, .46, z]} rotation={[0, 0, .15]} color="#253e63">
          <Edges lineWidth={2} color={solar.outline} />
          {[-2.07, 0, 2.07].map(offset => <Box key={offset} size={[4.73, .018, .035]} position={[0, .074, offset]} color="#6b829c" />)}
          <Box size={[.035, .018, 6.13]} position={[0, .074, 0]} color="#6b829c" />
        </Box>
      )))}
    </group>}
  </group>;
}
