import { useLayoutEffect, useRef } from 'react';
import { Color, DoubleSide, InstancedMesh, Object3D, SRGBColorSpace } from 'three';
import { useTexture } from '@react-three/drei';

type Part = [number, number, number, number, number, number, string];
const parts: Part[] = [];
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

export default function GroundFloor() {
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
  return <><mesh position={[0,10.65,-31.8]}><planeGeometry args={[2.8,11.2]}/><meshStandardMaterial map={banner} side={DoubleSide}/></mesh><instancedMesh ref={mesh} args={[undefined,undefined,parts.length]} castShadow receiveShadow><boxGeometry/><meshStandardMaterial roughness={.75}/></instancedMesh></>;
}
