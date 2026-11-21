import { Canvas } from '@react-three/fiber';
import { Grid, OrbitControls } from '@react-three/drei';
import { Component, type ReactNode } from 'react';
import OfficeBuilding from './OfficeBuilding';
class SceneBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <div className="scene-error">The 3D viewer could not start. Enable WebGL / hardware acceleration and reload. You can still select equipment from the inspector.</div> : this.props.children; }
}
export default function BuildingScene(props: { floor: number; selected: string | null; onSelect: (id: string) => void }) {
  return <SceneBoundary><Canvas shadows camera={{ position: [23, 20, 27], fov: 43 }} fallback={<div className="scene-error">WebGL is unavailable. Use the equipment list to explore the scenario.</div>}>
    <color attach="background" args={['#edf1ed']}/>
    <ambientLight intensity={1.1}/><hemisphereLight args={['#f8fcff', '#b5b79e', 1.3]}/>
    <directionalLight castShadow position={[12, 24, 10]} intensity={2.2} shadow-mapSize={[2048, 2048]} shadow-camera-left={-20} shadow-camera-right={20} shadow-camera-top={20} shadow-camera-bottom={-20} shadow-normalBias={.04}/>
    <OfficeBuilding {...props}/>
    <Grid position={[0, -.57, 0]} args={[70, 70]} cellSize={2} cellColor="#d3ddd2" sectionSize={10} sectionColor="#bdcbbd" fadeDistance={65}/>
    <OrbitControls makeDefault target={[0, 4, 0]} minDistance={10} maxDistance={65} maxPolarAngle={Math.PI / 2.05}/>
  </Canvas></SceneBoundary>;
}
