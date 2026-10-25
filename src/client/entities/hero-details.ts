import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

export type HeroId = "ziemek" | "gniewko" | "mina" | "staszek";

const ZIEMEK_HAIR = 0x4a2e1b;
const GNIEWKO_HAIR = 0x533522;
const PACK_BODY = 0x2b3834;
const PACK_STRAP = 0x1c2622;
const LIME_ACCENT = 0xb6e33f;
const NAVY_TRIM = 0x1d2d48;
const EMBLEM_INK = 0x14413c;
const MINA_HAIR = 0x7a3b20;
const STASZEK_HAIR = 0x9aa0a6;

const CREEPER_FACE = [
  "................",
  ".....CCCCCC......",
  "....CCCCCCCCCC...",
  "...CCCCCCCCCCCC..",
  "..CCC......CCC...",
  "..CC........CC...",
  "..C..........C...",
  ".CC..CCCC..CC.CC.",
  ".CC..CCCC..CC.CC.",
  ".CC..CCCC..CC.CC.",
  ".CCCCCCCCCCCCCCC.",
  "..CCC..CCCC..CCC.",
  "..CC....CC....CC.",
  "..C......CC....C.",
  "................",
  "................",
];

function createCreeperEmblemTexture(): THREE.DataTexture {
  const size = CREEPER_FACE.length;
  const data = new Uint8Array(size * size * 4);
  const ink = new THREE.Color(EMBLEM_INK);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      if (CREEPER_FACE[y][x] === "C") {
        data[i] = Math.round(ink.r * 255);
        data[i + 1] = Math.round(ink.g * 255);
        data[i + 2] = Math.round(ink.b * 255);
        data[i + 3] = 255;
      }
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function findMesh(root: THREE.Object3D, pattern: RegExp): THREE.Mesh | undefined {
  let found: THREE.Mesh | undefined;
  root.traverse((child) => {
    if (!found && child instanceof THREE.Mesh && pattern.test(child.name)) found = child;
  });
  return found;
}

function meshSize(mesh: THREE.Mesh): THREE.Vector3 {
  mesh.geometry.computeBoundingBox();
  const box = mesh.geometry.boundingBox!;
  return new THREE.Vector3(box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z);
}

function addShaggyHair(head: THREE.Mesh, size: THREE.Vector3, color: number): void {
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.02 });
  const cap = new THREE.Mesh(new RoundedBoxGeometry(size.x * 1.04, size.y * 0.42, size.z * 1.02, 4, size.x * 0.16), mat);
  cap.position.set(0, size.y * 0.36, -size.z * 0.02);
  cap.castShadow = true;
  head.add(cap);

  const bangSpecs: [number, number, number][] = [
    [-size.x * 0.24, 0.2, 0.12],
    [size.x * 0.06, 0.24, 0.14],
    [size.x * 0.3, 0.16, 0.1],
  ];
  for (const [bx, by, bz] of bangSpecs) {
    const bang = new THREE.Mesh(new RoundedBoxGeometry(size.x * 0.3, size.y * by, size.z * bz, 3, size.x * 0.06), mat);
    bang.position.set(bx, size.y * (0.26 - by * 0.2), -size.z * 0.44);
    bang.rotation.z = bx > 0 ? -0.18 : 0.14;
    bang.castShadow = true;
    head.add(bang);
  }
}

function addNeatHair(head: THREE.Mesh, size: THREE.Vector3, color: number): void {
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.8, metalness: 0.03 });
  const cap = new THREE.Mesh(new RoundedBoxGeometry(size.x * 1.01, size.y * 0.3, size.z * 0.99, 4, size.x * 0.14), mat);
  cap.position.set(0, size.y * 0.33, -size.z * 0.01);
  cap.castShadow = true;
  head.add(cap);

  const sideSweep = new THREE.Mesh(new RoundedBoxGeometry(size.x * 0.34, size.y * 0.16, size.z * 0.22, 3, size.x * 0.05), mat);
  sideSweep.position.set(size.x * 0.24, size.y * 0.22, -size.z * 0.36);
  sideSweep.rotation.z = -0.22;
  head.add(sideSweep);
}

function addShortHair(head: THREE.Mesh, size: THREE.Vector3, color: number): void {
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.02 });
  const cap = new THREE.Mesh(new RoundedBoxGeometry(size.x * 1.02, size.y * 0.26, size.z * 1.0, 4, size.x * 0.12), mat);
  cap.position.set(0, size.y * 0.32, -size.z * 0.01);
  cap.castShadow = true;
  head.add(cap);

  const fringe = new THREE.Mesh(new RoundedBoxGeometry(size.x * 0.46, size.y * 0.12, size.z * 0.1, 3, size.x * 0.03), mat);
  fringe.position.set(0, size.y * 0.2, -size.z * 0.42);
  head.add(fringe);
}

