import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import type { AvatarMotion } from "./avatar";

export type ProtagonistHeroId = "ziemek" | "gniewko";

export class StylizedCharacter {
  readonly id: ProtagonistHeroId;
  readonly object: THREE.Group;
  readonly head: THREE.Mesh;
  readonly hair: THREE.Group;
  readonly torso: THREE.Mesh;
  readonly backpack?: THREE.Group;
  readonly leftArmPivot: THREE.Group;
  readonly rightArmPivot: THREE.Group;
  readonly leftLegPivot: THREE.Group;
  readonly rightLegPivot: THREE.Group;

  private motion: AvatarMotion = "idle";
  private animTime = 0;

  constructor(options: {
    id: ProtagonistHeroId;
    object: THREE.Group;
    head: THREE.Mesh;
    hair: THREE.Group;
    torso: THREE.Mesh;
    backpack?: THREE.Group;
    leftArmPivot: THREE.Group;
    rightArmPivot: THREE.Group;
    leftLegPivot: THREE.Group;
    rightLegPivot: THREE.Group;
  }) {
    this.id = options.id;
    this.object = options.object;
    this.head = options.head;
    this.hair = options.hair;
    this.torso = options.torso;
    this.backpack = options.backpack;
    this.leftArmPivot = options.leftArmPivot;
    this.rightArmPivot = options.rightArmPivot;
    this.leftLegPivot = options.leftLegPivot;
    this.rightLegPivot = options.rightLegPivot;
  }

  setMotion(motion: AvatarMotion): void {
    this.motion = motion;
  }

  update(delta: number): void {
    this.animTime += delta;
    const t = this.animTime;

    if (this.motion === "idle") {
      // Gentle breathing & head tilt
      const breath = Math.sin(t * 2.5) * 0.03;
      this.torso.position.y = 0.85 + breath;
      this.head.rotation.y = Math.sin(t * 1.2) * 0.08;
      this.head.rotation.z = Math.sin(t * 0.8) * 0.04;
      this.leftArmPivot.rotation.x = Math.sin(t * 2.5) * 0.06;
      this.rightArmPivot.rotation.x = -Math.sin(t * 2.5) * 0.06;
      this.leftLegPivot.rotation.x = 0;
      this.rightLegPivot.rotation.x = 0;
      this.object.rotation.z = 0;
    } else {
      const speedMult = this.motion === "sprint" ? 14 : 9;
      const swingAmp = this.motion === "sprint" ? 0.9 : 0.6;
      const armSwing = Math.sin(t * speedMult) * swingAmp;
      const legSwing = Math.sin(t * speedMult) * swingAmp;

      // Body bobbing
      this.torso.position.y = 0.85 + Math.abs(Math.sin(t * speedMult)) * 0.08;
      this.object.rotation.x = this.motion === "sprint" ? 0.14 : 0.05; // Lean forward
      this.object.rotation.z = Math.sin(t * speedMult * 0.5) * 0.04;

      // Alternating arm swing
      this.leftArmPivot.rotation.x = armSwing;
      this.rightArmPivot.rotation.x = -armSwing;

      // Alternating leg swing
      this.leftLegPivot.rotation.x = -legSwing;
      this.rightLegPivot.rotation.x = legSwing;

      // Slight head counter-balance
      this.head.rotation.y = -Math.sin(t * speedMult * 0.5) * 0.06;
    }
  }

  dispose(): void {
    this.object.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
        else child.material.dispose();
      }
    });
    this.object.removeFromParent();
  }
}

