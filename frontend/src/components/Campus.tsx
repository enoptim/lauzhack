import { Box } from './Furniture';

// Schematic site plan inspired by the aerial reference. Ground is just below
// the existing BC plinth; none of these coordinates belong to the building.
function Paving({x,z,w,d,color,y=.02}: {x:number;z:number;w:number;d:number;color:string;y?:number}) {
  return <mesh rotation={[-Math.PI/2,0,0]} position={[x,y,z]} receiveShadow><planeGeometry args={[w,d]}/><meshStandardMaterial color={color}/></mesh>;
}
function Tree({x,z,i}: {x:number;z:number;i:number}) {
  const h=3.1+(i%3)*.45;
  return <group position={[x,0,z]}>
    <Box size={[.45,2.8,.45]} position={[0,1.4,0]} color="#837862"/>
    <mesh position={[0,h,0]} scale={[2.1,h*.72,2.2]} rotation={[0,i,0]} castShadow><icosahedronGeometry args={[1,1]}/><meshStandardMaterial flatShading color={['#799370','#839970','#6e896c'][i%3]}/></mesh>
  </group>;
}
function Wing({x,z}: {x:number;z:number}) {
  return <group position={[x,0,z]}>
    <Box size={[37,5,12]} position={[0,2.5,0]} color="#d3d1c6"/>
    <Box size={[37.5,.35,12.5]} position={[0,5.18,0]} color="#afb5b1"/>
    {[-4,0,4].map(dz=><Box key={dz} size={[29,.12,2.4]} position={[0,5.42,dz]} color="#849499"/>)}
    <Box size={[33,1.1,.12]} position={[0,3,6.04]} color="#98aaa9"/>
  </group>;
}
export default function Campus() {
  const road='#999e9c', path='#d9d7c8';
  return <group position={[0,-.73,0]}>
    <Paving x={0} z={0} w={560} d={560} color="#b9c5a6" y={0}/>
    <Paving x={0} z={0} w={60} d={78} color={path}/>
    <Paving x={-33} z={0} w={8} d={87} color={road} y={.027}/>
    <Paving x={40} z={44} w={210} d={8} color={road} y={.03}/>
    <group position={[-69,0,44]} rotation={[0,-.19,0]}><Paving x={0} z={0} w={9} d={310} color={road}/></group>
    {[[13,road],[7.6,path],[6.4,'#a4b593']].map(([radius,color],i)=><mesh key={i} position={[-69,.04+i*.015,44]} rotation={[-Math.PI/2,0,0]} receiveShadow><circleGeometry args={[Number(radius),48]}/><meshStandardMaterial color={String(color)}/></mesh>)}
    <Tree x={-69} z={44} i={1}/>
    {[-26,-12,2,16,30].map((z,i)=><Tree key={z} x={-41-i*.7} z={z} i={i}/>)}
    {[-2,10,22,34,46,58,70].map((x,i)=><Tree key={x} x={x} z={38} i={i}/>)}
    <Paving x={58} z={-8} w={54} d={78} color={path}/>
    {[-36,-9,19].map(z=><Wing key={z} x={59} z={z}/>)}
    {[-23,5].map(z=><group key={z}><Paving x={59} z={z} w={35} d={7} color="#a9bc9b" y={.04}/>{[46,59,72].map((x,i)=><Tree key={x} x={x} z={z} i={i}/>)}</group>)}
    <Paving x={39} z={64} w={62} d={22} color="#b0b2aa"/>
    {Array.from({length:17},(_,i)=><group key={i} position={[13+3.15*i,0,64]}>
      {[-6,6].map(z=><Paving key={z} x={0} z={z} w={.1} d={5} color="#e4e2d5" y={.04}/>)}
      {i%3!==0 && <group position={[1.5,0,i%2===0?6:-6]}><Box size={[1.65,.75,3.8]} position={[0,.52,0]} color={['#879697','#d5c9bd','#818b97'][i%3]}/><Box size={[1.35,.44,1.95]} position={[0,1.08,0]} color="#829193"/></group>}
    </group>)}
  </group>;
}