function addBackpack(torso: THREE.Mesh, size: THREE.Vector3): void {
  const body = new THREE.Mesh(
    new RoundedBoxGeometry(size.x * 0.66, size.y * 0.66, size.z * 0.36, 4, size.x * 0.1),
    new THREE.MeshStandardMaterial({ color: PACK_BODY, roughness: 0.85 })
  );
  body.position.set(0, size.y * 0.02, size.z * 0.62);
  body.castShadow = true;
  torso.add(body);

  const strapMat = new THREE.MeshStandardMaterial({ color: PACK_STRAP, roughness: 0.9 });
  for (const sx of [-size.x * 0.28, size.x * 0.28]) {
    const strap = new THREE.Mesh(new RoundedBoxGeometry(size.x * 0.14, size.y * 0.72, size.z * 0.08, 3, size.x * 0.03), strapMat);
    strap.position.set(sx, size.y * 0.06, -size.z * 0.4);
    torso.add(strap);
  }

  const zip = new THREE.Mesh(
    new THREE.BoxGeometry(size.x * 0.42, size.y * 0.06, size.z * 0.04),
    new THREE.MeshStandardMaterial({ color: LIME_ACCENT, roughness: 0.5, emissive: LIME_ACCENT, emissiveIntensity: 0.25 })
  );
  zip.position.set(0, size.y * 0.12, size.z * 0.81);
  torso.add(zip);
}

function addCreeperEmblem(torso: THREE.Mesh, size: THREE.Vector3): void {
  const emblem = new THREE.Mesh(
    new THREE.PlaneGeometry(size.x * 0.46, size.x * 0.46),
    new THREE.MeshBasicMaterial({ map: createCreeperEmblemTexture(), transparent: true, alphaTest: 0.5, side: THREE.DoubleSide })
  );
  emblem.position.set(0, size.y * 0.14, -size.z * 0.53);
  torso.add(emblem);
}

function addPoloTrim(torso: THREE.Mesh, size: THREE.Vector3): void {
  const trimMat = new THREE.MeshStandardMaterial({ color: NAVY_TRIM, roughness: 0.7 });
  const collar = new THREE.Mesh(
    new RoundedBoxGeometry(size.x * 0.66, size.y * 0.09, size.z * 0.52, 3, size.x * 0.04),
    trimMat
  );
  collar.position.set(0, size.y * 0.44, 0);
  torso.add(collar);

  const placket = new THREE.Mesh(new THREE.BoxGeometry(size.x * 0.1, size.y * 0.42, size.z * 0.05), trimMat);
  placket.position.set(0, size.y * 0.18, -size.z * 0.52);
  torso.add(placket);
}

function worldBottom(mesh: THREE.Mesh): number {
  mesh.updateWorldMatrix(true, false);
  return new THREE.Box3().setFromObject(mesh).min.y;
}

function applyChildProportions(root: THREE.Object3D, legScale: number, headScale: number): void {
  const head = findMesh(root, /head/i);
  if (head) head.scale.multiplyScalar(headScale);
  for (const leg of [findMesh(root, /leg-left/i), findMesh(root, /leg-right/i)]) {
    if (!leg) continue;
    const before = worldBottom(leg);
    leg.scale.y *= legScale;
    const rise = worldBottom(leg) - before;
    const parentScale = leg.parent ? leg.parent.getWorldScale(new THREE.Vector3()).y : 1;
    if (parentScale > 0) leg.position.y -= rise / parentScale;
  }
}

/**
 * Attaches the authored hero garments the shared rig cannot express: hair,
 * hoodie emblem, backpack, polo trim and child proportions.
 */
export function applyHeroDetails(root: THREE.Object3D, hero: HeroId): void {
  const head = findMesh(root, /head/i);
  const torso = findMesh(root, /torso/i);
  if (!head || !torso) return;

  if (hero === "ziemek") {
    addShaggyHair(head, meshSize(head), ZIEMEK_HAIR);
    addBackpack(torso, meshSize(torso));
    addCreeperEmblem(torso, meshSize(torso));
    applyChildProportions(root, 0.86, 1.12);
  } else if (hero === "gniewko") {
    addNeatHair(head, meshSize(head), GNIEWKO_HAIR);
    addPoloTrim(torso, meshSize(torso));
    applyChildProportions(root, 0.8, 1.15);
  } else {
    addShortHair(head, meshSize(head), hero === "mina" ? MINA_HAIR : STASZEK_HAIR);
  }
}
