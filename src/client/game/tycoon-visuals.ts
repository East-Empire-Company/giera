import * as THREE from "three";

export function createStarToken(): THREE.Group {
  const shape = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const angle = Math.PI / 2 + i * Math.PI / 5;
    const radius = i % 2 === 0 ? 0.62 : 0.28;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: 0.16,
    bevelEnabled: true,
    bevelSize: 0.045,
    bevelThickness: 0.045,
    bevelSegments: 1,
    steps: 1,
  });
  geometry.center();
  const material = new THREE.MeshPhysicalMaterial({
    color: 0xffd84d,
    emissive: 0xd88700,
    emissiveIntensity: 1.15,
    metalness: 0.35,
    roughness: 0.28,
    clearcoat: 0.65,
    clearcoatRoughness: 0.22,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const group = new THREE.Group();
  group.name = "tycoon-star-token";
  group.add(mesh);

  const halo = new THREE.Mesh(
    new THREE.TorusGeometry(0.82, 0.045, 10, 40),
    new THREE.MeshStandardMaterial({
      color: 0xffed9c,
      emissive: 0xffb813,
      emissiveIntensity: 1.35,
      metalness: 0.65,
      roughness: 0.25,
    })
  );
  halo.name = "tycoon-star-halo";
  halo.castShadow = true;
  group.add(halo);

  const core = new THREE.Mesh(
    new THREE.SphereGeometry(0.18, 16, 12),
    new THREE.MeshStandardMaterial({ color: 0xfff4bd, emissive: 0xffd84d, emissiveIntensity: 1.6, roughness: 0.2 })
  );
  core.name = "tycoon-star-core";
  group.add(core);
  return group;
}

export type TycoonLabelValue = {
  icon: "star" | "upgrade" | "lock";
  text: string;
  accent: string;
};

export class TycoonLabelView {
  readonly sprite?: THREE.Sprite;
  private readonly canvas?: HTMLCanvasElement;
  private value = "";

  constructor() {
    if (typeof document === "undefined") return;
    this.canvas = document.createElement("canvas");
    this.canvas.width = 512;
    this.canvas.height = 160;
    if (!this.canvas.getContext("2d")) return;
    const texture = new THREE.CanvasTexture(this.canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    this.sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, toneMapped: false })
    );
    this.sprite.scale.set(2.4, 0.75, 1);
    this.sprite.renderOrder = 4;
  }

  update(value: TycoonLabelValue): void {
    const key = `${value.icon}|${value.text}|${value.accent}`;
    if (!this.canvas || !this.sprite || key === this.value) return;
    this.value = key;
    const ctx = this.canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, 512, 160);
    ctx.fillStyle = "rgba(12,22,28,.88)";
    ctx.beginPath();
    ctx.roundRect(8, 8, 496, 144, 30);
    ctx.fill();
    ctx.lineWidth = 8;
    ctx.strokeStyle = value.accent;
    ctx.stroke();

    ctx.strokeStyle = "#ffd84d";
    ctx.fillStyle = "#ffd84d";
    ctx.lineWidth = 12;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    if (value.icon === "lock") {
      ctx.strokeRect(45, 70, 60, 50);
      ctx.arc(75, 70, 24, Math.PI, 0);
    } else if (value.icon === "upgrade") {
      ctx.moveTo(75, 120);
      ctx.lineTo(75, 35);
      ctx.moveTo(40, 70);
      ctx.lineTo(75, 35);
      ctx.lineTo(110, 70);
    } else {
      for (let i = 0; i < 10; i++) {
        const angle = -Math.PI / 2 + i * Math.PI / 5;
        const radius = i % 2 === 0 ? 48 : 22;
        const x = 75 + Math.cos(angle) * radius;
        const y = 80 + Math.sin(angle) * radius;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
    }
    ctx.stroke();

    ctx.fillStyle = "white";
    ctx.font = "bold 64px system-ui";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(value.text, 140, 82);
    const material = this.sprite.material as THREE.SpriteMaterial;
    if (material.map) material.map.needsUpdate = true;
  }

  dispose(): void {
    if (!this.sprite) return;
    const material = this.sprite.material as THREE.SpriteMaterial;
    material.map?.dispose();
    material.dispose();
    this.sprite.removeFromParent();
  }
}
