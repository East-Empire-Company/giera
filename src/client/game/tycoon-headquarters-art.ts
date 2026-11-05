import * as THREE from "three";
import { HQ_DISPENSERS } from "../../shared/tycoon-base-plan";

export type HeadquartersArt = {
  root: THREE.Group;
  setOwned: (indices: readonly number[]) => void;
  update: (delta: number) => void;
  setElevatorHeight: (y: number) => void;
  dispose: () => void;
};

function starGeometry(): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  for (let point = 0; point < 10; point++) {
    const angle = Math.PI / 2 + point * Math.PI / 5;
    const radius = point % 2 === 0 ? 1 : 0.44;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    if (point === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  return new THREE.ExtrudeGeometry(shape, { depth: 0.12, bevelEnabled: false });
}

function lightningGeometry(): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(0.2, 1);
  shape.lineTo(-0.65, 0.05);
  shape.lineTo(-0.08, 0.05);
  shape.lineTo(-0.35, -1);
  shape.lineTo(0.7, 0.25);
  shape.lineTo(0.1, 0.25);
  shape.closePath();
  return new THREE.ExtrudeGeometry(shape, { depth: 0.1, bevelEnabled: false });
}

export function createHeadquartersArt(): HeadquartersArt {
  const root = new THREE.Group();
  root.name = "hq-headquarters-art";
  const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
  const cylinderGeometry = new THREE.CylinderGeometry(1, 1, 1, 12);
  const octaGeometry = new THREE.OctahedronGeometry(1, 0);
  const emblemGeometry = starGeometry();
  const boltGeometry = lightningGeometry();
  const navy = new THREE.MeshStandardMaterial({ color: 0x192746, roughness: 0.36, metalness: 0.55 });
  const ceramic = new THREE.MeshStandardMaterial({ color: 0xdde6eb, roughness: 0.28, metalness: 0.25 });
  const cyan = new THREE.MeshStandardMaterial({
    color: 0x35dce3,
    emissive: 0x35dce3,
    emissiveIntensity: 0.8,
    roughness: 0.25,
    metalness: 0.2,
  });
  const lime = new THREE.MeshStandardMaterial({
    color: 0x8eff4e,
    emissive: 0x8eff4e,
    emissiveIntensity: 0.65,
    roughness: 0.3,
    metalness: 0.1,
  });
  const materials = [navy, ceramic, cyan, lime];
  const geometries = [boxGeometry, cylinderGeometry, octaGeometry, emblemGeometry, boltGeometry];
  const stages: THREE.Group[] = [];
  const monitorBars: THREE.Mesh[] = [];
  const displays: THREE.Object3D[] = [];
  let elevatorPlatform: THREE.Object3D | undefined;
  let elevatorLight: THREE.Object3D | undefined;
  let antenna: THREE.Group | undefined;
  let constructionBeacon: THREE.Object3D | undefined;
  let time = 0;
  let disposed = false;

  const group = (parent: THREE.Group, name: string, x = 0, y = 0, z = 0): THREE.Group => {
    const result = new THREE.Group();
    result.name = name;
    result.position.set(x, y, z);
    parent.add(result);
    return result;
  };
  const box = (
    parent: THREE.Group,
    name: string,
    material: THREE.Material,
    x: number,
    y: number,
    z: number,
    sx: number,
    sy: number,
    sz: number,
  ): THREE.Mesh => {
    const mesh = new THREE.Mesh(boxGeometry, material);
    mesh.name = name;
    mesh.position.set(x, y, z);
    mesh.scale.set(sx, sy, sz);
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };
  const cylinder = (
    parent: THREE.Group,
    name: string,
    material: THREE.Material,
    x: number,
    y: number,
    z: number,
    radius: number,
    height: number,
  ): THREE.Mesh => {
    const mesh = new THREE.Mesh(cylinderGeometry, material);
    mesh.name = name;
    mesh.position.set(x, y, z);
    mesh.scale.set(radius, height, radius);
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };

  for (let index = 0; index < 6; index++) {
    const stage = group(root, `hq-stage-${index}`);
    stage.visible = false;
    stages.push(stage);
  }

  const lightPositions: [number, number][] = [
    [-6, 0], [-2, 0], [2, 0], [4, 0],
    [-6, 8], [-2, 8], [2, 8], [4, 8],
    [-7, 3], [-7, 6], [5, 3], [5, 6],
  ];
  for (const [index, [x, z]] of lightPositions.entries()) {
    cylinder(stages[0], `hq-perimeter-post-${index}`, navy, x, 1.28, z, 0.1, 0.55);
    cylinder(stages[0], `hq-perimeter-light-${index}`, index % 2 ? lime : cyan, x, 1.61, z, 0.16, 0.12);
  }
  constructionBeacon = cylinder(stages[0], "hq-construction-beacon", cyan, 4, 1.35, 6.5, 0.32, 0.7);

  const emblem = new THREE.Mesh(emblemGeometry, cyan);
  emblem.name = "hq-entrance-emblem";
  emblem.position.set(-0.5, 4.25, -0.6);
  emblem.castShadow = true;
  stages[1].add(emblem);
  box(stages[1], "hq-front-roof-trim", navy, -1, 3.86, -0.54, 13.8, 0.22, 0.18);
  box(stages[1], "hq-rear-roof-trim", navy, -1, 3.86, 8.54, 13.8, 0.22, 0.18);
  box(stages[1], "hq-left-roof-trim", navy, -7.54, 3.86, 4, 0.18, 0.22, 8.8);
  box(stages[1], "hq-right-roof-trim", navy, 5.54, 3.86, 4, 0.18, 0.22, 8.8);

  elevatorPlatform = box(stages[2], "hq-elevator-platform", ceramic, 1, 1.1, 2, 0.92, 0.16, 0.92);
  elevatorPlatform.castShadow = true;
  elevatorLight = box(stages[2], "hq-elevator-platform-light", cyan, 1, 1.2, 2, 0.72, 0.04, 0.72);
  for (const [index, x] of [0.42, 1.58].entries()) {
    box(stages[2], `hq-elevator-rail-${index}`, navy, x, 4.45, 2, 0.1, 6.9, 0.1);
  }
  cylinder(stages[2], "hq-elevator-ground-call", lime, 1, 1.04, 1, 0.34, 0.06);
  cylinder(stages[2], "hq-elevator-upper-call", lime, 1, 5.04, 3, 0.34, 0.06);
  box(stages[2], "hq-shaft-rail-left", ceramic, 0.25, 5.5, 2, 0.08, 0.75, 2.1);
  box(stages[2], "hq-shaft-rail-right", ceramic, 1.75, 5.5, 2, 0.08, 0.75, 2.1);
  box(stages[2], "hq-shaft-rail-rear", ceramic, 1, 5.5, 0.95, 1.55, 0.75, 0.08);

  const command = group(stages[3], "hq-command-room");
  for (const [index, x] of [-3, 0, 3].entries()) {
    box(command, `hq-console-desk-${index}`, navy, x, 5.65, 7.1, 2.2, 0.18, 0.85);
    box(command, `hq-console-left-leg-${index}`, ceramic, x - 0.85, 5.32, 7.1, 0.12, 0.65, 0.65);
    box(command, `hq-console-right-leg-${index}`, ceramic, x + 0.85, 5.32, 7.1, 0.12, 0.65, 0.65);
    box(command, `hq-console-monitor-${index}`, navy, x, 6.35, 7.35, 1.65, 1.05, 0.14);
    for (let bar = 0; bar < 3; bar++) {
      const mesh = box(command, `hq-monitor-bar-${index}-${bar}`, bar === 2 ? lime : cyan, x - 0.25 + bar * 0.25, 6.15 + bar * 0.2, 7.25, 0.85 - bar * 0.15, 0.08, 0.04);
      mesh.userData.baseScaleX = mesh.scale.x;
      monitorBars.push(mesh);
    }
  }
  for (const [index, z] of [3.1, 5.1].entries()) {
    box(command, `hq-gaming-desk-${index}`, ceramic, 3.9, 5.72, z, 1.65, 0.16, 1.15);
    box(command, `hq-gaming-screen-${index}`, navy, 4.35, 6.35, z, 0.14, 0.95, 0.95);
    box(command, `hq-gaming-glow-${index}`, cyan, 4.25, 6.35, z, 0.04, 0.68, 0.7);
    box(command, `hq-gaming-chair-${index}`, navy, 2.85, 5.48, z, 0.7, 0.75, 0.75);
    box(command, `hq-gaming-chair-back-${index}`, lime, 2.55, 5.95, z, 0.18, 1.05, 0.8);
  }
  box(command, "hq-lounge-sofa-seat", navy, -5.55, 5.38, 4.3, 1.4, 0.55, 2.7);
  box(command, "hq-lounge-sofa-back", cyan, -6.05, 5.9, 4.3, 0.35, 1.15, 2.7);
  box(command, "hq-lounge-sofa-arm-a", ceramic, -5.5, 5.7, 3.05, 1.35, 0.65, 0.25);
  box(command, "hq-lounge-sofa-arm-b", ceramic, -5.5, 5.7, 5.55, 1.35, 0.65, 0.25);
  box(command, "hq-lounge-table", ceramic, -3.85, 5.52, 4.3, 1.25, 0.18, 1.65);
  cylinder(command, "hq-lounge-table-base", navy, -3.85, 5.25, 4.3, 0.35, 0.5);
  for (let index = 0; index < 6; index++) {
    const side = index < 3 ? -1 : 1;
    const x = side < 0 ? -6.15 : 4.55;
    const z = 1.7 + (index % 3) * 1.05;
    box(command, `hq-trophy-pedestal-${index}`, navy, x, 5.35, z, 0.55, 0.7, 0.55);
    cylinder(command, `hq-trophy-cup-${index}`, index % 2 ? lime : cyan, x, 5.92, z, 0.2, 0.42);
    box(command, `hq-trophy-wing-${index}`, ceramic, x, 6.02, z, 0.65, 0.09, 0.12);
  }
  for (const [index, [x, z]] of [[-3, 3], [3, 3], [-3, 6], [3, 6]].entries()) {
    box(command, `hq-ceiling-fixture-${index}`, index % 2 ? lime : cyan, x, 7.78, z, 1.8, 0.08, 0.28);
  }
  for (const [index, x] of [-4, 3].entries()) {
    const bolt = new THREE.Mesh(boltGeometry, index ? lime : cyan);
    bolt.name = `hq-neon-lightning-${index}`;
    bolt.position.set(x, 6.45, 0.58);
    bolt.scale.setScalar(0.75);
    command.add(bolt);
  }

  const blockLab = group(stages[4], "hq-block-lab");
  for (const [index, dispenser] of HQ_DISPENSERS.filter((entry) => entry.stage === 4).entries()) {
    const { x, z } = dispenser;
    box(blockLab, `hq-block-housing-${index}`, navy, x, 1.65, z, 1.45, 1.3, 1.1);
    box(blockLab, `hq-block-counter-${index}`, ceramic, x, 1.25, z - 0.65, 1.55, 0.22, 0.45);
    box(blockLab, `hq-block-screen-${index}`, index % 2 ? lime : cyan, x, 1.75, z - 0.59, 0.85, 0.42, 0.06);
    const display = box(blockLab, `hq-block-display-${index}`, materials[index % materials.length], x, 2.65, z - 0.15, 0.55, 0.55, 0.55);
    displays.push(display);
  }

  const gadgetLab = group(stages[5], "hq-gadget-lab");
  for (const [index, dispenser] of HQ_DISPENSERS.filter((entry) => entry.stage === 5).entries()) {
    const { x, z } = dispenser;
    box(gadgetLab, `hq-armory-housing-${index}`, navy, x - 0.2, 1.75, z, 1.05, 1.5, 1.35);
    box(gadgetLab, `hq-armory-counter-${index}`, ceramic, x + 0.45, 1.25, z, 0.45, 0.22, 1.45);
    box(gadgetLab, `hq-armory-tool-handle-${index}`, ceramic, x + 0.37, 1.95, z, 0.1, 0.95, 0.12);
    const head = box(gadgetLab, `hq-armory-tool-head-${index}`, index === 2 ? lime : cyan, x + 0.42, 2.35, z, 0.12, 0.18, index === 2 ? 0.25 : 0.85);
    head.rotation.x = index === 1 ? 0.35 : 0;
  }
  antenna = group(stages[5], "hq-rooftop-antenna", 0, 9, 0);
  cylinder(antenna, "hq-antenna-base", navy, 0, 0.2, 0, 0.8, 0.4);
  cylinder(antenna, "hq-antenna-pole", ceramic, 0, 1.25, 0, 0.13, 2.1);
  box(antenna, "hq-antenna-crossbar", cyan, 0, 1.65, 0, 2.5, 0.12, 0.12);
  box(antenna, "hq-antenna-crossbar-b", cyan, 0, 1.65, 0, 0.12, 0.12, 2.5);
  const beacon = new THREE.Mesh(octaGeometry, lime);
  beacon.name = "hq-antenna-beacon";
  beacon.position.set(0, 2.45, 0);
  beacon.scale.setScalar(0.38);
  antenna.add(beacon);

  return {
    root,
    setOwned(indices) {
      const owned = new Set(indices);
      for (const [index, stage] of stages.entries()) stage.visible = owned.has(index);
    },
    update(delta) {
      time += delta;
      if (antenna) antenna.rotation.y = time * 0.65;
      if (constructionBeacon) constructionBeacon.rotation.y = time * 1.4;
      for (const [index, display] of displays.entries()) {
        display.rotation.y = time * (0.7 + index * 0.08);
        display.rotation.x = time * 0.25;
      }
      for (const [index, bar] of monitorBars.entries()) {
        const base = Number(bar.userData.baseScaleX);
        bar.scale.x = base * (0.82 + Math.sin(time * 3 + index * 0.7) * 0.18);
      }
    },
    setElevatorHeight(y) {
      if (elevatorPlatform) elevatorPlatform.position.y = y;
      if (elevatorLight) elevatorLight.position.y = y + 0.1;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      root.removeFromParent();
      root.clear();
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
    },
  };
}
