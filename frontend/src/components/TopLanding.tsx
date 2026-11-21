import TieredSeminarRoom from './TieredSeminarRoom';
import CornerToilets from './CornerToilets';
import { Box, Plant } from './Furniture';

// The final flight exits toward +Z; the seminar room is on the visitor's left (+X).
export default function TopLanding() {
  return <group>
    {/* A continuous grey gallery on the existing slab, outside the glass rails
        at x=±8 and z=±32. Keep the stair exit at the near end open. */}
    {[-9.35,9.35].map(x=><Box key={x} size={[2.7,.025,64]} position={[x,.013,0]} color="#757572"/>)}
    <Box size={[21.4,.025,4.5]} position={[0,.013,-34.25]} color="#757572"/>
    <Box size={[34,.025,14]} position={[0,.013,39]} color="#757572"/>
    {/* Glazed lobby doors, high blue lights and a waiting bench off the stair axis. */}
    <Box size={[16,3.8,.16]} position={[0,1.9,45.5]} color="#d6d4c8"/>
    {[-6,-2,2,6].map(x=><group key={x} position={[x,0,45.36]}>
      <Box size={[1.5,2.35,.1]} position={[-.7,1.2,0]} color="#919e99"/>
      <Box size={[1.6,2.35,.1]} position={[1,1.2,0]} color="#b7c5c3"/>
      <Box size={[3.4,.44,.08]} position={[0,3.42,0]} color="#466ebe"/>
    </group>)}
    <Box size={[3.7,.15,.8]} position={[-4,.51,38]} color="#dedbd0"/>
    <Box size={[3.7,.54,.12]} position={[-4,.83,38.34]} color="#dedbd0"/>
    {[-5.4,-2.6].map(x=><Box key={x} size={[.09,.5,.6]} position={[x,.26,38]} color="#778285"/>)}
    <Plant position={[-6.8,0,41]}/><Plant position={[5.8,0,43]}/>
    <mesh position={[0,2.96,45.16]} rotation={[Math.PI/2,0,0]}><cylinderGeometry args={[.3,.3,.08,24]}/><meshStandardMaterial color="#eeeae0"/></mesh>
    <Box size={[.025,.2,.04]} position={[0,3.05,45.1]} color="#30383b"/>
    <Box size={[.13,.025,.04]} position={[.06,2.96,45.1]} color="#30383b"/>
    {/* Room entry: gap in the west wall immediately off the landing. */}
    <CornerToilets/>
    <TieredSeminarRoom/>
    <group position={[14.35,0,25.7]} scale={[.73,1,.88]}>
      <Box size={[9.5,.04,17]} position={[0,.022,0]} color="#858482"/>
      <Box size={[9.5,3.5,.14]} position={[0,1.75,8.45]} color="#54585a"/>
      <Box size={[9.5,3.5,.14]} position={[0,1.75,-8.45]} color="#dbd8cb"/>
      <Box size={[.12,3.5,8]} position={[-4.7,1.75,4.45]} color="#dbd8cb"/>
      <Box size={[.12,3.5,5.8]} position={[-4.7,1.75,-5.55]} color="#dbd8cb"/>
      {[-1.68,1.68].map(x=><Box key={x} size={[3.25,1.35,.12]} position={[x,2,8.31]} color="#24282a"/>)}
      <Box size={[5,.1,.95]} position={[0,.8,6.9]} color="#d9d5c9"/>
      {[-2.2,2.2].map(x=><Box key={x} size={[.08,.75,.75]} position={[x,.4,6.9]} color="#737779"/>)}
      <Box size={[.9,1.08,.9]} position={[-3.4,.56,6.5]} color="#555758"/>
      {[-5,-2.8,-.6,1.6,3.8].flatMap(z=>[-3,-2,-1,1,2,3].map(x=><group key={`${x}:${z}`} position={[x,0,z]}>
        <Box size={[.5,.1,.65]} color="#b93c2d" position={[0,.5,0]}/>
        <Box size={[.48,.5,.08]} color="#ae342a" position={[0,.72,-.29]}/>
        {[-.2,.2].map(dx=><Box key={dx} size={[.04,.45,.45]} position={[dx,.26,0]} color="#838889"/>)}
      </group>))}
    </group>
  </group>;
}
