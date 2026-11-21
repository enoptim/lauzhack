import { Canvas, useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import type { Group } from 'three';

/** Toy colours: brand orange shirt, brand light-green hard hat. */
const COLORS = {
  shirt: '#c34e00',
  trousers: '#3a3f47',
  skin: '#f1c7a1',
  hair: '#4a3426',
  hat: '#bbce8a',
  ink: '#1f1f1f',
  shoe: '#262626',
};

function Tom({ still }: { still: boolean }) {
  const body = useRef<Group>(null);
  const arm = useRef<Group>(null);

  useFrame(({ clock }) => {
    if (still || !body.current || !arm.current) return;
    const t = clock.getElapsedTime();
    body.current.position.y = Math.abs(Math.sin(t * 3.2)) * 0.06;
    body.current.rotation.y = Math.sin(t * 0.9) * 0.35;
    arm.current.rotation.z = 2.5 + Math.sin(t * 7) * 0.35;
  });

  const toy = { roughness: 0.55, metalness: 0 };
  return (
    <group ref={body}>
      {/* legs and shoes */}
      {[-0.12, 0.12].map(x => (
        <group key={x} position={[x, 0, 0]}>
          <mesh position={[0, 0.36, 0]}><capsuleGeometry args={[0.09, 0.36, 6, 16]} /><meshStandardMaterial color={COLORS.trousers} {...toy} /></mesh>
          <mesh position={[0, 0.07, 0.04]}><sphereGeometry args={[0.1, 16, 12]} /><meshStandardMaterial color={COLORS.shoe} {...toy} /></mesh>
        </group>
      ))}
      {/* body */}
      <mesh position={[0, 0.92, 0]}><capsuleGeometry args={[0.25, 0.32, 8, 20]} /><meshStandardMaterial color={COLORS.shirt} {...toy} /></mesh>
      {/* left arm, resting */}
      <group position={[-0.3, 1.1, 0]} rotation={[0, 0, -0.25]}>
        <mesh position={[0, -0.2, 0]}><capsuleGeometry args={[0.075, 0.3, 6, 12]} /><meshStandardMaterial color={COLORS.shirt} {...toy} /></mesh>
        <mesh position={[0, -0.42, 0]}><sphereGeometry args={[0.08, 12, 10]} /><meshStandardMaterial color={COLORS.skin} {...toy} /></mesh>
      </group>
      {/* right arm, waving */}
      <group ref={arm} position={[0.3, 1.1, 0]} rotation={[0, 0, 2.5]}>
        <mesh position={[0, -0.2, 0]}><capsuleGeometry args={[0.075, 0.3, 6, 12]} /><meshStandardMaterial color={COLORS.shirt} {...toy} /></mesh>
        <mesh position={[0, -0.42, 0]}><sphereGeometry args={[0.08, 12, 10]} /><meshStandardMaterial color={COLORS.skin} {...toy} /></mesh>
      </group>
      {/* head */}
      <group position={[0, 1.52, 0]}>
        <mesh><sphereGeometry args={[0.27, 32, 24]} /><meshStandardMaterial color={COLORS.skin} {...toy} /></mesh>
        {/* hair peeking out under the hat */}
        <mesh position={[0, 0.06, -0.04]} scale={[1.02, 0.9, 1.02]}><sphereGeometry args={[0.27, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2.4]} /><meshStandardMaterial color={COLORS.hair} {...toy} /></mesh>
        {/* hard hat: dome and brim */}
        <mesh position={[0, 0.1, 0]}><sphereGeometry args={[0.285, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2]} /><meshStandardMaterial color={COLORS.hat} {...toy} /></mesh>
        <mesh position={[0, 0.1, 0.03]}><cylinderGeometry args={[0.34, 0.34, 0.035, 32]} /><meshStandardMaterial color={COLORS.hat} {...toy} /></mesh>
        {/* face: eyes and a smile */}
        {[-0.09, 0.09].map(x => (
          <mesh key={x} position={[x, 0, 0.25]}><sphereGeometry args={[0.032, 12, 10]} /><meshStandardMaterial color={COLORS.ink} /></mesh>
        ))}
        <mesh position={[0, -0.07, 0.245]} rotation={[0.15, 0, Math.PI]}>
          <torusGeometry args={[0.075, 0.016, 8, 24, Math.PI]} />
          <meshStandardMaterial color={COLORS.ink} />
        </mesh>
        {[-0.15, 0.15].map(x => (
          <mesh key={x} position={[x, -0.06, 0.22]}><sphereGeometry args={[0.035, 12, 10]} /><meshStandardMaterial color="#e89a86" transparent opacity={0.55} /></mesh>
        ))}
      </group>
    </group>
  );
}

/** Tom Watts as a small toy figurine: smiles, waves and bobs while the twin works. */
export default function Figurine({ className }: { className?: string }) {
  const still = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  return (
    <div className={className} role="img" aria-label="Tom Watts, the building’s energy manager, waving">
      <Canvas camera={{ position: [0, 1.0, 4.4], fov: 30 }} gl={{ alpha: true, antialias: true }} dpr={[1, 2]}
        onCreated={({ camera }) => camera.lookAt(0, 0.95, 0)} style={{ width: '100%', height: '100%' }}>
        <ambientLight intensity={1.1} />
        <directionalLight position={[2, 4, 3]} intensity={1.6} />
        <directionalLight position={[-3, 2, -2]} intensity={0.4} />
        <Tom still={Boolean(still)} />
        {/* soft shadow on the floor */}
        <mesh position={[0, 0.001, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[0.42, 32]} />
          <meshBasicMaterial color="#000000" transparent opacity={0.08} />
        </mesh>
      </Canvas>
    </div>
  );
}
