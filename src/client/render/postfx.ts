import * as THREE from "three";
import {
  BloomEffect,
  BlendFunction,
  Effect,
  EffectComposer,
  EffectPass,
  RenderPass,
  SMAAEffect,
  SMAAPreset,
  ToneMappingEffect,
  ToneMappingMode,
  type Pass,
} from "postprocessing";
// @ts-expect-error n8ao does not publish TypeScript declarations.
import { N8AOPostPass as UncheckedN8AOPostPass } from "n8ao";

type N8AOPass = Pass & {
  configuration: {
    aoRadius: number;
    distanceFalloff: number;
    halfRes: boolean;
    intensity: number;
  };
  setQualityMode(mode: "Performance"): void;
};

type N8AOPassConstructor = new (
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  width: number,
  height: number
) => N8AOPass;

const N8AOPostPass = UncheckedN8AOPostPass as unknown as N8AOPassConstructor;

export class AdaptiveBloomEffect extends BloomEffect {
  private active = true;

  setActive(active: boolean): void {
    this.active = active;
    this.blendMode.opacity.value = active ? 1 : 0;
  }

  override update(
    renderer: THREE.WebGLRenderer,
    inputBuffer: THREE.WebGLRenderTarget,
    deltaTime?: number
  ): void {
    if (this.active) super.update(renderer, inputBuffer, deltaTime);
  }
}

const gradeShader = /* glsl */ `
  void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    float vignette = 1.0 - smoothstep(0.38, 0.92, distance(uv, vec2(0.5)));
    vec3 tint = 1.05 * vec3(1.04, 1.0, 0.96);
    outputColor = vec4(inputColor.rgb * mix(0.68, 1.0, vignette) * tint, inputColor.a);
  }
`;

