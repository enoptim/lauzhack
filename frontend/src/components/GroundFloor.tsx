import { useLayoutEffect, useRef } from 'react';
import { Color, InstancedMesh, Object3D } from 'three';

type Part = [number, number, number, number, number, number, string];
const parts: Part[] = [];
const box = (...p: Part) => parts.push(p);
const steel = '#818c90';
function table(x: number, z: number, width: number) {
  box(x,.76,z,width,.06,1.25,'#efece4');
  for (const dx of [-1,1]) for (const dz of [-1,1])
    box(x+dx*(width/2-.12),.37,z+dz*.5,.055,.74,.055,steel);
}
function chair(x: number, z: number, facing: number, color: string) {
  box(x,.45,z,.48,.07,.48,color);
  box(x,.67,z-facing*.21,.44,.42,.06,color);
  for (const dx of [-.19,.19]) for (const dz of [-.18,.18])
    box(x+dx,.21,z+dz,.035,.42,.035,steel);
}
// Two banks of glass-fronted team rooms, each with a doorway onto the aisle.
for (const side of [-1,1]) for (const z of [-24,-8,8,24]) {
  const x = side*14;
  box(x,1.62,z-8,11.8,3.24,.15,'#494d4e');
  box(x,1.6,z-7.88,3.3,1.2,.06,'#eff1ed');
  if (z===24) box(x,1.62,32,11.8,3.24,.15,'#bbbdb7');
  for (const dx of [-2.6,2.6]) for (const dz of [-4,0,4]) {
    table(x+dx,z+dz,3.4);
    for (const seat of [-.85,.85]) for (const facing of [-1,1])
      chair(x+dx+seat,z+dz-facing*.95,facing,'#b83a30');
    box(x+dx,.81,z+dz,.46,.035,.3,'#aeb4b4');
    box(x+dx,.97,z+dz+.13,.46,.32,.03,'#333a42');
  }
}
// Back-to-back display boards, with outward-facing booth tables and grey chairs.
const colors = ['#343f78','#505655','#82546a','#345962'];
for (let i=0;i<8;i++) for (const side of [-1,1]) {
  const z = -26+i*6, x = side*.42;
  box(x,1.36,z,.1,2.52,3.5,steel);
  box(x+side*.065,1.38,z,.04,2.32,3.32,colors[(i+(side+1)/2)%4]);
  for (const dz of [-1.35,1.35]) box(x,.065,z+dz,.72,.13,.12,steel);
  box(x+side*.09,2.18,z,.025,.12,2.2,'#e3ded4');
  table(side*3,z,2.1);
  chair(side*3,z-.96,1,'#606669');
}

export default function GroundFloor() {
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
  return <instancedMesh ref={mesh} args={[undefined,undefined,parts.length]} castShadow receiveShadow><boxGeometry/><meshStandardMaterial roughness={.75}/></instancedMesh>;
}
