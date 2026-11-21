import { useLayoutEffect, useRef, type ComponentRef, type ReactNode } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import Campus from './Campus';
import MountainHorizon from './MountainHorizon';
import OfficeBuilding from './OfficeBuilding';

import { FLOOR_HEIGHT } from '../data/building';

const overviewPosition: [number, number, number] = [95, 80, 125];

function BuildingCamera({ floor }: { floor: number | null }) {
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null);
  const camera = useThree(state => state.camera);

  useLayoutEffect(() => {
    if (!controls.current) return;
    if (floor === null) {
      camera.position.set(...overviewPosition);
      controls.current.target.set(0, 7, 0);
    } else {
      const y = floor * FLOOR_HEIGHT;
      camera.position.set(20, y + 90, 28);
      controls.current.target.set(0, y + 1, 0);
    }
    controls.current.update();
  }, [camera, floor]);

  return <OrbitControls ref={controls} minDistance={8} maxDistance={300} maxPolarAngle={Math.PI / 2.05} />;
}

export default function BuildingScene({ floor, children }: { floor: number | null; children?: ReactNode }) {
  return (
    <Canvas
      shadows
      camera={{ position: overviewPosition, fov: 43, far: 1000 }}
      fallback={<p>Enable WebGL to preview the building.</p>}
    >
      <color attach="background" args={['#edf1ed']} />
      <ambientLight intensity={1.1} />
      <hemisphereLight args={['#f8fcff', '#b5b79e', 1.3]} />
      <directionalLight
        castShadow
        position={[40, 90, 60]}
        intensity={2.2}
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-80}
        shadow-camera-right={80}
        shadow-camera-top={80}
        shadow-camera-bottom={-80}
        shadow-camera-far={250}
        shadow-normalBias={.04}
      />
      <OfficeBuilding floor={floor} />
      {children}
      <Campus />
      <MountainHorizon />
      <BuildingCamera floor={floor} />
    </Canvas>
  );
}
