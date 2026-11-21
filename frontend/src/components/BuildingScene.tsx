import { memo, useLayoutEffect, useRef, type ReactNode } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import type { DirectionalLight } from 'three';
import { OrbitControls } from '@react-three/drei';
import Campus from './Campus';
import MountainHorizon from './MountainHorizon';
import OfficeBuilding from './OfficeBuilding';
import type { FloorEquipmentSelection } from './Furniture';

const initialCamera = { position: [95, 80, 125] as [number, number, number], fov: 43, far: 1000 };
const initialTarget: [number, number, number] = [0, 7, 0];
const MemoizedBuilding = memo(OfficeBuilding);

function BuildingSun({ floor, equipment }: { floor: number | null; equipment: ReactNode }) {
  const light = useRef<DirectionalLight>(null!);
  const canvas = useThree(state => state.gl.domElement);
  const invalidate = useThree(state => state.invalidate);

  useLayoutEffect(() => {
    const shadow = light.current.shadow;
    const refresh = () => {
      shadow.needsUpdate = true;
      invalidate();
    };
    // The sun and its casters don't move when the user orbits the building.
    // Refresh when a floor or the equipment layer changes instead.
    refresh();
    canvas.addEventListener('webglcontextrestored', refresh);
    return () => canvas.removeEventListener('webglcontextrestored', refresh);
  }, [canvas, invalidate, floor, equipment]);

  return <directionalLight
    ref={light}
    castShadow
    position={[40, 90, 60]}
    intensity={2.2}
    shadow-autoUpdate={false}
    shadow-mapSize={[2048, 2048]}
    shadow-camera-left={-80}
    shadow-camera-right={80}
    shadow-camera-top={80}
    shadow-camera-bottom={-80}
    shadow-camera-far={250}
    shadow-normalBias={.04}
  />;
}

export default function BuildingScene({ floor, children, equipmentSelection, showBanner }: {
  floor: number | null;
  children?: ReactNode;
  showBanner: boolean;
  equipmentSelection?: FloorEquipmentSelection;
}) {
  return (
    <Canvas
      shadows
      frameloop="demand"
      camera={initialCamera}
      fallback={<p>Enable WebGL to preview the building.</p>}
    >
      <color attach="background" args={['#edf1ed']} />
      <ambientLight intensity={1.1} />
      <hemisphereLight args={['#f8fcff', '#b5b79e', 1.3]} />
      <BuildingSun floor={floor} equipment={children} />
      <MemoizedBuilding floor={floor} showBanner={showBanner} equipmentSelection={equipmentSelection} />
      {children}
      {floor !== -1 && <Campus />}
      <MountainHorizon />
      <OrbitControls target={initialTarget} minDistance={8} maxDistance={300} maxPolarAngle={Math.PI / 2.05} />
    </Canvas>
  );
}
