import type { ReactNode } from 'react';
import { Edges } from '@react-three/drei';
import type { ThreeElements } from '@react-three/fiber';

type DeviceSelection = { outline: string; onSelect: () => void };
export type WorkstationSelection = { monitors: DeviceSelection; computers: DeviceSelection };
export type FloorEquipmentSelection = WorkstationSelection & { coffee: DeviceSelection };
type DeviceProps = { position: [number, number, number]; selection?: DeviceSelection };

function Device({ position, selection, size, color, children }: DeviceProps & {
  size: [number, number, number]; color: string; children?: ReactNode;
}) {
  return (
    <mesh position={position} castShadow receiveShadow onClick={selection && (event => {
      event.stopPropagation();
      if (event.delta <= 4) selection.onSelect();
    })}>
      <boxGeometry args={size} />
      <meshStandardMaterial color={color} roughness={.75} />
      {selection && <Edges lineWidth={2} color={selection.outline} />}
      {children}
    </mesh>
  );
}
export function Monitor(props: DeviceProps) {
  return <Device {...props} size={[.52, .35, .04]} color="#333a42" />;
}
export function Computer(props: DeviceProps) {
  return <Device {...props} size={[.22, .42, .36]} color="#333738" />;
}
export function CoffeeMachine(props: DeviceProps) {
  return <Device {...props} size={[.55, .66, .64]} color="#363b3d">
    <Box size={[.05, .21, .48]} position={[.285, .18, 0]} color="#a9afaf" />
    <Box size={[.03, .1, .24]} position={[.32, .19, 0]} color="#252b2b" />
    <Box size={[.21, .045, .49]} position={[.35, -.285, 0]} color="#8a9193" />
    <Box size={[.12, .07, .1]} position={[.33, .015, 0]} color="#212524" />
    <mesh position={[.385, -.2, 0]} castShadow>
      <cylinderGeometry args={[.055, .043, .12, 12]} />
      <meshStandardMaterial color="#f4eee0" />
    </mesh>
  </Device>;
}
export function Box({ size, color, ...props }: Omit<ThreeElements['mesh'], 'args'> & { size: [number, number, number]; color: string }) {
  return <mesh castShadow receiveShadow {...props}><boxGeometry args={size}/><meshStandardMaterial color={color} roughness={.75}/></mesh>;
}
export function Desk({ position, workstationSelection }: { position: [number, number, number]; workstationSelection?: WorkstationSelection }) {
  return <group position={position}>
    <Box size={[2.5, .12, 1.25]} color="#d7b88b" position={[0, 1, 0]}/>
    {[-1, 1].map(x => <Box key={x} size={[.09, 1, .95]} color="#65746e" position={[x, .5, 0]}/>)}
    <Box size={[.7, .12, .65]} color="#45635b" position={[0, .55, 1]}/>
    <Box size={[.7, .7, .1]} color="#45635b" position={[0, .9, 1.3]}/>
    <Box size={[.12, .5, .12]} color="#65746e" position={[0, .25, 1]}/>
    <Box size={[.65, .08, .65]} color="#65746e" position={[0, .08, 1]}/>
    <Box size={[.6, .025, .22]} color="#dce2de" position={[0, 1.08, .35]}/>
    <Box size={[.18, .025, .14]} color="#333a42" position={[0, 1.073, -.25]}/>
    <Box size={[.05, .16, .05]} color="#333a42" position={[0, 1.16, -.25]}/>
    <Monitor position={[0, 1.34, -.22]} selection={workstationSelection?.monitors} />
    <Computer position={[.52, 1.27, -.22]} selection={workstationSelection?.computers} />
  </group>;
}
export function Plant({ position }: { position: [number, number, number] }) {
  return <group position={position}>
    <mesh position={[0, .25, 0]} castShadow><cylinderGeometry args={[.28, .2, .5, 12]}/><meshStandardMaterial color="#c78163"/></mesh>
    <mesh position={[0, .85, 0]} castShadow><icosahedronGeometry args={[.5, 1]}/><meshStandardMaterial color="#59795a"/></mesh>
  </group>;
}
