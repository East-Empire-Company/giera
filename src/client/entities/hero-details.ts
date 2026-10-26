import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

export type NPCVisualId = "mina" | "staszek";

const NPC_HAIR: Record<NPCVisualId, number> = {
  mina: 0x7a3b20,
  staszek: 0x9aa0a6,
};

function findHead(root: THREE.Object3D): THREE.Mesh | undefined {
  let head: THREE.Mesh | undefined;
  root.traverse((child) => {
    if (!head && child instanceof THREE.Mesh && /head/i.test(child.name)) head = child;
  });
  return head;
}

export function applyNpcDetails(root: THREE.Object3D, npc: NPCVisualId): void {
  const head = findHead(root);
  if (!head) return;

  head.geometry.computeBoundingBox();
  const size = head.geometry.boundingBox!.getSize(new THREE.Vector3());
  const material = new THREE.MeshStandardMaterial({ color: NPC_HAIR[npc], roughness: 0.85 });
  const cap = new THREE.Mesh(new RoundedBoxGeometry(size.x * 1.02, size.y * 0.26, size.z, 4, size.x * 0.12), material);
  cap.position.set(0, size.y * 0.32, -size.z * 0.01);
  cap.castShadow = true;
  head.add(cap);

  const fringe = new THREE.Mesh(new RoundedBoxGeometry(size.x * 0.46, size.y * 0.12, size.z * 0.1, 3, size.x * 0.03), material);
  fringe.position.set(0, size.y * 0.2, -size.z * 0.42);
  head.add(fringe);
}
