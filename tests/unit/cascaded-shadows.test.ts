import * as THREE from "three";
import { afterEach, describe, expect, it } from "vitest";
import {
  CASCADE_COUNT,
  CASCADE_MAP_SIZE,
  CascadedShadows,
  MAX_SHADOW_CASTER_RANGE,
  MAX_SHADOW_DISTANCE,
  shadowDistanceFor,
} from "../../src/client/render/cascaded-shadows";
import { createMergedTileMaterial } from "../../src/client/render/worldRenderer";

const originalLightsFragmentBegin = THREE.ShaderChunk.lights_fragment_begin;
const originalLightsParsBegin = THREE.ShaderChunk.lights_pars_begin;
let shadows: CascadedShadows | null = null;
let scene: THREE.Scene;
let sun: THREE.DirectionalLight;

function createShadows(): void {
  scene = new THREE.Scene();
  sun = new THREE.DirectionalLight(0xffe0b8, 1.5);
  sun.position.set(-100, 100, 0);
  sun.target.position.set(0, 0, 0);
  scene.add(sun, sun.target);
  shadows = new CascadedShadows(scene, new THREE.PerspectiveCamera(68, 1, 0.1, 900), sun, 128);
}

afterEach(() => {
  shadows?.dispose();
  shadows = null;
});

describe("cascaded shadows", () => {
  it("moves cascade bounds with each split camera", () => {
    createShadows();
    const left = new THREE.PerspectiveCamera(68, 1.8, 0.1, 900);
    left.position.set(0, 20, 0);
    left.lookAt(0, 20, -1);
    shadows!.prepareView(left);
    const cascade = scene.children.find(
      (object): object is THREE.DirectionalLight => object instanceof THREE.DirectionalLight && object !== sun && object.castShadow
    );
    expect(cascade).toBeDefined();
    const leftPosition = cascade!.position.clone();

    const right = new THREE.PerspectiveCamera(68, 0.8, 0.1, 900);
    right.position.set(64, 20, 0);
    right.lookAt(64, 20, -1);
    shadows!.prepareView(right);

    expect(cascade!.position.distanceTo(leftPosition)).toBeGreaterThan(32);
  });

  it("keeps terrain atlas shader changes alongside CSM uniforms", () => {
    const textures = Array.from({ length: 4 }, () => new THREE.Texture());
    const material = createMergedTileMaterial(textures[0], textures[1], textures[2]) as THREE.MeshStandardMaterial;
    const originalHook = material.onBeforeCompile;
    const originalCacheKey = material.customProgramCacheKey();
    createShadows();
    shadows!.registerMaterial(material);
    const shader = {
      uniforms: THREE.UniformsUtils.clone(THREE.ShaderLib.standard.uniforms),
      vertexShader: THREE.ShaderLib.standard.vertexShader,
      fragmentShader: THREE.ShaderLib.standard.fragmentShader,
    } as Parameters<typeof material.onBeforeCompile>[0];

    material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);

    expect(shader.uniforms.gieraTileRects).toBeDefined();
    expect(shader.uniforms.CSM_cascades).toBeDefined();
    expect(material.customProgramCacheKey()).toBe(originalCacheKey);
    shadows!.dispose();
    shadows = null;
    expect(material.onBeforeCompile).toBe(originalHook);
    material.dispose();
    textures.forEach((texture) => texture.dispose());
  });

  it("keeps the stock PBR energy terms in the lighting chunk alongside CSM", () => {
    createShadows();
    const chunk = THREE.ShaderChunk.lights_fragment_begin;
    expect(chunk).toContain("material.dfg");
    expect(chunk).toContain("material.multiScatteringCompensation");
    expect(chunk).toContain("USE_CSM");
  });

  it("never writes iridescence fields that r186 materials no longer define", () => {
    createShadows();
    expect(THREE.ShaderChunk.lights_fragment_begin).not.toMatch(/material\.iridescenceF0\s*=/);
  });

  it("restores the original lighting chunks on dispose", () => {
    createShadows();
    shadows!.dispose();
    shadows = null;
    expect(THREE.ShaderChunk.lights_fragment_begin).toBe(originalLightsFragmentBegin);
    expect(THREE.ShaderChunk.lights_pars_begin).toBe(originalLightsParsBegin);
  });
});

describe("shadowDistanceFor", () => {
  it("caps shadow range at the visible-fog limit even when the world streams much further", () => {
    expect(shadowDistanceFor(900, 320)).toBe(MAX_SHADOW_DISTANCE);
  });

  it("never exceeds the streamed world on low-power consoles", () => {
    expect(shadowDistanceFor(900, 64)).toBe(64);
  });

  it("never exceeds the camera far plane", () => {
    expect(shadowDistanceFor(40, 320)).toBe(40);
  });

  it("keeps a usable minimum so cascades are never degenerate", () => {
    expect(shadowDistanceFor(900, 2)).toBeGreaterThanOrEqual(16);
  });
});

describe("cascade budget", () => {
  it("uses only as many cascades as are visibly distinct under fog", () => {
    expect(CASCADE_COUNT).toBeLessThanOrEqual(2);
    createShadows();
    const lights = scene.children.filter(
      (object): object is THREE.DirectionalLight => object instanceof THREE.DirectionalLight && object !== sun && object.castShadow
    );
    expect(lights).toHaveLength(CASCADE_COUNT);
  });

  it("keeps the near cascade at least as sharp as the old 3-cascade near texel size", () => {
    createShadows();
    shadows!.prepareView(new THREE.PerspectiveCamera(68, 1.6, 0.1, 900));
    const near = scene.children.find(
      (object): object is THREE.DirectionalLight => object instanceof THREE.DirectionalLight && object !== sun && object.castShadow
    )!;
    const widthBlocks = near.shadow.camera.right - near.shadow.camera.left;
    const blocksPerTexel = widthBlocks / near.shadow.mapSize.x;
    expect(near.shadow.mapSize.x).toBe(CASCADE_MAP_SIZE);
    expect(blocksPerTexel).toBeLessThanOrEqual(0.35);
  });

  it("never casts terrain shadows from further away than the cascades can display", () => {
    expect(MAX_SHADOW_CASTER_RANGE).toBeLessThanOrEqual(MAX_SHADOW_DISTANCE);
  });
});

describe("night-time shadow cost", () => {
  const cascadeLights = (): THREE.DirectionalLight[] =>
    scene.children.filter((object): object is THREE.DirectionalLight => object instanceof THREE.DirectionalLight && object !== sun && object.castShadow);
  const view = (): THREE.PerspectiveCamera => new THREE.PerspectiveCamera(68, 1.6, 0.1, 900);

  it("stops re-rendering cascade depth maps when the sun has set", () => {
    createShadows();
    sun.intensity = 0;
    shadows!.prepareView(view());
    for (const light of cascadeLights()) expect(light.shadow.autoUpdate).toBe(false);
  });

  it("resumes depth map updates when the sun rises again", () => {
    createShadows();
    sun.intensity = 0;
    shadows!.prepareView(view());
    sun.intensity = 1.2;
    shadows!.prepareView(view());
    for (const light of cascadeLights()) expect(light.shadow.autoUpdate).toBe(true);
  });

  it("keeps castShadow true so no shader recompile is triggered", () => {
    createShadows();
    sun.intensity = 0;
    shadows!.prepareView(view());
    for (const light of cascadeLights()) expect(light.castShadow).toBe(true);
  });
});
