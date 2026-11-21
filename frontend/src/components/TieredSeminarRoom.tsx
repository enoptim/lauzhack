import { Box } from './Furniture';

// Beyond the red-chair room along the same gallery. The front aisle and
// gallery doorway are at grade; rows rise away from the presenter.
export default function TieredSeminarRoom() {
  return <group name="seminar-room-2" position={[14.65,0,10.6]}>
    <Box size={[7.6,.04,15]} position={[0,.022,0]} color="#888785"/>
    <Box size={[7.6,3.5,.12]} position={[0,1.75,-7.45]} color="#dedbd1"/>
    {/* The adjacent room's end wall closes the presentation end. */}
    <Box size={[.09,3.5,11.5]} position={[-3.75,1.75,-1.75]} color="#dad8d1"/>
    <Box size={[.09,3.5,1.1]} position={[-3.75,1.75,6.95]} color="#dad8d1"/>
    <Box size={[4.8,1.45,.1]} position={[0,2.12,7.41]} color="#ecebe5"/>
    <Box size={[1.8,.1,.9]} position={[-.7,.88,5.82]} color="#e7e3d7"/>
    <Box size={[.78,.8,.62]} position={[-.7,.44,5.82]} color="#cccac3"/>
    <Box size={[.58,.36,.07]} position={[-.7,1.12,5.75]} color="#333942"/>
    <Box size={[.08,.75,.08]} position={[0,3.58,1]} color="#929493"/>
    <Box size={[.68,.27,.54]} position={[0,3.1,1]} color="#d9d8d2"/>
    <Box size={[.14,.14,.04]} position={[-.17,3.1,1.28]} color="#353943"/>
    {Array.from({length:7},(_,row)=>{
      const height=.12+row*.19, z=3-row*1.5;
      return <group key={row} position={[0,0,z]}>
        <Box size={[7.15,height,1.5]} position={[0,height/2,0]} color="#545559"/>
        {[-2.35,-1.47,-.59,.59,1.47,2.35].map(x=><group key={x} position={[x,height,0]}>
          <Box size={[.19,.43,.24]} position={[0,.215,0]} color="#35373b"/>
          <Box size={[.65,.13,.64]} position={[0,.46,0]} color="#496dab"/>
          <Box size={[.64,.53,.12]} position={[0,.74,-.28]} color="#42639a"/>
        </group>)}
      </group>;
    })}
  </group>;
}
