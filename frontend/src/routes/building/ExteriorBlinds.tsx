import { Box } from '@/components/Furniture';
import { FLOOR_COUNT, FLOOR_HEIGHT, LAYOUT_LENGTH, LAYOUT_WIDTH, LENGTH, WIDTH } from '@/data/building';

const blindWidth = 2.25;
const blindHeight = 1.25;

function Blind({ outline }: { outline: string }) {
  return <group>
    <Box size={[blindWidth, .2, .32]} position={[0, .54, 0]} color="#6f7b80" />
    {Array.from({ length: 7 }, (_, i) => (
      <Box key={i} size={[blindWidth - .12, .055, .27]} position={[0, .35 - i * .145, 0]}
        rotation={[.36, 0, 0]} color="#a6b0b2" />
    ))}
    {[-1, 1].map(side => <group key={side}>
      <mesh position={[side * blindWidth / 2, 0, .17]}>
        <boxGeometry args={[.075, blindHeight, .07]} />
        <meshBasicMaterial color={outline} toneMapped={false} />
      </mesh>
      <mesh position={[0, side * blindHeight / 2, .17]}>
        <boxGeometry args={[blindWidth + .075, .075, .07]} />
        <meshBasicMaterial color={outline} toneMapped={false} />
      </mesh>
    </group>)}
  </group>;
}

export default function ExteriorBlinds({ outline, onSelect }: { outline: string; onSelect: () => void }) {
  return <group scale={[WIDTH / LAYOUT_WIDTH, 1, LENGTH / LAYOUT_LENGTH]} onClick={event => {
    event.stopPropagation();
    if (event.delta <= 4) onSelect();
  }}>
    {Array.from({ length: FLOOR_COUNT }, (_, floor) => {
      const top = floor === FLOOR_COUNT - 1;
      const xEdge = top ? 18 : 20;
      const zEdge = top ? 47 : 50;
      return <group key={floor} position={[0, floor * FLOOR_HEIGHT + 2.8, 0]}>
        {[-1, 1].map(side => <group key={side}>
          {[-7.5, 5.5].map(bay => (
            <group key={bay} position={[side * (xEdge + .22), 0, bay * zEdge / 16]} rotation={[0, side * Math.PI / 2, 0]}>
              <Blind outline={outline} />
            </group>
          ))}
          {[-4.5, 4.5].map(bay => (
            <group key={bay} position={[bay * xEdge / 8, 0, side * (zEdge + .22)]} rotation={[0, side === 1 ? 0 : Math.PI, 0]}>
              <Blind outline={outline} />
            </group>
          ))}
        </group>)}
      </group>;
    })}
  </group>;
}
