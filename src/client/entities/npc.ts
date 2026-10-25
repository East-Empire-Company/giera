import * as THREE from "three";
import { Avatar } from "./avatar";
import { applyHeroDetails } from "./hero-details";

export type NPCDef = {
  id: string;
  name: string;
  role: string;
  position: [number, number, number];
  accentColor: string;
  avatarId: "playerOne" | "playerTwo";
  scale?: number;
  quickPrompts: string[];
};

export const NPCS: NPCDef[] = [
  {
    id: "mina",
    name: "Mina",
    role: "Przewodniczka po świecie",
    position: [4, 50, 4],
    accentColor: "#f3a683",
    avatarId: "playerTwo",
    quickPrompts: ["Co mam zrobić?", "Daj mi blok", "Gdzie mam iść?", "Jak się nazywasz?"],
  },
  {
    id: "staszek",
    name: "Staszek",
    role: "Mistrz rzemiosła",
    position: [-4, 50, 4],
    accentColor: "#786fa6",
    avatarId: "playerOne",
    quickPrompts: ["Jak zrobić kilof?", "Daj mi deski", "Gdzie jest żelazo?", "Co potrafisz?"],
  },
  {
    id: "papuga",
    name: "Papuga",
    role: "Wesoły ptasi towarzysz",
    position: [0, 50, 6],
    accentColor: "#ffd32a",
    avatarId: "playerTwo",
    scale: 0.38,
    quickPrompts: ["Cześć papugo!", "Daj blok", "Powtórz coś!", "Lecimy?"],
  },
];
export function createParrotObject(): THREE.Group {
  const root = new THREE.Group();

  // Wooden perch post
  const postGeo = new THREE.CylinderGeometry(0.09, 0.09, 1.1, 10);
  const postMat = new THREE.MeshStandardMaterial({ color: 0x5c4033, roughness: 0.9 });
  const post = new THREE.Mesh(postGeo, postMat);
  post.position.set(0, 0.45, 0);
  root.add(post);

  // Crossbar perch
  const barGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.5, 8);
  const bar = new THREE.Mesh(barGeo, postMat);
  bar.rotation.z = Math.PI / 2;
  bar.position.set(0, 0.95, 0);
  root.add(bar);

  // Bird pivot
  const bird = new THREE.Group();
  bird.position.set(0, 1.0, 0);
  bird.name = "bird-pivot";

  // Body: teardrop/egg in vibrant sunny yellow
  const bodyGeo = new THREE.SphereGeometry(0.2, 12, 10);
  bodyGeo.scale(0.85, 1.25, 1.0);
  const yellowMat = new THREE.MeshStandardMaterial({ color: 0xffd32a, roughness: 0.6 });
  const body = new THREE.Mesh(bodyGeo, yellowMat);
  body.position.set(0, 0.22, 0);
  bird.add(body);

  // Wings in tropical turquoise/cyan
  const wingGeo = new THREE.ConeGeometry(0.12, 0.35, 6);
  wingGeo.scale(0.5, 1.0, 1.2);
  const cyanMat = new THREE.MeshStandardMaterial({ color: 0x0fbcf9, roughness: 0.5 });

  const leftWing = new THREE.Mesh(wingGeo, cyanMat);
  leftWing.rotation.set(0.4, 0, 0.3);
  leftWing.position.set(-0.16, 0.2, -0.02);
  bird.add(leftWing);

  const rightWing = new THREE.Mesh(wingGeo, cyanMat);
  rightWing.rotation.set(0.4, 0, -0.3);
  rightWing.position.set(0.16, 0.2, -0.02);
  bird.add(rightWing);

  // Tail feathers in emerald green
  const tailGeo = new THREE.BoxGeometry(0.1, 0.38, 0.03);
  const greenMat = new THREE.MeshStandardMaterial({ color: 0x2ecc71, roughness: 0.6 });
  const tail = new THREE.Mesh(tailGeo, greenMat);
  tail.rotation.x = -0.55;
  tail.position.set(0, 0.08, -0.16);
  bird.add(tail);

  // Head
  const headGeo = new THREE.SphereGeometry(0.14, 10, 10);
  const head = new THREE.Mesh(headGeo, yellowMat);
  head.position.set(0, 0.44, 0.06);
  bird.add(head);

  // Curved beak in bright orange
  const beakGeo = new THREE.ConeGeometry(0.06, 0.16, 6);
  const orangeMat = new THREE.MeshStandardMaterial({ color: 0xe67e22, roughness: 0.4 });
  const beak = new THREE.Mesh(beakGeo, orangeMat);
  beak.rotation.x = Math.PI / 2 + 0.2;
  beak.position.set(0, 0.42, 0.22);
  bird.add(beak);

  // Cartoon bead eyes
  const eyeWhiteGeo = new THREE.SphereGeometry(0.035, 8, 8);
  const whiteMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
  const pupilGeo = new THREE.SphereGeometry(0.02, 6, 6);
  const blackMat = new THREE.MeshBasicMaterial({ color: 0x111111 });

  const leftEye = new THREE.Mesh(eyeWhiteGeo, whiteMat);
  leftEye.position.set(-0.09, 0.46, 0.14);
  const leftPupil = new THREE.Mesh(pupilGeo, blackMat);
  leftPupil.position.set(-0.1, 0.46, 0.17);
  bird.add(leftEye);
  bird.add(leftPupil);

  const rightEye = new THREE.Mesh(eyeWhiteGeo, whiteMat);
  rightEye.position.set(0.09, 0.46, 0.14);
  const rightPupil = new THREE.Mesh(pupilGeo, blackMat);
  rightPupil.position.set(0.1, 0.46, 0.17);
  bird.add(rightEye);
  bird.add(rightPupil);

  root.add(bird);
  return root;
}

