import { Box, CoffeeMachine, type FloorEquipmentSelection } from './Furniture';

function CafeTable({x,z}: {x:number;z:number}) {
  return <group position={[x,0,z]}>
    <Box size={[1.3,.07,1.65]} position={[0,.77,0]} color="#e7e3d6"/>
    <Box size={[.13,.74,.13]} position={[0,.37,0]} color="#777d7c"/>
    <Box size={[.7,.06,.75]} position={[0,.04,0]} color="#777d7c"/>
    {[-1,1].map(side=><group key={side} position={[0,0,side*1.08]}>
      <Box size={[.48,.08,.56]} position={[0,.46,0]} color="#be4433"/>
      <mesh position={[0,.73,side*.25]} scale={[.26,.3,.05]}><sphereGeometry args={[1,12,10]}/><meshStandardMaterial color="#ba392c"/></mesh>
      {[-.19,.19].map(dx=><Box key={dx} size={[.035,.43,.42]} position={[dx,.22,0]} color="#818789"/>)}
    </group>)}
  </group>;
}

// Floor-local coordinates. Keep fixtures west of the continuous atrium gallery.
export default function TopCantina({ coffeeSelection }: { coffeeSelection?: FloorEquipmentSelection['coffee'] }) {
  return <group name="floor-4-cantina">
    <Box size={[6.8,.025,74]} position={[-14.25,.014,-7]} color="#83817c"/>
    {/* Dining corner diagonally across from the toilets (+X,+Z). */}
    {[-16,-12.7].flatMap(x=>[-40,-35,-30,-25].map(z=><CafeTable key={`${x}:${z}`} x={x} z={z}/>))}
    {['#b6b5ab','#799fa8','#ceaa48','#97ac62'].map((color,i)=><group key={color} position={[-16.7+i*1.03,0,-43]}>
      <Box size={[.97,1.1,.85]} position={[0,.57,0]} color={color}/>
      <Box size={[.45,.15,.03]} position={[0,.96,.44]} color="#383c39"/>
    </group>)}
    {/* Open serving line faces the seminar rooms across the void. */}
    <group position={[-16,0,15]}>
      <Box size={[1.35,1,22]} position={[0,.53,0]} color="#929796"/>
      <Box size={[1.65,.09,22.2]} position={[0,1.07,0]} color="#c5cac7"/>
      <Box size={[.12,3.5,22]} position={[-1.65,1.75,0]} color="#4f5251"/>
      <Box size={[.14,3.45,3.4]} position={[-1.56,1.73,-8.8]} color="#bb4033"/>
      <Box size={[2.6,.26,22.3]} position={[-.48,3.15,0]} color="#828887"/>
      {[-5,-2,1,4].map(z=><group key={z} position={[0,1.18,z]}>
        <Box size={[1,.14,2.3]} color="#5e6664"/>
        <Box size={[.78,.1,2.05]} position={[0,.09,0]} color={z<0?'#d3a660':'#93a775'}/>
      </group>)}
      <mesh position={[.6,1.58,-.5]}><boxGeometry args={[.04,.88,12]}/><meshStandardMaterial color="#b9d9d9" transparent opacity={.28} depthWrite={false}/></mesh>
      {[-6.5,5.5].map(z=><Box key={z} size={[.07,.9,.07]} position={[.6,1.56,z]} color="#7c8383"/>)}
      <Box size={[.92,.8,1.15]} position={[0,1.52,-8.4]} color="#343938"/>
      <CoffeeMachine position={[0, 1.445, 8]} selection={coffeeSelection} />
      {[-3,0,3].map(z=><Box key={z} size={[.1,.7,1.6]} position={[-1.51,2.35,z]} color="#282d30"/>)}
    </group>
    {[-17,-11,-5,3,10,17,24].map(z=><CafeTable key={z} x={-11.75} z={z}/>)}
  </group>;
}
