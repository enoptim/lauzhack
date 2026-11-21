import type { ThreeElements } from '@react-three/fiber';
export function Box({ size, color, ...props }: Omit<ThreeElements['mesh'], 'args'> & { size: [number, number, number]; color: string }) {
  return <mesh castShadow receiveShadow {...props}><boxGeometry args={size}/><meshStandardMaterial color={color} roughness={.75}/></mesh>;
}
export function Desk({ position }: { position: [number, number, number] }) {
  return <group position={position}>
    <Box size={[2.5, .12, 1.25]} color="#d7b88b" position={[0, 1, 0]}/>
    {[-1, 1].map(x => <Box key={x} size={[.09, 1, .95]} color="#65746e" position={[x, .5, 0]}/>)}
    <Box size={[.7, .12, .65]} color="#45635b" position={[0, .55, 1]}/>
    <Box size={[.7, .7, .1]} color="#45635b" position={[0, .9, 1.3]}/>
    <Box size={[.12, .5, .12]} color="#65746e" position={[0, .25, 1]}/>
    <Box size={[.65, .08, .65]} color="#65746e" position={[0, .08, 1]}/>
    <Box size={[.6, .025, .22]} color="#dce2de" position={[0, 1.08, .35]}/>
  </group>;
}
export function Plant({ position }: { position: [number, number, number] }) {
  return <group position={position}>
    <mesh position={[0, .25, 0]} castShadow><cylinderGeometry args={[.28, .2, .5, 12]}/><meshStandardMaterial color="#c78163"/></mesh>
    <mesh position={[0, .85, 0]} castShadow><icosahedronGeometry args={[.5, 1]}/><meshStandardMaterial color="#59795a"/></mesh>
  </group>;
}
