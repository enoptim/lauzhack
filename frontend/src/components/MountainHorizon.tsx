import { useMemo } from 'react';
import { DoubleSide, Shape, ShapeGeometry } from 'three';

const RIDGES = [
  { depth: -580, x: -220, height: 96, phase: 1.1, color: '#b8c7d0' },
  { depth: -485, x: -175, height: 65, phase: 2.6, color: '#a5b8c0' },
  { depth: -395, x: -135, height: 41, phase: 4.2, color: '#94aab0' },
];

function Ridge({ depth, x, height, phase, color }: typeof RIDGES[number]) {
  const geometry = useMemo(() => {
    const shape = new Shape();
    shape.moveTo(-720, -30);
    for (let i = 0; i <= 144; i++) {
      const t = i / 144;
      const peaks = .45 + .25 * Math.sin(t * 31 + phase)
        + .16 * Math.cos(t * 65 - phase) + .09 * Math.sin(t * 149 + phase);
      shape.lineTo(-720 + 1440 * t, 12 + height * peaks);
    }
    shape.lineTo(720, -30);
    shape.closePath();
    return new ShapeGeometry(shape);
  }, [height, phase]);

  return <mesh position={[x, 0, depth]} geometry={geometry}>
    <meshBasicMaterial color={color} side={DoubleSide} fog={false} toneMapped={false} />
  </mesh>;
}

export default function MountainHorizon() {
  return <group rotation={[0, .34, 0]}>
    {RIDGES.map(ridge => <Ridge key={ridge.depth} {...ridge} />)}
  </group>;
}
