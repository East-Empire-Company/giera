import * as THREE from "three";
import { applySurfaceDetail, DENIM, FABRIC, LEATHER, SKIN } from "../render/fabric";

export type CharacterKind = "ziemek" | "gniewko" | "generic";

const HIDE_PARTS = /(helmet|visor|cape|quiver|hat)/i;

function creeperFaceTexture(base: string): THREE.CanvasTexture {
  const size = 16;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext("2d")!;
  g.fillStyle = base;
  g.fillRect(0, 0, size, size);
  g.fillStyle = "#0d3b34";
  const px = (x: number, y: number, w = 1, h = 1): void => g.fillRect(x, y, w, h);
  px(3, 4, 3, 3);
  px(10, 4, 3, 3);
  px(7, 7, 2, 3);
  px(5, 9, 6, 4);
  px(5, 12, 2, 2);
  px(9, 12, 2, 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function detailMaterial(source: THREE.Material, color: THREE.ColorRepresentation, detail: typeof FABRIC): THREE.MeshStandardMaterial {
  const base = source as THREE.MeshStandardMaterial;
  const mat = new THREE.MeshStandardMaterial({ map: base.map ?? null, color: new THREE.Color(color) });
  applySurfaceDetail(mat, detail);
  return mat;
}

function worldBox(object: THREE.Object3D): THREE.Box3 {
  object.updateWorldMatrix(true, true);
  return new THREE.Box3().setFromObject(object);
}

function findBone(root: THREE.Object3D, name: string): THREE.Bone | null {
  let found: THREE.Bone | null = null;
  root.traverse((o) => {
    if (o instanceof THREE.Bone && o.name.toLowerCase() === name) found = o;
  });
  return found;
}

function attachWorld(bone: THREE.Object3D, child: THREE.Object3D, worldPos: THREE.Vector3): void {
  bone.add(child);
  child.position.copy(bone.worldToLocal(worldPos.clone()));
}

function hair(kind: CharacterKind, headBox: THREE.Box3, headBone: THREE.Object3D, scene: THREE.Object3D, backSign: number): void {
  const size = headBox.getSize(new THREE.Vector3());
  const centre = headBox.getCenter(new THREE.Vector3());
  const color = kind === "ziemek" ? 0x3a2417 : 0x6b4a2b;
  const mat = new THREE.MeshStandardMaterial({ color });
  applySurfaceDetail(mat, LEATHER);
  const rng = (i: number): number => ((Math.sin(i * 12.9898 + (kind === "ziemek" ? 3 : 9)) * 43758.5453) % 1 + 1) % 1;
  const clumps = kind === "ziemek" ? 22 : 12;
  const geo = new THREE.IcosahedronGeometry(1, 1);
  for (let i = 0; i < clumps; i++) {
    const a = (i / clumps) * Math.PI * 2 + rng(i) * 0.4;
    const ring = i % 3 === 0 ? 0.2 : 0.5 + rng(i + 7) * 0.4;
    const mesh = new THREE.Mesh(geo, mat);
    const r = size.x * (kind === "ziemek" ? 0.55 : 0.5);
    const radial = (1 - ring * 0.4) * r;
    const top = headBox.max.y - size.y * (0.02 + ring * 0.22);
    const pos = new THREE.Vector3(centre.x + Math.cos(a) * radial * 0.8, top, centre.z + Math.sin(a) * radial * 0.8);
    const front = Math.sign(pos.z - centre.z) === -backSign;
    if (front && Math.abs(pos.z - centre.z) > r * 0.4 && ring > 0.4) pos.y += size.y * 0.1;
    const s = size.x * (kind === "ziemek" ? 0.2 + rng(i + 3) * 0.1 : 0.2 + rng(i + 3) * 0.04);
    mesh.scale.set(s, s * (kind === "ziemek" ? 1.15 : 0.85), s);
    mesh.castShadow = true;
    attachWorld(headBone, mesh, pos);
  }
  const cap = new THREE.Mesh(geo, mat);
  cap.scale.set(size.x * 0.52, size.y * 0.3, size.z * 0.52);
  attachWorld(headBone, cap, new THREE.Vector3(centre.x, headBox.max.y - size.y * 0.14, centre.z));
  scene.userData.hairMat = mat;
}

export function detailCharacter(
  scene: THREE.Object3D,
  kind: CharacterKind,
  clothing?: { torso: string; arms: string; legs: string }
): void {
  const parts: Record<string, THREE.Mesh> = {};
  scene.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const n = o.name.toLowerCase();
    if (kind !== "generic" && HIDE_PARTS.test(n)) {
      o.visible = false;
      return;
    }
    if (/head/.test(n)) parts.head = o;
    else if (/body/.test(n)) parts.body = o;
    else if (/legleft|legright|leg/.test(n)) parts[n] = o;
    else if (/arm/.test(n)) parts[n] = o;
    o.castShadow = true;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const out = mats.map((m) => {
      const base = m as THREE.MeshStandardMaterial;
      const color = base.color ?? new THREE.Color(0xffffff);
      if (/head/.test(n)) return detailMaterial(m, color, SKIN);
      if (/leg/.test(n)) return detailMaterial(m, color, DENIM);
      return detailMaterial(m, color, FABRIC);
    });
    o.material = Array.isArray(o.material) ? out : out[0];
  });
  if (kind === "generic") return;

  const capeBox = (() => {
    let box: THREE.Box3 | null = null;
    scene.traverse((o) => {
      if (o instanceof THREE.Mesh && /cape/i.test(o.name)) box = worldBox(o);
    });
    return box as THREE.Box3 | null;
  })();
  const bodyBox = parts.body ? worldBox(parts.body) : null;
  const headBox = parts.head ? worldBox(parts.head) : null;
  if (!bodyBox || !headBox) return;
  const bodyCentre = bodyBox.getCenter(new THREE.Vector3());
  const backSign = capeBox ? Math.sign(capeBox.getCenter(new THREE.Vector3()).z - bodyCentre.z) || 1 : 1;
  const bodySize = bodyBox.getSize(new THREE.Vector3());

  const headBone = findBone(scene, "head");
  const chestBone = findBone(scene, "chest");
  if (headBone) hair(kind, headBox, headBone, scene, backSign);

  if (chestBone && kind === "ziemek") {
    const teal = clothing?.torso ?? "#22998a";
    const face = new THREE.Mesh(
      new THREE.PlaneGeometry(bodySize.x * 0.5, bodySize.x * 0.5),
      new THREE.MeshStandardMaterial({ map: creeperFaceTexture(teal), roughness: 0.9 })
    );
    const frontZ = bodyBox.getCenter(new THREE.Vector3()).z - backSign * (bodySize.z * 0.5 + 0.004);
    attachWorld(chestBone, face, new THREE.Vector3(bodyCentre.x, bodyBox.min.y + bodySize.y * 0.62, frontZ));
    face.rotation.y = backSign > 0 ? Math.PI : 0;

    const pack = new THREE.Group();
    const packMat = new THREE.MeshStandardMaterial({ color: 0x24272e });
    applySurfaceDetail(packMat, LEATHER);
    const lime = new THREE.MeshStandardMaterial({ color: 0xa6e22e, roughness: 0.6 });
    const main = new THREE.Mesh(new THREE.BoxGeometry(bodySize.x * 0.78, bodySize.y * 0.7, bodySize.z * 0.55), packMat);
    const pocket = new THREE.Mesh(new THREE.BoxGeometry(bodySize.x * 0.5, bodySize.y * 0.28, bodySize.z * 0.2), lime);
    pocket.position.set(0, -bodySize.y * 0.12, backSign * bodySize.z * 0.34);
    pack.add(main, pocket);
    attachWorld(chestBone, pack, new THREE.Vector3(bodyCentre.x, bodyBox.min.y + bodySize.y * 0.55, bodyCentre.z + backSign * (bodySize.z * 0.5 + bodySize.z * 0.25)));
    pack.traverse((o) => { if (o instanceof THREE.Mesh) o.castShadow = true; });
  }

  if (kind === "gniewko" && headBone) {
    const collar = new THREE.Mesh(
      new THREE.TorusGeometry(bodySize.x * 0.28, bodySize.x * 0.05, 8, 20),
      new THREE.MeshStandardMaterial({ color: 0x1d2d48, roughness: 0.85 })
    );
    collar.rotation.x = Math.PI / 2;
    const neckY = headBox.min.y + (headBox.max.y - headBox.min.y) * 0.04;
    attachWorld(chestBone ?? headBone, collar, new THREE.Vector3(bodyCentre.x, neckY, bodyCentre.z));
  }

  const limeMat = new THREE.MeshStandardMaterial({ color: 0xa6e22e, roughness: 0.6 });
  if (kind === "ziemek") {
    for (const side of ["upperleg.l", "upperleg.r"]) {
      const bone = findBone(scene, side);
      if (!bone) continue;
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.012, bodySize.y * 0.5, bodySize.z * 0.2), limeMat);
      const worldPos = bone.getWorldPosition(new THREE.Vector3());
      worldPos.x += (side.endsWith("l") ? 1 : -1) * 0.002 + (side.endsWith("l") ? -1 : 1) * 0; // sits on the outer thigh
      attachWorld(bone, strip, worldPos.add(new THREE.Vector3(side.endsWith("l") ? bodySize.x * 0.28 : -bodySize.x * 0.28, -bodySize.y * 0.25, 0)));
    }
  }
}