export function createStylizedCharacter(id: ProtagonistHeroId): StylizedCharacter {
  const root = new THREE.Group();
  root.name = `character-${id}`;

  const isZiemek = id === "ziemek";

  // Skin tone
  const skinColor = isZiemek ? 0xfcd5b5 : 0xfee0c6;
  const skinMaterial = new THREE.MeshStandardMaterial({
    color: skinColor,
    roughness: 0.65,
    metalness: 0.05,
  });

  // Texture loader
  let faceTex: THREE.Texture | null = null;
  let clothingTex: THREE.Texture | null = null;
  if (typeof document !== "undefined") {
    const loader = new THREE.TextureLoader();
    faceTex = loader.load(`/assets/textures/characters/${id}_face.png`);
    faceTex.colorSpace = THREE.SRGBColorSpace;
    clothingTex = loader.load(
      isZiemek
        ? "/assets/textures/characters/ziemek_hoodie.png"
        : "/assets/textures/characters/gniewko_polo.png"
    );
    clothingTex.colorSpace = THREE.SRGBColorSpace;
  }

  // --- Head ---
  const headGeo = new RoundedBoxGeometry(0.56, 0.54, 0.52, 4, 0.12);
  const headMaterials: THREE.Material[] = [
    skinMaterial, // right
    skinMaterial, // left
    skinMaterial, // top
    skinMaterial, // bottom
    faceTex ? new THREE.MeshStandardMaterial({ map: faceTex, roughness: 0.6 }) : skinMaterial, // front
    skinMaterial, // back
  ];
  const head = new THREE.Mesh(headGeo, headMaterials);
  head.position.set(0, 0.64, 0);
  head.castShadow = true;

  // --- Hair ---
  const hairGroup = new THREE.Group();
  const hairColor = isZiemek ? 0x4a2e1b : 0x533522;
  const hairMat = new THREE.MeshStandardMaterial({ color: hairColor, roughness: 0.85 });

  if (isZiemek) {
    // Shaggy hair volume on top and sides with anime bangs
    const hairCap = new THREE.Mesh(new RoundedBoxGeometry(0.62, 0.28, 0.58, 4, 0.14), hairMat);
    hairCap.position.set(0, 0.18, -0.02);
    hairGroup.add(hairCap);

    // Front shaggy bangs
    const bang1 = new THREE.Mesh(new RoundedBoxGeometry(0.18, 0.16, 0.12, 3, 0.04), hairMat);
    bang1.rotation.z = 0.15;
    bang1.position.set(-0.16, 0.14, 0.26);
    hairGroup.add(bang1);

    const bang2 = new THREE.Mesh(new RoundedBoxGeometry(0.22, 0.18, 0.12, 3, 0.04), hairMat);
    bang2.rotation.z = -0.12;
    bang2.position.set(0.08, 0.15, 0.27);
    hairGroup.add(bang2);
  } else {
    // Gniewko: Neatly combed shorter hair with soft side taper
    const hairCap = new THREE.Mesh(new RoundedBoxGeometry(0.6, 0.22, 0.56, 4, 0.12), hairMat);
    hairCap.position.set(0, 0.2, -0.02);
    hairGroup.add(hairCap);

    const fringe = new THREE.Mesh(new RoundedBoxGeometry(0.35, 0.1, 0.08, 3, 0.03), hairMat);
    fringe.position.set(0, 0.16, 0.26);
    hairGroup.add(fringe);
  }
  head.add(hairGroup);

  // --- Torso ---
  const torsoGeo = new RoundedBoxGeometry(0.54, 0.68, 0.38, 4, 0.09);
  const bodyBaseColor = isZiemek ? 0x209889 : 0xf8fafc;
  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: bodyBaseColor,
    roughness: 0.7,
    metalness: 0.05,
  });
  const torsoMaterials: THREE.Material[] = [
    bodyMaterial, // right
    bodyMaterial, // left
    bodyMaterial, // top
    bodyMaterial, // bottom
    clothingTex ? new THREE.MeshStandardMaterial({ map: clothingTex, roughness: 0.7 }) : bodyMaterial, // front
    bodyMaterial, // back
  ];
  const torso = new THREE.Mesh(torsoGeo, torsoMaterials);
  torso.position.set(0, 0.85, 0);
  torso.castShadow = true;
  torso.add(head);

  // --- Backpack (for Ziemek) ---
  let backpackGroup: THREE.Group | undefined;
  if (isZiemek) {
    backpackGroup = new THREE.Group();
    const packGeo = new RoundedBoxGeometry(0.42, 0.5, 0.22, 4, 0.08);
    const packMat = new THREE.MeshStandardMaterial({ color: 0x2b3834, roughness: 0.85 });
    const pack = new THREE.Mesh(packGeo, packMat);
    pack.position.set(0, 0.04, -0.26);
    pack.castShadow = true;
    backpackGroup.add(pack);

    // Green straps and zip accents
    const strapGeo = new THREE.BoxGeometry(0.36, 0.05, 0.04);
    const greenMat = new THREE.MeshStandardMaterial({ color: 0x78e08f, roughness: 0.5 });
    const strap = new THREE.Mesh(strapGeo, greenMat);
    strap.position.set(0, 0.08, -0.37);
    backpackGroup.add(strap);

    torso.add(backpackGroup);
  }

  // --- Arms ---
  const armColor = isZiemek ? 0x209889 : 0xf8fafc;
  const armSleeveMat = new THREE.MeshStandardMaterial({ color: armColor, roughness: 0.7 });

  const buildArm = (side: "left" | "right"): { pivot: THREE.Group; arm: THREE.Group } => {
    const pivot = new THREE.Group();
    const xPos = side === "left" ? -0.36 : 0.36;
    pivot.position.set(xPos, 0.22, 0);

    const arm = new THREE.Group();
    // Sleeve
    const sleeveGeo = new RoundedBoxGeometry(0.18, isZiemek ? 0.38 : 0.22, 0.18, 3, 0.04);
    const sleeve = new THREE.Mesh(sleeveGeo, armSleeveMat);
    sleeve.position.set(0, isZiemek ? -0.19 : -0.11, 0);
    sleeve.castShadow = true;
    arm.add(sleeve);

    // Forearm & Hand (Skin)
    const handGeo = new RoundedBoxGeometry(0.15, isZiemek ? 0.22 : 0.38, 0.15, 3, 0.04);
    const hand = new THREE.Mesh(handGeo, skinMaterial);
    hand.position.set(0, isZiemek ? -0.42 : -0.34, 0);
    hand.castShadow = true;
    arm.add(hand);

    pivot.add(arm);
    return { pivot, arm };
  };

  const leftArm = buildArm("left");
  const rightArm = buildArm("right");
  torso.add(leftArm.pivot);
  torso.add(rightArm.pivot);

  // --- Legs & Sneakers ---
  const pantsColor = isZiemek ? 0x1f2429 : 0x1e293b;
  const pantsMat = new THREE.MeshStandardMaterial({ color: pantsColor, roughness: 0.85 });
  const sneakerBaseColor = isZiemek ? 0x209889 : 0x1e293b;
  const sneakerAccentColor = isZiemek ? 0xa8e063 : 0xffffff;
  const sneakerSoleColor = 0xffffff;

  const buildLeg = (side: "left" | "right"): { pivot: THREE.Group } => {
    const pivot = new THREE.Group();
    const xPos = side === "left" ? -0.15 : 0.15;
    pivot.position.set(xPos, -0.32, 0);

    // Pants leg
    const legGeo = new RoundedBoxGeometry(0.2, 0.54, 0.22, 3, 0.05);
    const leg = new THREE.Mesh(legGeo, pantsMat);
    leg.position.set(0, -0.27, 0);
    leg.castShadow = true;
    pivot.add(leg);

    // Cargo pocket on outside for Ziemek
    if (isZiemek) {
      const pocketGeo = new RoundedBoxGeometry(0.06, 0.16, 0.14, 2, 0.02);
      const pocket = new THREE.Mesh(pocketGeo, pantsMat);
      pocket.position.set(side === "left" ? -0.12 : 0.12, -0.24, 0);
      pivot.add(pocket);
    }

    // Sneaker
    const sneakerGroup = new THREE.Group();
    sneakerGroup.position.set(0, -0.54, 0.04);

    // Sneaker body
    const shoeGeo = new RoundedBoxGeometry(0.22, 0.14, 0.32, 3, 0.04);
    const shoeMat = new THREE.MeshStandardMaterial({ color: sneakerBaseColor, roughness: 0.6 });
    const shoe = new THREE.Mesh(shoeGeo, shoeMat);
    shoe.position.set(0, 0.07, 0);
    shoe.castShadow = true;
    sneakerGroup.add(shoe);

    // Sole
    const soleGeo = new RoundedBoxGeometry(0.24, 0.06, 0.34, 3, 0.02);
    const soleMat = new THREE.MeshStandardMaterial({ color: sneakerSoleColor, roughness: 0.7 });
    const sole = new THREE.Mesh(soleGeo, soleMat);
    sole.position.set(0, 0.03, 0);
    sneakerGroup.add(sole);

    // Lime/white stripe
    const stripeGeo = new THREE.BoxGeometry(0.23, 0.04, 0.12);
    const stripeMat = new THREE.MeshStandardMaterial({ color: sneakerAccentColor, roughness: 0.5 });
    const stripe = new THREE.Mesh(stripeGeo, stripeMat);
    stripe.position.set(0, 0.1, 0);
    sneakerGroup.add(stripe);

    pivot.add(sneakerGroup);
    return { pivot };
  };

  const leftLeg = buildLeg("left");
  const rightLeg = buildLeg("right");
  torso.add(leftLeg.pivot);
  torso.add(rightLeg.pivot);

  root.add(torso);

  // Overall scale: Ziemek is older/taller (0.70x), Gniewko younger/smaller (0.64x)
  const scale = isZiemek ? 0.7 : 0.64;
  root.scale.setScalar(scale);

  return new StylizedCharacter({
    id,
    object: root,
    head,
    hair: hairGroup,
    torso,
    backpack: backpackGroup,
    leftArmPivot: leftArm.pivot,
    rightArmPivot: rightArm.pivot,
    leftLegPivot: leftLeg.pivot,
    rightLegPivot: rightLeg.pivot,
  });
}
