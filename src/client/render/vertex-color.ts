import * as THREE from "three";

export function ensureWhiteVertexColors(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  if (geometry.getAttribute("color")) return geometry;
  const count = geometry.getAttribute("position").count;
  geometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(count * 3).fill(1), 3));
  return geometry;
}
