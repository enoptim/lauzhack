import { useLayoutEffect, useRef } from 'react';
import { Color, Object3D, type EulerOrder, type InstancedMesh } from 'three';

type Vec3 = [number, number, number];
export type BuildingBoxPart = { position: Vec3; size: Vec3; rotation?: [number, number, number, EulerOrder?]; color?: string };

// Draw repeated building details together without changing their shapes or pick surfaces.
export default function BuildingBoxBatch({ parts, outline }: { parts: BuildingBoxPart[]; outline?: string }) {
  const mesh = useRef<InstancedMesh>(null!);
  useLayoutEffect(() => {
    const batch = mesh.current;
    const transform = new Object3D();
    const color = new Color();
    parts.forEach((part, index) => {
      transform.position.set(...part.position);
      transform.rotation.set(...(part.rotation ?? [0, 0, 0]));
      transform.scale.set(...part.size);
      transform.updateMatrix();
      batch.setMatrixAt(index, transform.matrix);
      if (part.color) batch.setColorAt(index, color.set(part.color));
    });
    batch.instanceMatrix.needsUpdate = true;
    if (batch.instanceColor) batch.instanceColor.needsUpdate = true;
    batch.computeBoundingSphere();
  }, [parts]);

  return <instancedMesh ref={mesh} args={[undefined, undefined, parts.length]} castShadow={!outline} receiveShadow={!outline}>
    <boxGeometry />
    {outline ? <meshBasicMaterial color={outline} toneMapped={false} /> : <meshStandardMaterial roughness={.75} />}
  </instancedMesh>;
}
