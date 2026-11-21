import { useMemo } from 'react';
import { BufferGeometry, DoubleSide, Float32BufferAttribute } from 'three';
import { FLOOR_HEIGHT, STAIR_CENTER_Z } from '../data/building';
import { Box } from './Furniture';

const INNER = .7;
const OUTER = 3;
const STEPS = 24;
// Leave a gap in each turn for the flat landing facing the entrance (+Z).
const START = Math.PI / 2 + .25;
const SWEEP = Math.PI * 2 - .5;
const STEP_ANGLE = SWEEP / STEPS;

function treadGeometry() {
  const positions: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i <= 4; i++) {
    const angle = i / 4 * STEP_ANGLE;
    for (const y of [0, -.14]) {
      for (const r of [INNER, OUTER]) {
        positions.push(Math.cos(angle) * r, y, Math.sin(angle) * r);
      }
    }
    if (i < 4) {
      const n = i * 4;
      indices.push(n, n + 4, n + 1, n + 1, n + 4, n + 5);
      indices.push(n + 2, n + 3, n + 6, n + 3, n + 7, n + 6);
      indices.push(n + 1, n + 5, n + 3, n + 3, n + 5, n + 7);
      indices.push(n, n + 2, n + 4, n + 2, n + 6, n + 4);
    }
  }
  indices.push(0, 1, 2, 1, 3, 2, 16, 18, 17, 17, 18, 19);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function Flight() {
  const tread = useMemo(treadGeometry, []);
  const ribbon = useMemo(() => {
    const positions: number[] = [];
    const indices: number[] = [];
    for (let i = 0; i <= 96; i++) {
      const t = i / 96;
      const angle = START + t * SWEEP;
      const y = FLOOR_HEIGHT / STEPS + t * (FLOOR_HEIGHT - FLOOR_HEIGHT / STEPS);
      positions.push(Math.cos(angle) * OUTER, y - .16, Math.sin(angle) * OUTER);
      positions.push(Math.cos(angle) * OUTER, y + 1.05, Math.sin(angle) * OUTER);
      if (i < 96) {
        const n = i * 2;
        indices.push(n, n + 2, n + 1, n + 1, n + 2, n + 3);
      }
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
  }, []);

  return <group>
    {Array.from({ length: STEPS }, (_, i) => <group key={i} position={[0, (i + 1) * FLOOR_HEIGHT / STEPS, 0]} rotation={[0, -(START + i * STEP_ANGLE), 0]}>
      <mesh geometry={tread} castShadow receiveShadow><meshStandardMaterial color="#b9bcb8" side={DoubleSide}/></mesh>
      <Box size={[.07, 1, .07]} color="#c52d3f" position={[INNER, .5, 0]}/>
    </group>)}
    <mesh geometry={ribbon} castShadow><meshStandardMaterial color="#d9ddda" side={DoubleSide} roughness={.65}/></mesh>
  </group>;
}

export default function Staircase({ floors }: { floors: number }) {
  return <group position={[0, 0, STAIR_CENTER_Z]}>
    <group position={[0, -FLOOR_HEIGHT, 0]}><Flight/></group>
    {Array.from({ length: Math.max(0, floors - 1) }, (_, level) => <group key={level} position={[0, level * FLOOR_HEIGHT, 0]}><Flight/></group>)}
    {/* Landings reach past the atrium edge (world Z=32), flush with floor tops. */}
    {Array.from({ length: floors }, (_, level) => <group key={level} position={[0, level * FLOOR_HEIGHT, 0]}>
      <Box size={[1.8, .22, 4.7]} color="#d0cec5" position={[0, -.11, 2.95]}/>
      {[-.9, .9].map(x => <Box key={x} size={[.06, 1.05, 2.35]} color="#d9ddda" position={[x, .525, 4.125]}/>)}
    </group>)}
  </group>;
}
