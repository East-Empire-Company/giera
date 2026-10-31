import {
  DirectionalLight,
  Material,
  Mesh,
  MeshLambertMaterial,
  MeshPhongMaterial,
  MeshStandardMaterial,
  MeshToonMaterial,
  Object3D,
  PerspectiveCamera,
  Scene,
  ShaderChunk,
  Vector3,
} from "three";
import { CSM } from "three/addons/csm/CSM.js";

const DIRECT_LIGHT_MARKER = "IncidentLight directLight;";
const MIN_SHADOW_DISTANCE = 16;

export const CASCADE_COUNT = 2;
export const CASCADE_MAP_SIZE = 1024;
export const MAX_SHADOW_DISTANCE = 128;
export const MAX_SHADOW_CASTER_RANGE = 80;
const SUN_VISIBLE_EPSILON = 0.001;

export function shadowDistanceFor(cameraFar: number, streamedDistance: number): number {
  return Math.max(MIN_SHADOW_DISTANCE, Math.min(cameraFar, streamedDistance, MAX_SHADOW_DISTANCE));
}

function spliceStockPrelude(stockChunk: string, csmChunk: string): string {
  const stockSplit = stockChunk.indexOf(DIRECT_LIGHT_MARKER);
  const csmSplit = csmChunk.indexOf(DIRECT_LIGHT_MARKER);
  if (stockSplit < 0 || csmSplit < 0 || !stockChunk.includes("material.dfg")) {
    throw new Error("Three.js lights_fragment_begin chunk changed; CSM prelude splice marker missing");
  }
  return stockChunk.slice(0, stockSplit) + csmChunk.slice(csmSplit);
}

type MaterialHooks = {
  onBeforeCompile: Material["onBeforeCompile"];
  customProgramCacheKey: Material["customProgramCacheKey"];
};

function supportsCascadedShadows(material: Material): boolean {
  return (
    material instanceof MeshStandardMaterial ||
    material instanceof MeshPhongMaterial ||
    material instanceof MeshLambertMaterial ||
    material instanceof MeshToonMaterial
  );
}

export class CascadedShadows {
  private readonly csm: CSM;
  private readonly sun: DirectionalLight;
  private readonly originalSunVisible: boolean;
  private readonly originalSunCastShadow: boolean;
  private readonly originalLightsFragmentBegin: string;
  private readonly originalLightsParsBegin: string;
  private readonly materialHooks = new Map<Material, MaterialHooks>();
  private projectionKey = "";

  constructor(scene: Scene, camera: PerspectiveCamera, sun: DirectionalLight, maxFar: number) {
    this.sun = sun;
    this.originalSunVisible = sun.visible;
    this.originalSunCastShadow = sun.castShadow;
    this.originalLightsFragmentBegin = ShaderChunk.lights_fragment_begin;
    this.originalLightsParsBegin = ShaderChunk.lights_pars_begin;
    const lightDirection = new Vector3().subVectors(sun.target.position, sun.position).normalize();
    this.csm = new CSM({
      camera,
      parent: scene,
      cascades: CASCADE_COUNT,
      mode: "practical",
      maxFar,
      shadowMapSize: CASCADE_MAP_SIZE,
      lightNear: 1,
      lightFar: 512,
      lightDirection,
      lightIntensity: sun.intensity,
    });
    ShaderChunk.lights_fragment_begin = spliceStockPrelude(this.originalLightsFragmentBegin, ShaderChunk.lights_fragment_begin);
    for (const light of this.csm.lights) {
      light.shadow.bias = sun.shadow.bias;
      light.shadow.normalBias = sun.shadow.normalBias;
      light.shadow.radius = sun.shadow.radius;
    }
    sun.castShadow = false;
    sun.visible = false;
  }

  registerMaterial(material: Material): void {
    if (this.materialHooks.has(material) || !supportsCascadedShadows(material)) return;
    const hooks = {
      onBeforeCompile: material.onBeforeCompile,
      customProgramCacheKey: material.customProgramCacheKey,
    };
    this.csm.setupMaterial(material);
    const csmHook = material.onBeforeCompile;
    material.onBeforeCompile = function (shader, renderer) {
      hooks.onBeforeCompile.call(this, shader, renderer);
      csmHook.call(this, shader, renderer);
    };
    material.needsUpdate = true;
    this.materialHooks.set(material, hooks);
  }

  registerObject(root: Object3D): void {
    root.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) this.registerMaterial(material);
    });
  }

  prepareView(camera: PerspectiveCamera): void {
    this.csm.camera = camera;
    const projectionKey = `${camera.fov}:${camera.aspect}:${camera.near}:${camera.far}`;
    if (projectionKey !== this.projectionKey) {
      this.csm.updateFrustums();
      this.projectionKey = projectionKey;
    }
    camera.updateMatrixWorld(true);
    this.csm.lightDirection.subVectors(this.sun.target.position, this.sun.position).normalize();
    const sunUp = this.sun.intensity > SUN_VISIBLE_EPSILON;
    for (const light of this.csm.lights) {
      light.color.copy(this.sun.color);
      light.intensity = this.sun.intensity;
      light.shadow.autoUpdate = sunUp;
    }
    this.csm.update();
  }

  dispose(): void {
    this.csm.remove();
    this.csm.dispose();
    for (const light of this.csm.lights) light.shadow.dispose();
    for (const [material, hooks] of this.materialHooks) {
      material.onBeforeCompile = hooks.onBeforeCompile;
      material.customProgramCacheKey = hooks.customProgramCacheKey;
      material.needsUpdate = true;
    }
    this.materialHooks.clear();
    ShaderChunk.lights_fragment_begin = this.originalLightsFragmentBegin;
    ShaderChunk.lights_pars_begin = this.originalLightsParsBegin;
    this.sun.visible = this.originalSunVisible;
    this.sun.castShadow = this.originalSunCastShadow;
  }
}
