import { useTexture } from '@react-three/drei';
import { SRGBColorSpace } from 'three';
import { Box } from './Furniture';

// Corridor-facing side is local -X. Keep this block outside the gallery at x=10.7.
export default function CornerToilets() {
  const sign = useTexture('/wc-direction.svg');
  sign.colorSpace = SRGBColorSpace;
  return <group position={[11,0,39.6]}>
    <Box size={[6.4,3.5,9]} position={[3.2,1.75,0]} color="#505350"/>
    <Box size={[.08,.14,9]} position={[-.04,.07,0]} color="#303331"/>
    {[-2.85,0,2.85].map((z,i)=><group key={z} position={[-.055,0,z]}>
      <Box size={[.09,2.35,i===0?1.95:1.5]} position={[0,1.175,0]} color="#656763"/>
      <Box size={[.06,2.26,i===0?1.8:1.35]} position={[-.06,1.13,0]} color="#484c49"/>
      <Box size={[.14,.05,.26]} position={[-.15,.94,.45]} color="#bec1b8"/>
      <Box size={[.025,.09,.28]} position={[-.1,1.68,0]} color="#e4e3d8"/>
    </group>)}
    <mesh position={[-.16,1.7,-2.85]} rotation={[0,-Math.PI/2,0]}><planeGeometry args={[.75,.375]}/><meshStandardMaterial map={sign}/></mesh>
    <mesh position={[.95,1.65,-4.52]} rotation={[0,Math.PI,0]}><planeGeometry args={[1.35,.675]}/><meshStandardMaterial map={sign}/></mesh>
    {['#dfd6ba','#758e83','#bd995d'].map((color,i)=><Box key={color} size={[1.03,1.42,.035]} position={[2.45+i*1.14,1.65,-4.53]} color={color}/>)}
  </group>;
}
