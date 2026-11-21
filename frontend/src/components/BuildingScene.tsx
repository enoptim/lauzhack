import { Canvas } from '@react-three/fiber';
import { Grid, OrbitControls } from '@react-three/drei';
import OfficeBuilding from './OfficeBuilding';

export default function BuildingScene() {
  return (
    <Canvas
      shadows
      camera={{ position: [95, 80, 125], fov: 43, far: 1000 }}
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
      <OfficeBuilding />
      <Grid position={[0, -.72, 0]} args={[300, 300]} cellSize={5} cellColor="#d3ddd2" sectionSize={25} sectionColor="#bdcbbd" fadeDistance={250} />
      <OrbitControls makeDefault target={[0, 7, 0]} minDistance={8} maxDistance={300} maxPolarAngle={Math.PI / 2.05} />
    </Canvas>
  );
}