const SplitShader = {
  uniforms: {
    tLeft: { value: null as THREE.Texture | null },
    tRight: { value: null as THREE.Texture | null },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tLeft;
    uniform sampler2D tRight;
    varying vec2 vUv;
    void main() {
      vec2 uvLeft = vec2(vUv.x * 2.0, vUv.y);
      vec2 uvRight = vec2(vUv.x * 2.0 - 1.0, vUv.y);
      gl_FragColor = vUv.x < 0.5 ? texture2D(tLeft, uvLeft) : texture2D(tRight, uvRight);
      #include <colorspace_fragment>
    }
  `,
};

type ComposerChain = { composer: EffectComposer; ao: N8AOPass; bloom: AdaptiveBloomEffect };

function buildChain(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  width: number,
  height: number,
  autoRenderToScreen = true
): ComposerChain {
  const composer = new EffectComposer(renderer, {
    depthBuffer: true,
    stencilBuffer: true,
    frameBufferType: THREE.HalfFloatType,
  });
  composer.autoRenderToScreen = autoRenderToScreen;
  const renderPass = new RenderPass(scene, camera);
  renderPass.clearPass.setClearFlags(true, true, true);
  composer.addPass(renderPass);

  const ao = new N8AOPostPass(scene, camera, width, height);
  ao.setQualityMode("Performance");
  ao.configuration.aoRadius = 1.5;
  ao.configuration.distanceFalloff = 0.65;
  ao.configuration.halfRes = true;
  ao.configuration.intensity = 1.2;
  composer.addPass(ao);

  const grade = new Effect("Grade", gradeShader, { blendFunction: BlendFunction.NORMAL });
  const bloom = new AdaptiveBloomEffect({
    intensity: 0.14,
    levels: 4,
    luminanceSmoothing: 0.12,
    luminanceThreshold: 0.84,
    mipmapBlur: true,
    radius: 0.35,
  });
  composer.addPass(
    new EffectPass(
      camera,
      grade,
      new SMAAEffect({ preset: SMAAPreset.HIGH }),
      bloom,
      new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC })
    )
  );

  return { composer, ao, bloom };
}

function outputTexture(chain: ComposerChain): THREE.Texture {
  let input = chain.composer.inputBuffer;
  let output = chain.composer.outputBuffer;
  for (const pass of chain.composer.passes) {
    if (!pass.enabled || !pass.needsSwap) continue;
    const previous = input;
    input = output;
    output = previous;
  }
  return input.texture;
}

export type QualityState = { ao: boolean; bloom: boolean };

export type LadderState = { quality: QualityState; restoreCooldown: number; failedRestores: number };

const MAX_RESTORE_COOLDOWN_WINDOWS = 24;

function cooldownAfterFailures(failures: number): number {
  return Math.min(MAX_RESTORE_COOLDOWN_WINDOWS, 2 ** failures);
}

export function nextLadderState(state: LadderState, avgFps: number): LadderState {
  const effectsOn = state.quality.ao || state.quality.bloom;
  if (effectsOn && avgFps < 50) {
    const failedRestores = state.failedRestores + 1;
    return { quality: { ao: false, bloom: false }, restoreCooldown: cooldownAfterFailures(failedRestores), failedRestores };
  }
  if (!effectsOn) {
    if (state.restoreCooldown > 0) return { ...state, restoreCooldown: state.restoreCooldown - 1 };
    if (avgFps > 55) return { ...state, quality: { ao: true, bloom: true } };
  }
  return state;
}

export function postWindowAdvance(windowSeconds: number, deltaSeconds: number): { total: number; due: boolean } {
  const total = windowSeconds + deltaSeconds;
  return { total, due: total >= 5 };
}

export type PostFXOptions = { direct?: boolean };

export class PostFX {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly soloCamera: THREE.PerspectiveCamera;
  private readonly prepareView: (camera: THREE.PerspectiveCamera) => void;
  private readonly direct: boolean;
  private solo: ComposerChain | null;
  private split: [ComposerChain, ComposerChain] | null = null;
  private readonly composite: {
    scene: THREE.Scene;
    camera: THREE.OrthographicCamera;
    material: THREE.ShaderMaterial;
    quad: THREE.Mesh;
  } | null;
  private width: number;
  private height: number;
  private windowFrames = 0;
  private windowSeconds = 0;
  private ladder: LadderState = { quality: { ao: true, bloom: true }, restoreCooldown: 0, failedRestores: 0 };

  constructor(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    width: number,
    height: number,
    prepareView: (camera: THREE.PerspectiveCamera) => void,
    options: PostFXOptions = {}
  ) {
    this.renderer = renderer;
    this.scene = scene;
    this.soloCamera = camera;
    this.prepareView = prepareView;
    this.direct = options.direct ?? false;
    this.width = width;
    this.height = height;
    this.solo = this.direct ? null : buildChain(renderer, scene, camera, width, height);
    if (this.solo) this.resizeChain(this.solo, width, height);
    this.composite = this.direct
      ? null
      : {
          scene: new THREE.Scene(),
          camera: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1),
          material: new THREE.ShaderMaterial(SplitShader),
          quad: new THREE.Mesh(new THREE.PlaneGeometry(2, 2)),
        };
    if (this.composite) {
      this.composite.quad.material = this.composite.material;
      this.composite.scene.add(this.composite.quad);
    }
  }

  renderSolo(): void {
    if (this.direct) {
      this.renderDirect(this.soloCamera, 0, 0, this.width, this.height);
      return;
    }
    this.prepareView(this.soloCamera);
    this.solo?.composer.render();
  }

  renderSplit(camera: THREE.PerspectiveCamera, camera2: THREE.PerspectiveCamera): void {
    if (this.direct) {
      const halfWidth = Math.max(1, Math.floor(this.width / 2));
      this.renderDirect(camera, 0, 0, halfWidth, this.height);
      this.renderDirect(camera2, halfWidth, 0, this.width - halfWidth, this.height);
      return;
    }
    if (!this.split) {
      const halfWidth = Math.max(1, Math.floor(this.width / 2));
      this.split = [
        buildChain(this.renderer, this.scene, camera, halfWidth, this.height, false),
        buildChain(this.renderer, this.scene, camera2, halfWidth, this.height, false),
      ];
      this.split.forEach((chain) => {
        this.resizeChain(chain, halfWidth, this.height);
        this.applyQuality(chain);
      });
    }
    const [left, right] = this.split;
    const composite = this.composite;
    if (!composite) return;
    this.prepareView(camera);
    left.composer.render();
    this.prepareView(camera2);
    right.composer.render();
    composite.material.uniforms.tLeft.value = outputTexture(left);
    composite.material.uniforms.tRight.value = outputTexture(right);
    this.renderer.setRenderTarget(null);
    this.renderer.render(composite.scene, composite.camera);
  }

  setSize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    if (this.solo) this.resizeChain(this.solo, width, height);
    if (this.split) {
      const halfWidth = Math.max(1, Math.floor(width / 2));
      this.split.forEach((chain) => this.resizeChain(chain, halfWidth, height));
    }
  }

  noteFrame(deltaSeconds: number): void {
    this.windowFrames++;
    const window = postWindowAdvance(this.windowSeconds, deltaSeconds);
    this.windowSeconds = window.total;
    if (!window.due) return;
    const avgFps = this.windowFrames / window.total;
    this.windowFrames = 0;
    this.windowSeconds = 0;
    const after = nextLadderState(this.ladder, avgFps);
    const changed = after.quality.ao !== this.ladder.quality.ao || after.quality.bloom !== this.ladder.quality.bloom;
    this.ladder = after;
    if (!changed) return;
    const backoff = after.quality.ao ? "" : `, retry in ${after.restoreCooldown} windows`;
    console.info(`[postfx] AO and bloom ${after.quality.ao ? "restored" : "disabled"} (avg fps ${avgFps.toFixed(1)}${backoff})`);
    if (this.solo) this.applyQuality(this.solo);
    this.split?.forEach((chain) => this.applyQuality(chain));
  }

  private renderDirect(camera: THREE.PerspectiveCamera, x: number, y: number, width: number, height: number): void {
    this.renderer.setRenderTarget(null);
    this.renderer.setViewport(x, y, width, height);
    this.renderer.setScissor(x, y, width, height);
    this.renderer.setScissorTest(true);
    this.renderer.render(this.scene, camera);
  }

  private resizeChain(chain: ComposerChain, width: number, height: number): void {
    chain.composer.setSize(width, height, false);
    if (width !== this.width || height !== this.height) {
      this.renderer.setSize(this.width, this.height, false);
    }
  }

  private applyQuality(chain: ComposerChain): void {
    chain.ao.enabled = this.ladder.quality.ao;
    chain.bloom.setActive(this.ladder.quality.bloom);
  }

  dispose(): void {
    this.solo?.composer.dispose();
    this.split?.forEach((chain) => chain.composer.dispose());
    this.composite?.material.dispose();
    this.composite?.quad.geometry.dispose();
  }
}
