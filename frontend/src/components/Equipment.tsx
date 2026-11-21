import { Box } from './Furniture';
import type { Device } from '../data/building';
export default function Equipment({ device }: { device: Device }) {
  const accent = '#637a73';
  return <group position={device.position}>
    {device.kind === 'monitor' && <>
      <Box size={[.12, .25, .12]} color="#4d5958" position={[0, -.08, 0]}/>
      <Box size={[.45, .04, .25]} color="#4d5958" position={[0, -.18, 0]}/>
      <Box size={[.95, .58, .09]} color={accent} position={[0, .25, 0]}/>
      <Box size={[.83, .46, .015]} color="#9cc4cb" position={[0, .25, .055]}/>
    </>}
    {device.kind === 'computer' && <>
      <Box size={[.35, .75, .65]} color={accent}/>
      <Box size={[.22, .025, .02]} color="#b8d9ce" position={[0, .2, .335]}/>
    </>}
    {device.kind === 'light' && <>
      <Box size={[1.9, .1, .45]} color={accent}/>
      <mesh position={[0, -.06, 0]}><boxGeometry args={[1.75, .025, .35]}/><meshStandardMaterial color="#fff8d6" emissive="#fff0bd" emissiveIntensity={1.2}/></mesh>
    </>}
    {device.kind === 'toilet' && <>
      <Box size={[.65, .8, .28]} color="#e4ebe8" position={[0, .4, -.3]}/>
      <mesh position={[0, .25, .15]} castShadow><cylinderGeometry args={[.32, .22, .5, 20]}/><meshStandardMaterial color="#eff3ed"/></mesh>
      <mesh position={[0, .52, .15]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[.25, .07, 8, 24]}/><meshStandardMaterial color={accent}/></mesh>
    </>}
    {device.kind === 'heatPump' && <>
      <Box size={[3, 1.5, 1.8]} color={accent} position={[0, .75, 0]}/>
      {[-.75, .75].map(x => <group key={x} position={[x, 1.52, 0]}>
        <mesh rotation={[-Math.PI / 2, 0, 0]}><cylinderGeometry args={[.55, .55, .04, 24]}/><meshStandardMaterial color="#263d39"/></mesh>
        {[0, 1, 2].map(i => <Box key={i} size={[.9, .04, .1]} color="#a9bcb0" rotation={[0, i * Math.PI / 3, 0]} position={[0, .03, 0]}/>)}
      </group>)}
      <Box size={[.3, .25, 2]} color="#c4cbc3" position={[1.2, .15, 1.5]}/>
    </>}
  </group>;
}
