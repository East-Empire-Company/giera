import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { SMAAPass } from "three/addons/postprocessing/SMAAPass.js";

const GradeShader = {
  uniforms: { tDiffuse: { value: null as THREE.Texture | null } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    varying vec2 vUv;
    void main() {
      vec4 color = texture2D( tDiffuse, vUv );
      float vig = smoothstep( 0.92, 0.38, distance( vUv, vec2( 0.5 ) ) );
      color.rgb *= mix( 0.68, 1.0, vig );
      color.rgb *= vec3( 1.04, 1.0, 0.96 );
      gl_FragColor = color;
    }`,
};

const SplitShader = {
  uniforms: {
    tLeft: { value: null as THREE.Texture | null },
    tRight: { value: null as THREE.Texture | null },
  },
  vertexShader: GradeShader.vertexShader,
  fragmentShader: /* glsl */ `
    uniform sampler2D tLeft;
    uniform sampler2D tRight;
    varying vec2 vUv;
    void main() {
      vec2 uvL = vec2( vUv.x * 2.0, vUv.y );
      vec2 uvR = vec2( vUv.x * 2.0 - 1.0, vUv.y );
      gl_FragColor = vUv.x < 0.5 ? texture2D( tLeft, uvL ) : texture2D( tRight, uvR );
    }`,
};

type ComposerChain = { composer: EffectComposer; gtao: GTAOPass };

function buildChain(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  width: number,
  height: number
): ComposerChain {
  const composer = new EffectComposer(renderer);
  const gtao = new GTAOPass(scene, camera, width, height);
  const grade = new ShaderPass(GradeShader);
  const smaa = new SMAAPass();
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(gtao);
  composer.addPass(grade);
  composer.addPass(smaa);
  composer.addPass(new OutputPass());
  return { composer, gtao };
}

export type QualityState = { gtao: boolean };

export function evaluatePostQuality(state: QualityState, avgFps: number): QualityState {
  return { gtao: state.gtao && avgFps >= 50 };
}

export function postWindowAdvance(windowSeconds: number, deltaSeconds: number): { total: number; due: boolean } {
  const total = windowSeconds + deltaSeconds;
  return { total, due: total >= 5 };
}

export class PostFX {
  private readonly renderer: THREE.WebGLRenderer;
  private solo: ComposerChain;
  private split: [ComposerChain, ComposerChain] | null = null;
  private readonly composite: { scene: THREE.Scene; camera: THREE.OrthographicCamera; material: THREE.ShaderMaterial; quad: THREE.Mesh };
  private width: number;
  private height: number;
  private windowFrames = 0;
  private windowSeconds = 0;
  private gtaoEnabled = true;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, width: number, height: number) {
    this.renderer = renderer;
    this.width = width;
    this.height = height;
    this.solo = buildChain(renderer, scene, camera, width, height);
    this.composite = {
      scene: new THREE.Scene(),
      camera: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1),
      material: new THREE.ShaderMaterial(SplitShader),
      quad: new THREE.Mesh(new THREE.PlaneGeometry(2, 2)),
    };
    this.composite.quad.material = this.composite.material;
    this.composite.scene.add(this.composite.quad);
  }

  renderSolo(): void {
    this.solo.composer.render();
  }

  renderSplit(camera: THREE.PerspectiveCamera, camera2: THREE.PerspectiveCamera): void {
    if (!this.split) {
      const scene = (this.solo.composer.passes[0] as RenderPass).scene;
      const halfWidth = Math.max(1, Math.floor(this.width / 2));
      this.split = [
        buildChain(this.renderer, scene, camera, halfWidth, this.height),
        buildChain(this.renderer, scene, camera2, halfWidth, this.height),
      ];
      this.split.forEach((chain) => {
        chain.composer.renderToScreen = false;
        this.applyQuality(chain);
      });
    }
    const [left, right] = this.split;
    left.composer.render();
    right.composer.render();
    this.composite.material.uniforms.tLeft.value = left.composer.readBuffer?.texture ?? null;
    this.composite.material.uniforms.tRight.value = right.composer.readBuffer?.texture ?? null;
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.composite.scene, this.composite.camera);
  }

  setSize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.solo.composer.setSize(width, height);
    if (this.split) {
      const halfWidth = Math.max(1, Math.floor(width / 2));
      this.split[0].composer.setSize(halfWidth, height);
      this.split[1].composer.setSize(halfWidth, height);
    }
  }

  noteFrame(deltaSeconds: number): void {
    this.windowFrames++;
    const window = postWindowAdvance(this.windowSeconds, deltaSeconds);
    this.windowSeconds = window.total;
    if (!window.due) return;
    const avgFps = this.windowFrames / 5;
    this.windowFrames = 0;
    this.windowSeconds = 0;
    if (this.gtaoEnabled && avgFps < 50) console.info(`[postfx] GTAO disabled (avg fps ${avgFps.toFixed(1)})`);
    const after = evaluatePostQuality({ gtao: this.gtaoEnabled }, avgFps);
    this.gtaoEnabled = after.gtao;
    this.solo.gtao.enabled = this.gtaoEnabled;
    if (this.split) this.split.forEach((chain) => (chain.gtao.enabled = this.gtaoEnabled));
  }

  private applyQuality(chain: ComposerChain): void {
    chain.gtao.enabled = this.gtaoEnabled;
  }

  setPassEnabled(pass: "gtao", enabled: boolean): void {
    this.gtaoEnabled = enabled;
    this.solo.gtao.enabled = enabled;
    this.split?.forEach((chain) => (chain.gtao.enabled = enabled));
  }

  dispose(): void {
    this.solo.composer.dispose();
    this.split?.forEach((chain) => chain.composer.dispose());
    this.composite.material.dispose();
    this.composite.quad.geometry.dispose();
  }
}
