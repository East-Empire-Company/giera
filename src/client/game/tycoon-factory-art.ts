import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

export type TycoonFactoryArt = {
  root: THREE.Group;
  update: (delta: number) => void;
  dispose: () => void;
};

type MainArtOptions = {
  groundAt: (x: number, z: number) => number;
  beltTop: number;
};

type MaterialKit = ReturnType<typeof createMaterials>;

function createMaterials() {
  return {
    body: new THREE.MeshPhysicalMaterial({ color: 0x263f5f, roughness: 0.42, metalness: 0.2, clearcoat: 0.65, clearcoatRoughness: 0.3 }),
    secondary: new THREE.MeshStandardMaterial({ color: 0x167d83, roughness: 0.5, metalness: 0.25 }),
    trim: new THREE.MeshStandardMaterial({ color: 0xf1b83b, roughness: 0.34, metalness: 0.62 }),
    metal: new THREE.MeshStandardMaterial({ color: 0x8da2b3, roughness: 0.3, metalness: 0.82 }),
    copper: new THREE.MeshStandardMaterial({ color: 0xb96f38, roughness: 0.38, metalness: 0.72 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x17232d, roughness: 0.76, metalness: 0.18 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x10181e, roughness: 0.94, metalness: 0 }),
    signal: new THREE.MeshStandardMaterial({ color: 0x10383e, emissive: 0x25d9ee, emissiveIntensity: 2.2, roughness: 0.3 }),
    reward: new THREE.MeshStandardMaterial({ color: 0xffd84d, emissive: 0xd88700, emissiveIntensity: 1.15, roughness: 0.3, metalness: 0.35 }),
    warning: new THREE.MeshStandardMaterial({ color: 0xff8f2d, emissive: 0xff5b12, emissiveIntensity: 1.35, roughness: 0.38 }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0x58dce9, emissive: 0x167f98, emissiveIntensity: 0.65, transparent: true, opacity: 0.3, roughness: 0.12, clearcoat: 1, depthWrite: false }),
  };
}

class ArtBuilder {
  readonly root = new THREE.Group();
  readonly materials = createMaterials();
  readonly animations: ((time: number) => void)[] = [];
  private readonly geometries = new Set<THREE.BufferGeometry>();
  private time = 0;

  mesh(name: string, geometry: THREE.BufferGeometry, material: THREE.Material, parent: THREE.Object3D = this.root): THREE.Mesh {
    this.geometries.add(geometry);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  box(
    name: string,
    size: readonly [number, number, number],
    position: readonly [number, number, number],
    material: THREE.Material,
    parent: THREE.Object3D = this.root,
    radius = 0.035
  ): THREE.Mesh {
    const mesh = this.mesh(name, new RoundedBoxGeometry(size[0], size[1], size[2], 2, Math.min(radius, ...size.map((v) => v / 4))), material, parent);
    mesh.position.set(...position);
    return mesh;
  }

  cylinder(
    name: string,
    radius: number,
    height: number,
    position: readonly [number, number, number],
    material: THREE.Material,
    parent: THREE.Object3D = this.root,
    segments = 20
  ): THREE.Mesh {
    const mesh = this.mesh(name, new THREE.CylinderGeometry(radius, radius, height, segments), material, parent);
    mesh.position.set(...position);
    return mesh;
  }

  tube(name: string, points: THREE.Vector3[], radius: number, material: THREE.Material, parent: THREE.Object3D = this.root): THREE.Mesh {
    return this.mesh(name, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 24, radius, 8, false), material, parent);
  }

  group(name: string, parent: THREE.Object3D = this.root): THREE.Group {
    const group = new THREE.Group();
    group.name = name;
    parent.add(group);
    return group;
  }

  update = (delta: number): void => {
    this.time += delta;
    for (const animate of this.animations) animate(this.time);
  };

  dispose = (): void => {
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of Object.values(this.materials)) material.dispose();
    this.geometries.clear();
    this.animations.length = 0;
    this.root.removeFromParent();
    this.root.clear();
  };
}

