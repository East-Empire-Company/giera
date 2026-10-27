import {
  ACESFilmicToneMapping,
  Color,
  DirectionalLight,
  FogExp2,
  HemisphereLight,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  MeshBasicMaterial,
  NearestFilter,
  NoColorSpace,
  PCFShadowMap,
  PlaneGeometry,
  PMREMGenerator,
  RepeatWrapping,
  SRGBColorSpace,
  TextureLoader,
  Vector3,
  WebGLRenderer,
  type Texture,
  type Scene,
} from "three";
import type { GameplayVfxTextures } from "../effects/gameplay-vfx";
import { HDRLoader } from "three/addons/loaders/HDRLoader.js";
import { Sky } from "three/addons/objects/Sky.js";
import { daylightAt } from "./day-cycle";
import { withRetry } from "../../shared/retry";

export type RenderAssets = {
  atlas: Texture;
  atlasNormal: Texture;
  atlasOrm: Texture;
  waterNormal: Texture;
  clouds: Texture;
  sideClouds: Texture;
  environment: Texture | null;
  particles: GameplayVfxTextures;
};

function nearestTexture(texture: Texture, colorSpace: typeof SRGBColorSpace | typeof NoColorSpace): Texture {
  texture.colorSpace = colorSpace;
  texture.magFilter = NearestFilter;
  texture.minFilter = NearestFilter;
  texture.generateMipmaps = false;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

function linearTexture(texture: Texture, colorSpace: typeof SRGBColorSpace | typeof NoColorSpace, renderer: WebGLRenderer): Texture {
  texture.colorSpace = colorSpace;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.needsUpdate = true;
  return texture;
}

export async function loadRenderAssets(renderer: WebGLRenderer, onProgress?: (done: number, total: number) => void): Promise<RenderAssets> {
  const loader = new TextureLoader();
  const total = 12;
  let done = 0;
  const tracked = <T>(load: () => Promise<T>): Promise<T> =>
    withRetry(load).then((value) => {
      onProgress?.(++done, total);
      return value;
    });
  const tex = (url: string) => tracked(() => loader.loadAsync(url));
  const [atlas, atlasNormal, atlasOrm, waterNormal, clouds, sideClouds, hdr, dirt01, dirt02, spark01, smoke01, star01] = await Promise.all([
    tex("/assets/textures/atlas.png"),
    tex("/assets/textures/atlas-normal.png"),
    tex("/assets/textures/atlas-orm.png"),
    tex("/assets/textures/water-normal.jpg"),
    tex("/assets/sky/clouds.png"),
    tex("/assets/sky/skybox_sideClouds.png"),
    tracked(() => new HDRLoader().loadAsync("/assets/sky/kloofendal_48d_partly_cloudy_2k.hdr")).catch((error) => {
      console.warn("HDR environment unavailable; continuing without image-based lighting", error);
      onProgress?.(++done, total);
      return null;
    }),
    tex("/assets/particles/dirt_01.png"),
    tex("/assets/particles/dirt_02.png"),
    tex("/assets/particles/spark_01.png"),
    tex("/assets/particles/smoke_01.png"),
    tex("/assets/particles/star_01.png"),
  ]);
  const particles: GameplayVfxTextures = { dirt01, dirt02, spark01, smoke01, star01 };
  for (const texture of Object.values(particles)) texture.colorSpace = SRGBColorSpace;
  linearTexture(atlas, SRGBColorSpace, renderer);
  linearTexture(atlasNormal, NoColorSpace, renderer);
  linearTexture(atlasOrm, NoColorSpace, renderer);
  nearestTexture(waterNormal, NoColorSpace);
  waterNormal.wrapS = RepeatWrapping;
  waterNormal.wrapT = RepeatWrapping;
  for (const texture of [clouds, sideClouds]) {
    nearestTexture(texture, SRGBColorSpace);
    texture.wrapS = RepeatWrapping;
    texture.wrapT = RepeatWrapping;
  }
  let environment: Texture | null = null;
  if (hdr) {
    const pmrem = new PMREMGenerator(renderer);
    environment = pmrem.fromEquirectangular(hdr).texture;
    pmrem.dispose();
    hdr.dispose();
  }
  return { atlas, atlasNormal, atlasOrm, waterNormal, clouds, sideClouds, environment, particles };
}

export function createRenderer(canvas: HTMLCanvasElement): WebGLRenderer {
  const renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;
  return renderer;
}

export class SkyCycle {
  private readonly scene: Scene;
  private readonly sky: Sky;
  private readonly sun: DirectionalLight;
  private readonly hemisphere: HemisphereLight;
  private readonly fog: FogExp2;
  private readonly nightColor = new Color("#273956");
  private readonly dayColor = new Color("#84bfe4");
  private readonly currentColor = new Color();
  private readonly sunPosition = new Vector3();
  private readonly cloudLayers: Array<{ mesh: Mesh; material: MeshBasicMaterial }>;

  constructor(scene: Scene, assets: Pick<RenderAssets, "clouds" | "sideClouds">) {
    this.scene = scene;
    this.scene.background = this.nightColor;
    this.sky = new Sky();
    this.sky.scale.setScalar(450000);
    const uniforms = this.sky.material.uniforms;
    uniforms["turbidity"].value = 2.4;
    uniforms["rayleigh"].value = 1.8;
    uniforms["mieCoefficient"].value = 0.0025;
    uniforms["mieDirectionalG"].value = 0.76;
    scene.add(this.sky);

    this.sun = new DirectionalLight("#fff1d6", 1.8);
    this.sun.position.set(-100, 100, 0);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.left = -64;
    this.sun.shadow.camera.right = 64;
    this.sun.shadow.camera.top = 64;
    this.sun.shadow.camera.bottom = -64;
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 256;
    this.sun.shadow.camera.updateProjectionMatrix();
    scene.add(this.sun, this.sun.target);

    this.hemisphere = new HemisphereLight("#c5e2f4", "#82785f", 0.72);
    scene.add(this.hemisphere);
    this.fog = new FogExp2("#a9d0e8", 0.0038);
    scene.fog = this.fog;

    this.cloudLayers = [
      { texture: assets.clouds, y: 76, opacity: 0.42, scale: 420 },
      { texture: assets.sideClouds, y: 88, opacity: 0.22, scale: 520 },
    ].map(({ texture, y, opacity, scale }) => {
      const material = new MeshBasicMaterial({ map: texture, transparent: true, opacity, depthWrite: false });
      const mesh = new Mesh(new PlaneGeometry(scale, scale), material);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = y;
      mesh.renderOrder = 1;
      scene.add(mesh);
      return { mesh, material };
    });
    this.update(150, new Vector3());
  }

  update(timeSeconds: number, center: Vector3): void {
    const state = daylightAt(timeSeconds);
    this.sunPosition.set(state.sunPosition.x, state.sunPosition.y, state.sunPosition.z);
    this.currentColor.lerpColors(this.nightColor, this.dayColor, state.daylight);
    this.scene.background = this.currentColor;
    this.sky.visible = state.daylight > 0.05;
    this.sky.position.copy(center);
    this.sky.material.uniforms["sunPosition"].value.copy(this.sunPosition);
    this.sun.position.copy(center).addScaledVector(this.sunPosition, 100);
    this.sun.target.position.copy(center);
    this.sun.intensity = 2.2 * state.daylight;
    this.hemisphere.intensity = 0.15 + 0.35 * state.daylight;
    this.scene.environmentIntensity = 0.15 + 0.85 * state.daylight;
    this.fog.color.copy(this.currentColor);
    this.cloudLayers[0].mesh.position.x = center.x + Math.sin(timeSeconds * 0.006) * 14;
    this.cloudLayers[0].mesh.position.z = center.z + Math.cos(timeSeconds * 0.004) * 9;
    this.cloudLayers[0].mesh.visible = state.daylight > 0.08;
    this.cloudLayers[1].mesh.position.x = center.x - Math.cos(timeSeconds * 0.003) * 19;
    this.cloudLayers[1].mesh.position.z = center.z + Math.sin(timeSeconds * 0.005) * 11;
    this.cloudLayers[1].mesh.visible = state.daylight > 0.08;
  }

  dispose(): void {
    this.scene.remove(this.sky, this.sun, this.sun.target, this.hemisphere);
    this.sky.geometry.dispose();
    this.sky.material.dispose();
    for (const layer of this.cloudLayers) {
      this.scene.remove(layer.mesh);
      layer.mesh.geometry.dispose();
      layer.material.dispose();
    }
  }
}
