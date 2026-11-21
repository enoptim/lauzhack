import { useLayoutEffect, useRef } from 'react';
import { Color, DoubleSide, InstancedMesh, Object3D, SRGBColorSpace } from 'three';
import { sideRooms } from '../data/sideRooms';
import { useTexture } from '@react-three/drei';
import { Computer, Monitor, type WorkstationSelection } from './Furniture';

type Part = [number, number, number, number, number, number, string];
const parts: Part[] = [];
const workstations: { monitor: [number, number, number]; computer: [number, number, number] }[] = [];
const box = (...p: Part) => parts.push(p);
const steel = '#818c90';
function table(x: number, z: number, width: number, depth = 1.25) {
  box(x,.76,z,width,.06,depth,'#efece4');
  for (const dx of [-1,1]) for (const dz of [-1,1])
    box(x+dx*(width/2-.12),.37,z+dz*(depth/2-.125),.055,.74,.055,steel);
}
function chair(x: number, z: number, facing: number, color: string, axis: 'x' | 'z' = 'z') {
  box(x,.45,z,.48,.07,.48,color);
  if (axis === 'x') box(x-facing*.21,.67,z,.06,.42,.44,color);
  else box(x,.67,z-facing*.21,.44,.42,.06,color);
  for (const dx of [-.19,.19]) for (const dz of [-.18,.18])
    box(x+dx,.21,z+dz,.035,.42,.035,steel);
}
const glazing: {x:number; z:number; depth:number}[] = [];
for (const {ring, seats, lab} of sideRooms) {
  const xs = ring.map(p=>p[0]), zs = ring.map(p=>p[1]);
  const left=Math.min(...xs), right=Math.max(...xs), front=Math.min(...zs), back=Math.max(...zs);
  const entry = left > 0 ? left : right;
  for (let i=1; i<ring.length; i++) {
    const [x,z]=ring[i-1], [u,v]=ring[i];
    if (x === entry && u === entry) {
      const depth=Math.abs(v-z)-2;
      glazing.push({x,z:Math.min(z,v)+depth/2,depth}); // leave doorway at aisle end
    } else if (x===u) {
      // Exterior glazing already exists; don't hide it behind solid walls.
      glazing.push({x,z:(z+v)/2,depth:Math.abs(v-z)});
    } else box((x+u)/2,1.8,(z+v)/2,Math.abs(u-x),3.6,.09,'#b9bcb7');
  }
  // Inset rows clear partitions (including BC_01's small facade notch),
  // with a continuous aisle at the door. Never squeeze in the remaining seats.
  let placed=0;
  const width=lab ? 2.3 : 3.1;
  for (let x=left+1.4+width/2;x+width/2<=right-1.4;x+=width+1.15) {
    for (let z=front+2;z<=back-2 && placed<seats;z+=lab?2.8:3.8) {
      table(x,z,width);
      for (const facing of (lab?[1]:[-1,1])) for (const dx of [-.56,.56]) {
        if (placed>=seats) break;
        chair(x+dx,z-facing*.95,facing,'#b83a30'); placed++;
        if (lab) workstations.push({
          monitor: [x+dx, 1.05, z+.16],
          computer: [x+dx+Math.sign(dx)*.4, 1, z+.16],
        });
      }
    }
  }
}
// Back-to-back display boards, with outward-facing booth tables and grey chairs.
const colors = ['#343f78','#505655','#82546a','#345962'];
for (let i=0;i<3;i++) for (const side of [-1,1]) {
  const z = -12+i*14, x = side*.65;
  box(x,1.43,z,.1,2.7,4.3,steel);
  box(x+side*.065,1.44,z,.04,2.5,4.12,colors[(i+(side+1)/2)%4]);
  for (const dz of [-1.7,1.7]) box(x,.065,z+dz,.72,.13,.12,steel);
  box(x+side*.09,2.18,z,.025,.12,2.2,'#e3ded4');
  table(side*3,z,1.25,2.6);
  chair(side*2,z,side,'#606669','x');
}

// Refreshment counter and separate snack table below the far gallery.
for (const x of [-3,0,3]) table(x,-30,3);
box(0,2.1,-31.6,3.2,1.7,.08,'#f4f1ea'); // projection screen
for (const x of [-3.6,-2.8]) {
  box(x,1.12,-30,.48,.65,.45,steel); // beverage urn and tap
  box(x,.96,-29.73,.09,.09,.14,'#313438');
}
table(0,-24.7,2.6);
for (const x of [-.65,.65]) {
  box(x,.87,-24.7,1.08,.16,.68,'#473b34');
  for (const dx of [-.32,0,.32]) box(x+dx,1,-24.7,.25,.15,.44,'#d79c59');
}
for (const x of [-3,3]) {
  box(x,.4,-23.8,1.55,.48,1,'#414348');
  box(x,.8,-23.3,1.55,.72,.15,'#414348');
}

export default function GroundFloor({ workstationSelection }: { workstationSelection?: WorkstationSelection }) {
  const banner = useTexture('/lauzhack-banner.svg');
  banner.colorSpace = SRGBColorSpace;
  const mesh = useRef<InstancedMesh>(null!);
  useLayoutEffect(() => {
    const transform = new Object3D();
    parts.forEach(([x,y,z,w,h,d,color],i) => {
      transform.position.set(x,y,z); transform.scale.set(w,h,d); transform.updateMatrix();
      mesh.current.setMatrixAt(i,transform.matrix); mesh.current.setColorAt(i,new Color(color));
    });
    mesh.current.instanceMatrix.needsUpdate = true;
    mesh.current.instanceColor!.needsUpdate = true;
    mesh.current.computeBoundingSphere();
  }, []);
  return <>{glazing.map(({x,z,depth},i)=><mesh key={i} position={[x,1.8,z]}><boxGeometry args={[.06,3.6,depth]}/><meshStandardMaterial color="#a4c6ce" transparent opacity={.18} depthWrite={false}/></mesh>)}<mesh position={[0,10.65*4/3.5,-31.8]}><planeGeometry args={[2.8,11.2]}/><meshStandardMaterial map={banner} side={DoubleSide}/></mesh><instancedMesh ref={mesh} args={[undefined,undefined,parts.length]} castShadow receiveShadow><boxGeometry/><meshStandardMaterial roughness={.75}/></instancedMesh>
    {workstations.map(({ monitor, computer }, i) => (
      <group key={i}>
        <Monitor position={monitor} selection={workstationSelection?.monitors} />
        <Computer position={computer} selection={workstationSelection?.computers} />
      </group>
    ))}
  </>;
}