export function createMainFactoryArt(options: MainArtOptions): TycoonFactoryArt {
  const art = new ArtBuilder();
  const m = art.materials;
  art.root.name = "factory-authored-art";
  const beltY = options.groundAt(0, -4.6) + options.beltTop;

  const foundation = art.group("factory-foundation");
  art.box("factory-machine-footing", [2.35, 0.14, 2.05], [-3.2, options.groundAt(-3.2, -4.6) + 0.07, -4.6], m.dark, foundation, 0.06);
  for (const x of [-1.3, 0.7, 2.7, 4.2]) {
    art.box(`factory-belt-footing-${x}`, [1.86, 0.1, 1.5], [x, options.groundAt(x, -4.6) + 0.05, -4.6], m.body, foundation, 0.04);
  }
  for (const z of [-5.37, -3.83]) {
    art.box(`factory-foundation-trim-${z}`, [8.55, 0.09, 0.09], [0.55, options.groundAt(0, -4.6) + 0.11, z], m.trim, foundation, 0.02);
  }

  const hazardGeometry = new THREE.BoxGeometry(0.28, 0.025, 0.16);
  const hazard = new THREE.InstancedMesh(hazardGeometry, m.warning, 18);
  hazard.name = "factory-hazard-markers";
  const matrix = new THREE.Matrix4();
  for (let i = 0; i < 18; i++) {
    matrix.makeRotationY(-0.45);
    matrix.setPosition(-3.9 + i * 0.49, options.groundAt(0, -4.6) + 0.17, -3.82);
    hazard.setMatrixAt(i, matrix);
  }
  hazard.instanceMatrix.needsUpdate = true;
  foundation.add(hazard);
  art.mesh("factory-hazard-geometry", hazardGeometry, m.warning, new THREE.Group()).visible = false;

  const slatCount = 28;
  const slatGeometry = new RoundedBoxGeometry(0.13, 0.055, 1.06, 1, 0.018);
  const slats = new THREE.InstancedMesh(slatGeometry, m.rubber, slatCount);
  slats.name = "factory-conveyor-slats";
  slats.castShadow = true;
  slats.receiveShadow = true;
  art.root.add(slats);
  const updateSlats = (time: number): void => {
    for (let i = 0; i < slatCount; i++) {
      const x = -2.05 + ((i * (6.75 / slatCount) + time * 1.15) % 6.75);
      matrix.makeTranslation(x, beltY + 0.025, -4.6);
      slats.setMatrixAt(i, matrix);
    }
    slats.instanceMatrix.needsUpdate = true;
  };
  updateSlats(0);
  art.animations.push(updateSlats);

  const rollerGeometry = new THREE.CylinderGeometry(0.13, 0.13, 1.28, 14);
  const rollers = new THREE.InstancedMesh(rollerGeometry, m.metal, 10);
  rollers.name = "factory-conveyor-rollers";
  const rollerRotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0));
  for (let i = 0; i < 10; i++) {
    matrix.compose(new THREE.Vector3(-1.9 + i * 0.71, beltY - 0.15, -4.6), rollerRotation, new THREE.Vector3(1, 1, 1));
    rollers.setMatrixAt(i, matrix);
  }
  rollers.instanceMatrix.needsUpdate = true;
  art.root.add(rollers);
  art.mesh("factory-roller-geometry", rollerGeometry, m.metal, new THREE.Group()).visible = false;
  art.mesh("factory-slat-geometry", slatGeometry, m.rubber, new THREE.Group()).visible = false;

  for (const z of [-5.23, -3.97]) {
    art.box(`factory-conveyor-rail-${z}`, [6.8, 0.13, 0.1], [1.25, beltY + 0.09, z], m.metal);
    art.box(`factory-conveyor-light-${z}`, [6.65, 0.035, 0.035], [1.25, beltY + 0.17, z], m.signal, art.root, 0.01);
  }

  const frame = art.group("factory-machine-frame");
  const machineGround = options.groundAt(-3.2, -4.6);
  for (const x of [-4.25, -2.15]) {
    for (const z of [-5.35, -3.85]) {
      art.box(`factory-frame-post-${x}-${z}`, [0.16, 3.45, 0.16], [x, machineGround + 1.8, z], m.metal, frame, 0.025);
      art.box(`factory-frame-foot-${x}-${z}`, [0.36, 0.15, 0.36], [x, machineGround + 0.15, z], m.trim, frame, 0.035);
    }
  }
  for (const z of [-5.35, -3.85]) {
    art.box(`factory-frame-beam-${z}`, [2.28, 0.18, 0.18], [-3.2, machineGround + 3.52, z], m.body, frame, 0.035);
  }
  art.box("factory-frame-crossbeam", [0.18, 0.18, 1.68], [-3.2, machineGround + 3.52, -4.6], m.body, frame, 0.035);

  const core = art.cylinder("factory-power-core", 0.43, 0.13, [-3.2, machineGround + 1.62, -3.55], m.signal);
  core.rotation.x = Math.PI / 2;
  const coreRing = art.mesh("factory-power-core-ring", new THREE.TorusGeometry(0.55, 0.09, 10, 32), m.trim);
  coreRing.position.set(-3.2, machineGround + 1.62, -3.46);
  const coreHub = art.cylinder("factory-power-core-hub", 0.13, 0.24, [-3.2, machineGround + 1.62, -3.38], m.metal);
  coreHub.rotation.x = Math.PI / 2;
  const coreLight = new THREE.PointLight(0x35d8ee, 5, 4.5, 2);
  coreLight.position.set(-3.2, machineGround + 1.65, -3.1);
  art.root.add(coreLight);

  const piston = art.cylinder("factory-press-piston", 0.12, 0.72, [-2.35, machineGround + 2.45, -3.65], m.metal);
  art.box("factory-press-head", [0.72, 0.18, 0.62], [0, -0.44, 0], m.warning, piston, 0.04);
  art.animations.push((time) => {
    piston.position.y = machineGround + 2.38 + Math.sin(time * 3.4) * 0.22;
    coreRing.rotation.z = time * 0.8;
    m.signal.emissiveIntensity = 1.85 + Math.sin(time * 4) * 0.35;
  });

  const beacon = art.group("factory-machine-beacon");
  beacon.position.set(-3.2, machineGround + 4.72, -4.6);
  art.cylinder("factory-beacon-base", 0.24, 0.12, [0, 0, 0], m.dark, beacon);
  for (const direction of [-1, 1]) {
    art.box(`factory-beacon-vane-${direction}`, [0.42, 0.13, 0.1], [direction * 0.21, 0.18, 0], m.warning, beacon, 0.025);
  }
  art.animations.push((time) => {
    beacon.rotation.y = time * 2.2;
  });

  for (const x of [-4.65, -1.75]) {
    art.cylinder(`factory-pressure-tank-${x}`, 0.25, 1.25, [x, machineGround + 0.8, -5.1], m.secondary);
    art.cylinder(`factory-pressure-cap-${x}`, 0.29, 0.09, [x, machineGround + 1.45, -5.1], m.trim);
  }
  art.tube("factory-copper-feed", [
    new THREE.Vector3(-4.65, machineGround + 1.42, -5.1),
    new THREE.Vector3(-4.65, machineGround + 1.85, -5.1),
    new THREE.Vector3(-4.15, machineGround + 2.05, -5.25),
    new THREE.Vector3(-3.7, machineGround + 2.05, -5.25),
  ], 0.065, m.copper);
  art.tube("factory-copper-return", [
    new THREE.Vector3(-1.75, machineGround + 1.42, -5.1),
    new THREE.Vector3(-1.75, machineGround + 1.85, -5.1),
    new THREE.Vector3(-2.15, machineGround + 2.12, -5.25),
    new THREE.Vector3(-2.7, machineGround + 2.12, -5.25),
  ], 0.065, m.copper);

  const console = art.group("factory-control-console");
  console.position.set(2.25, options.groundAt(2.25, -3.35), -3.35);
  console.rotation.y = -0.18;
  art.box("factory-console-pedestal", [0.62, 0.75, 0.5], [0, 0.42, 0], m.body, console, 0.07);
  const panel = art.box("factory-console-panel", [0.92, 0.52, 0.16], [0, 0.92, 0.04], m.dark, console, 0.05);
  panel.rotation.x = -0.25;
  const screen = art.box("factory-console-screen", [0.53, 0.25, 0.025], [-0.11, 0.96, 0.14], m.signal, console, 0.018);
  screen.rotation.x = -0.25;
  for (let i = 0; i < 3; i++) {
    const button = art.cylinder(`factory-console-button-${i}`, 0.055, 0.035, [0.27, 0.86 + i * 0.11, 0.16], i === 2 ? m.warning : m.trim, console, 12);
    button.rotation.x = Math.PI / 2 - 0.25;
  }
  art.tube("factory-console-cable", [
    new THREE.Vector3(2.25, options.groundAt(2.25, -3.35) + 0.08, -3.35),
    new THREE.Vector3(1.2, options.groundAt(1.2, -3.5) + 0.06, -3.5),
    new THREE.Vector3(-1.4, options.groundAt(-1.4, -3.6) + 0.06, -3.6),
    new THREE.Vector3(-2.5, machineGround + 0.1, -3.75),
  ], 0.035, m.rubber);

  return { root: art.root, update: art.update, dispose: art.dispose };
}