export class NPCInstance {
  readonly def: NPCDef;
  readonly position: THREE.Vector3;
  private animTime = 0;
  avatar?: Avatar;
  customObject?: THREE.Object3D;
  constructor(def: NPCDef) {
    this.def = def;
    this.position = new THREE.Vector3(...def.position);
  }

  get name(): string {
    return this.def.name;
  }

  async loadAvatar(): Promise<Avatar | THREE.Object3D> {
    if (this.def.id === "papuga") {
      const parrot = createParrotObject();
      parrot.position.copy(this.position);
      this.customObject = parrot;
      return parrot;
    }

    const scale = this.def.scale ?? 0.65;
    const avatar = await Avatar.load(this.def.avatarId, this.def.accentColor);
    avatar.object.scale.setScalar(scale);
    avatar.object.position.copy(this.position);
    applyHeroDetails(avatar.object, this.def.id === "mina" ? "mina" : "staszek");
    const toCenterX = -this.position.x;
    const toCenterZ = -this.position.z;
    avatar.object.rotation.y = Math.atan2(-toCenterX, -toCenterZ);
    this.avatar = avatar;
    return avatar;
  }

  update(delta: number): void {
    this.avatar?.update(delta);
    this.animTime += delta;
    if (this.customObject) {
      const bird = this.customObject.getObjectByName("bird-pivot");
      if (bird) {
        bird.rotation.y = Math.sin(this.animTime * 0.003) * 0.25;
        bird.position.y = 1.0 + Math.sin(this.animTime * 0.006) * 0.02;
      }
    }
  }
}

export class NPCManager {
  readonly npcs: NPCInstance[];

  constructor() {
    this.npcs = NPCS.map((def) => new NPCInstance(def));
  }

  getNearestNPC(x: number, y: number, z: number, maxDist = 3.0): NPCInstance | null {
    let nearest: NPCInstance | null = null;
    let minDistSq = maxDist * maxDist;

    for (const npc of this.npcs) {
      const dx = npc.position.x - x;
      const dy = npc.position.y - y;
      const dz = npc.position.z - z;
      const distSq = dx * dx + dy * dy + dz * dz;
      if (distSq <= minDistSq) {
        minDistSq = distSq;
        nearest = npc;
      }
    }
    return nearest;
  }

  spawnInScene(scene: THREE.Scene, terrainYAt: (x: number, z: number) => number): Promise<void> {
    return Promise.all(
      this.npcs.map(async (npc) => {
        const y = terrainYAt(npc.position.x, npc.position.z) + 1;
        npc.position.y = y;
        const entity = await npc.loadAvatar();
        if (entity instanceof THREE.Object3D) {
          scene.add(entity);
        } else {
          scene.add(entity.object);
        }
      })
    ).then(() => {});
  }
}