export function createExpansionArt(index: number): TycoonFactoryArt {
  const art = new ArtBuilder();
  const m = art.materials;
  art.root.name = `expansion-art-${index}`;
  art.box(`expansion-base-${index}`, [1.9, 0.12, 1.75], [0, 0.06, 0], m.dark, art.root, 0.06);
  for (const z of [-0.86, 0.86]) {
    art.box(`expansion-base-trim-${index}-${z}`, [1.82, 0.08, 0.08], [0, 0.14, z], index % 2 === 0 ? m.trim : m.secondary, art.root, 0.02);
  }
  const feature = art.group(`expansion-feature-${index}`);
  const moving = art.group(`expansion-moving-${index}`);
  feature.add(moving);

  if (index === 0) {
    art.cylinder("expansion-sorter-table", 0.65, 0.18, [0, 0.67, 0], m.metal, feature);
    art.box("expansion-sorter-arm", [1.25, 0.12, 0.18], [0.48, 0.88, 0], m.warning, moving, 0.03);
    art.cylinder("expansion-sorter-pivot", 0.15, 0.32, [0, 0.82, 0], m.trim, moving);
    art.animations.push((time) => { moving.rotation.y = Math.sin(time * 2.4) * 0.85; });
  } else if (index === 1) {
    for (const x of [-0.62, 0.62]) art.box(`expansion-press-post-${x}`, [0.14, 1.65, 0.14], [x, 0.94, 0], m.metal, feature);
    art.box("expansion-press-crown", [1.45, 0.22, 0.55], [0, 1.78, 0], m.body, feature);
    art.cylinder("expansion-press-ram", 0.13, 0.7, [0, 0, 0], m.metal, moving);
    art.box("expansion-press-plate", [0.86, 0.16, 0.72], [0, -0.42, 0], m.warning, moving);
    art.animations.push((time) => { moving.position.y = 1.27 + Math.sin(time * 3.2) * 0.27; });
  } else if (index === 2) {
    for (const x of [-0.67, 0.67]) art.box(`expansion-scanner-post-${x}`, [0.16, 1.7, 0.2], [x, 0.97, 0], m.secondary, feature);
    art.box("expansion-scanner-crown", [1.52, 0.22, 0.42], [0, 1.83, 0], m.body, feature);
    const field = art.box("expansion-scanner-field", [1.18, 1.35, 0.025], [0, 0.98, 0], m.glass, feature, 0.005);
    field.castShadow = false;
    art.box("expansion-scanner-bar", [1.2, 0.07, 0.08], [0, 0, 0], m.signal, moving, 0.015);
    art.animations.push((time) => { moving.position.y = 0.95 + Math.sin(time * 2.8) * 0.58; });
  } else if (index === 3) {
    art.cylinder("expansion-reactor-vessel", 0.52, 1.45, [0, 0.91, 0], m.secondary, feature);
    for (const y of [0.38, 0.72, 1.06, 1.4]) {
      const coil = art.mesh(`expansion-reactor-coil-${y}`, new THREE.TorusGeometry(0.59, 0.055, 8, 28), m.copper, feature);
      coil.rotation.x = Math.PI / 2;
      coil.position.y = y;
    }
    for (let blade = 0; blade < 4; blade++) {
      const fin = art.box(`expansion-reactor-blade-${blade}`, [0.58, 0.08, 0.16], [0.3, 1.75, 0], m.signal, moving, 0.02);
      fin.rotation.y = blade * Math.PI / 2;
      fin.position.set(Math.cos(blade * Math.PI / 2) * 0.3, 1.75, Math.sin(blade * Math.PI / 2) * 0.3);
    }
    art.animations.push((time) => { moving.rotation.y = time * 2.6; });
  } else if (index === 4) {
    art.box("expansion-control-desk", [1.25, 0.72, 0.65], [0, 0.52, 0], m.body, feature, 0.08);
    art.box("expansion-control-screen", [0.82, 0.34, 0.04], [0, 0.72, 0.35], m.signal, feature, 0.025);
    art.cylinder("expansion-control-mast", 0.08, 1.25, [0, 1.45, 0], m.metal, feature);
    for (const direction of [-1, 1]) art.box(`expansion-control-vane-${direction}`, [0.5, 0.13, 0.12], [direction * 0.25, 0, 0], m.warning, moving, 0.025);
    moving.position.y = 2.05;
    art.animations.push((time) => { moving.rotation.y = time * 2.8; });
  } else {
    for (const x of [-0.66, 0.66]) {
      art.cylinder(`expansion-robot-base-${x}`, 0.26, 0.22, [x, 0.27, 0], m.trim, feature);
      art.box(`expansion-robot-shoulder-${x}`, [0.22, 0.85, 0.24], [x, 0.74, 0], m.body, feature, 0.05);
    }
    art.box("expansion-robot-arm", [1.35, 0.18, 0.22], [0, 0, 0], m.metal, moving, 0.045);
    art.box("expansion-robot-tool", [0.28, 0.52, 0.32], [0.58, -0.28, 0], m.signal, moving, 0.045);
    moving.position.y = 1.35;
    art.animations.push((time) => { moving.rotation.z = Math.sin(time * 2.1) * 0.32; });
  }

  art.cylinder(`expansion-status-post-${index}`, 0.055, 0.65, [-0.75, 0.5, 0.66], m.metal);
  art.cylinder(`expansion-status-light-${index}`, 0.11, 0.16, [-0.75, 0.88, 0.66], index % 2 === 0 ? m.reward : m.signal);
  return { root: art.root, update: art.update, dispose: art.dispose };
}
