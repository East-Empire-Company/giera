import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import assetManifest from "../../shared/asset-manifest.json";
import { withRetry } from "../../shared/retry";

export type ConciergeAvatarState = "idle" | "listening" | "thinking" | "speaking";

export type ConciergeAudioSample = {
  volume: number;
  spectrum?: Uint8Array | null;
};

export type ConciergeAudioSource = () => ConciergeAudioSample | null;

export type VoiceBands = {
  low: number;
  mid: number;
  high: number;
  level: number;
};

export type ConciergePoseTarget = {
  ledColor: number;
  ledIntensity: number;
  headPitch: number;
  headYaw: number;
  headRoll: number;
  eyePitch: number;
  eyeYaw: number;
  breath: number;
  morphs: Record<string, number>;
};

const LED_COLORS: Record<ConciergeAvatarState, number> = {
  idle: 0x38d9ff,
  listening: 0x4df0ff,
  thinking: 0xffb02e,
  speaking: 0x66f5ff,
};

const MORPH_GROUPS: Record<string, string[]> = {
  aa: ["h_expressions.AE_AA_h", "h_teeth.t_AE_AA_h"],
  ao: ["h_expressions.AO_a_h", "h_teeth.t_AO_a_h"],
  ee: ["h_expressions.Ax_E_h", "h_teeth.t_Ax_E_h"],
  ih: ["h_expressions.TD_I_h", "h_teeth.t_TD_I_h"],
  oo: ["h_expressions.UH_OO_h", "h_teeth.t_UH_OO_h"],
  uu: ["h_expressions.UW_U_h", "h_teeth.t_UW_U_h"],
  fv: ["h_expressions.FV_h", "h_teeth.t_FV_h"],
  ss: ["h_expressions.S_h", "h_teeth.t_S_h"],
  sh: ["h_expressions.SH_CH_h", "h_teeth.t_SH_CH_h"],
  mpb: ["h_expressions.MPB_Up_h", "h_expressions.MPB_Down_h", "h_teeth.t_MPB_h"],
  open: ["h_expressions.MouthOpen_h", "h_teeth.t_MouthOpen_h"],
  blink: ["h_expressions.LeyeClose_h", "h_expressions.ReyeClose_h"],
  smile: ["h_expressions.LsmileClose_h", "h_expressions.RsmileClose_h"],
  smileOpen: ["h_expressions.LsmileOpen_h", "h_expressions.RsmileOpen_h"],
  squint: ["h_expressions.Lsquint_h", "h_expressions.Rsquint_h"],
  lowLid: ["h_expressions.LlowLid_h", "h_expressions.RlowLid_h"],
  browUp: ["h_expressions.LbrowUp_h", "h_expressions.RbrowUp_h"],
  browOuterLeft: ["h_expressions.LLbrowUp_h"],
};

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

function bandAverage(data: Uint8Array, start: number, end: number): number {
  if (end <= start) return 0;
  let sum = 0;
  for (let i = start; i < end; i++) sum += data[i];
  return clamp01(sum / ((end - start) * 190));
}

export function extractVoiceBands(spectrum: Uint8Array | null | undefined, volume: number): VoiceBands {
  const safeVol = Number.isFinite(volume) ? clamp01(volume) : 0;
  if (!spectrum || spectrum.length === 0) {
    return { low: safeVol * 0.75, mid: safeVol * 0.55, high: safeVol * 0.25, level: safeVol };
  }
  const n = spectrum.length;
  const b1 = Math.max(1, Math.floor(n * 0.16));
  const b2 = Math.max(b1 + 1, Math.floor(n * 0.46));
  const low = bandAverage(spectrum, 0, b1);
  const mid = bandAverage(spectrum, b1, Math.min(n, b2));
  const high = bandAverage(spectrum, Math.min(n, b2), n);
  const energy = clamp01(low * 0.55 + mid * 0.35 + high * 0.2);
  return { low, mid, high, level: Math.max(safeVol, energy) };
}

export function computeConciergePose(input: {
  state: ConciergeAvatarState;
  elapsed: number;
  blinkWeight: number;
  motionBoost: number;
  bands: VoiceBands;
}): ConciergePoseTarget {
  const { state, elapsed: t, blinkWeight, motionBoost, bands } = input;
  const breath = Math.sin(t * 1.65);
  const microPitch = Math.sin(t * 0.85) * 0.018 + Math.sin(t * 1.9) * 0.008;
  const microYaw = Math.sin(t * 0.55) * 0.032 + Math.cos(t * 1.25) * 0.012;
  const microRoll = Math.sin(t * 0.62 + 1.1) * 0.018;

  let headPitch = microPitch;
  let headYaw = -0.14 + microYaw;
  let headRoll = microRoll;
  let eyePitch = -0.01 + Math.sin(t * 0.9) * 0.01;
  let eyeYaw = -0.04 + Math.sin(t * 0.7 + 0.5) * 0.018;
  let ledIntensity = 0.82 + 0.12 * Math.sin(t * 2.1);

  const morphs: Record<string, number> = {
    aa: 0,
    ao: 0,
    ee: 0,
    ih: 0,
    oo: 0,
    uu: 0,
    fv: 0,
    ss: 0,
    sh: 0,
    mpb: 0,
    open: 0,
    blink: clamp01(blinkWeight),
    smile: 0.16,
    smileOpen: 0,
    squint: 0.07,
    lowLid: 0.05,
    browUp: 0.04,
    browOuterLeft: 0,
  };

  if (state === "listening") {
    const nod = Math.max(0, Math.sin(t * 2.3)) * 0.032 + motionBoost * 0.06;
    headPitch += 0.028 + nod;
    headRoll += 0.022;
    morphs.smile = 0.24;
    morphs.squint = 0.11;
    morphs.browUp = 0.12;
    ledIntensity = 0.92 + 0.08 * Math.sin(t * 3.6);
  } else if (state === "thinking") {
    headPitch -= 0.035;
    headYaw += 0.075;
    headRoll += 0.05;
    eyePitch = -0.075;
    eyeYaw = 0.095;
    morphs.smile = 0.06;
    morphs.browUp = 0.2;
    morphs.browOuterLeft = 0.34;
    morphs.mpb = 0.14;
    ledIntensity = 0.65 + 0.35 * (0.5 + 0.5 * Math.sin(t * 6.2));
  } else if (state === "speaking") {
    const hasLiveAudio = bands.level > 0.03;
    const cadence = clamp01(0.48 + 0.34 * Math.sin(t * 10.5) + 0.24 * Math.sin(t * 16.3 + 0.7));
    const gate = clamp01(0.55 + 0.65 * Math.sin(t * 4.4));
    const synthLow = cadence * gate * (0.55 + 0.45 * Math.max(0, Math.sin(t * 6.8)));
    const synthMid = cadence * gate * (0.5 + 0.5 * Math.max(0, Math.cos(t * 8.3)));
    const synthHigh = gate * 0.35 * Math.max(0, Math.sin(t * 13.7));

    const low = hasLiveAudio ? bands.low : synthLow;
    const mid = hasLiveAudio ? bands.mid : synthMid;
    const high = hasLiveAudio ? bands.high : synthHigh;
    const level = hasLiveAudio ? bands.level : clamp01(synthLow * 0.65 + synthMid * 0.45);

    const closure = hasLiveAudio
      ? clamp01((0.14 - level) * 4.5) * 0.32
      : clamp01((0.25 - cadence) * 2.4) * gate * 0.36;

    morphs.aa = clamp01(low * 0.72 * (0.65 + 0.35 * Math.sin(t * 7.1)));
    morphs.ao = clamp01(low * 0.48 * (0.6 + 0.4 * Math.cos(t * 5.9)));
    morphs.open = clamp01(low * 0.38 + mid * 0.16);
    morphs.ee = clamp01(mid * 0.56 * (0.55 + 0.45 * Math.sin(t * 9.4 + 1.2)));
    morphs.ih = clamp01(mid * 0.42 * (0.5 + 0.5 * Math.cos(t * 11.1)));
    morphs.oo = clamp01(mid * 0.46 * Math.max(0, Math.sin(t * 5.3 + 2.0)));
    morphs.uu = clamp01(low * 0.25 * Math.max(0, Math.cos(t * 6.4)));
    morphs.ss = clamp01(high * 0.55);
    morphs.sh = clamp01(high * 0.38 * Math.max(0, Math.sin(t * 12.2)));
    morphs.fv = clamp01(high * 0.42 * Math.max(0, Math.cos(t * 10.6)));
    morphs.mpb = closure;
    morphs.smile = 0.14;
    morphs.smileOpen = clamp01(0.16 + level * 0.18);
    morphs.squint = 0.1;
    morphs.lowLid = 0.08;
    morphs.browUp = clamp01(0.08 + level * 0.24);

    headPitch += Math.sin(t * 4.8) * 0.022 * (0.4 + level) + motionBoost * 0.05;
    headYaw += Math.sin(t * 2.7) * 0.028 * (0.4 + level);
    headRoll += Math.sin(t * 3.1 + 0.6) * 0.02 * (0.4 + level);
    ledIntensity = clamp01(0.76 + level * 0.34);
  } else if (motionBoost > 0.01) {
    headPitch += motionBoost * 0.07;
  }

  return {
    ledColor: LED_COLORS[state],
    ledIntensity,
    headPitch,
    headYaw,
    headRoll,
    eyePitch,
    eyeYaw,
    breath,
    morphs,
  };
}

type MorphBinding = { influences: number[]; index: number };

type RigRefs = {
  root: THREE.Group;
  head?: THREE.Object3D;
  neck?: THREE.Object3D;
  spine1?: THREE.Object3D;
  spine2?: THREE.Object3D;
  leftEye?: THREE.Object3D;
  rightEye?: THREE.Object3D;
  leftShoulder?: THREE.Object3D;
  rightShoulder?: THREE.Object3D;
  leftArm?: THREE.Object3D;
  rightArm?: THREE.Object3D;
  leftForeArm?: THREE.Object3D;
  rightForeArm?: THREE.Object3D;
  restQuats: Map<THREE.Object3D, THREE.Quaternion>;
  morphBindings: Map<string, MorphBinding[]>;
  ledMat: THREE.MeshBasicMaterial;
  ledGlowMat: THREE.MeshBasicMaterial;
};

const TEMPLE_LOCAL_POS = new THREE.Vector3(-0.1686, 8.5239, 6.9778);
const TEMPLE_LOCAL_NORMAL = new THREE.Vector3(0.3053, 0.1687, 0.9372).normalize();

export class ConciergeAvatar {
  private renderer: THREE.WebGLRenderer | null = null;
  private scene: THREE.Scene | null = null;
  private camera: THREE.PerspectiveCamera | null = null;
  private envTexture: THREE.Texture | null = null;
  private rig: RigRefs | null = null;
  private state: ConciergeAvatarState = "idle";
  private audioSource: ConciergeAudioSource | null = null;
  private active = false;
  private disposed = false;
  private loadPromise: Promise<void> | null = null;
  private rafId = 0;
  private lastTimeMs = 0;
  private elapsed = 0;
  private nextBlinkIn = 1.8;
  private blinkTimer = -1;
  private motionBoost = 0;
  private width = 0;
  private height = 0;
  private smoothedMorphs: Record<string, number> = {};
  private smoothedHead = { pitch: 0, yaw: -0.14, roll: 0, eyePitch: 0, eyeYaw: -0.04 };
  private resizeObserver: ResizeObserver | null = null;
  private readonly parentWorldQ = new THREE.Quaternion();
  private readonly deltaWorldQ = new THREE.Quaternion();
  private readonly localDeltaQ = new THREE.Quaternion();
  private readonly tempEuler = new THREE.Euler(0, 0, 0, "XYZ");
  private readonly ledColorObj = new THREE.Color(LED_COLORS.idle);

  constructor(private readonly canvas: HTMLCanvasElement) {}

  get isVisible(): boolean {
    return this.active;
  }

  setAudioSource(source: ConciergeAudioSource | null): void {
    this.audioSource = source;
  }

  show(state: ConciergeAvatarState = "idle"): void {
    if (this.disposed) return;
    this.active = true;
    this.setState(state);
    this.ensureScene();
    this.resize();
    this.startLoop();
  }

  hide(): void {
    this.active = false;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
  }

  setState(state: ConciergeAvatarState): void {
    if (this.state !== state && this.blinkTimer < 0 && this.elapsed > 0.3) {
      this.blinkTimer = 0;
    }
    this.state = state;
  }

  play(motion: string): void {
    if (motion) this.motionBoost = 1;
  }

  resize(): void {
    if (!this.renderer || !this.camera) return;
    const w = this.canvas.clientWidth || 380;
    const h = this.canvas.clientHeight || 480;
    if (w === this.width && h === this.height) return;
    this.width = w;
    this.height = h;
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  dispose(): void {
    this.disposed = true;
    this.hide();
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    if (this.rig) {
      this.rig.root.traverse((node) => {
        if (node instanceof THREE.Mesh) {
          node.geometry?.dispose();
          const materials = Array.isArray(node.material) ? node.material : [node.material];
          for (const mat of materials) mat?.dispose();
        }
      });
      this.rig = null;
    }
    this.envTexture?.dispose();
    this.envTexture = null;
    this.renderer?.dispose();
    this.renderer = null;
    this.scene = null;
    this.camera = null;
  }

  private ensureScene(): void {
    if (this.scene || this.loadPromise) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        canvas: this.canvas,
        alpha: true,
        antialias: true,
        powerPreference: "high-performance",
      });
    } catch {
      return;
    }
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.94;
    renderer.setClearColor(0x000000, 0);

    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    this.envTexture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = this.envTexture;
    scene.environmentIntensity = 0.42;
    pmrem.dispose();

    const hemi = new THREE.HemisphereLight(0xf6f9ff, 0x1e353b, 0.52);
    scene.add(hemi);

    const keyLight = new THREE.DirectionalLight(0xfff1e2, 1.38);
    keyLight.position.set(1.45, 2.0, 2.2);
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0xcce4ff, 0.62);
    fillLight.position.set(-1.6, 1.55, 1.65);
    scene.add(fillLight);

    const rimLight = new THREE.DirectionalLight(0x5fe8ff, 0.95);
    rimLight.position.set(-1.25, 2.0, -1.55);
    scene.add(rimLight);

    const camera = new THREE.PerspectiveCamera(25, 1, 0.05, 20);
    camera.position.set(0.03, 1.515, 1.34);
    camera.lookAt(0, 1.485, 0.06);

    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;

    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(this.canvas);
    }

    this.loadPromise = this.loadModel();
  }

  private async loadModel(): Promise<void> {
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    const modelPath = `/${assetManifest.concierge.iskra}`;
    try {
      const gltf = await withRetry(() => loader.loadAsync(modelPath));
      if (this.disposed || !this.scene) return;
      const root = gltf.scene;
      root.rotation.y = 0.2;
      root.updateMatrixWorld(true);

      const restQuats = new Map<THREE.Object3D, THREE.Quaternion>();
      const morphBindings = new Map<string, MorphBinding[]>();

      root.traverse((obj) => {
        if (obj instanceof THREE.Bone) {
          restQuats.set(obj, obj.quaternion.clone());
        }
        if (!(obj instanceof THREE.Mesh)) return;
        obj.frustumCulled = false;
        const isEye = /^h_[LR]_(eye|gland)$/i.test(obj.name);
        if (obj.material instanceof THREE.MeshStandardMaterial) {
          const mat = obj.material.clone();
          if (mat.map) mat.map.anisotropy = 4;
          if (isEye) {
            mat.roughness = 0.08;
            mat.metalness = 0.0;
            mat.envMapIntensity = 1.45;
          } else if (mat.name === "_Body") {
            mat.roughness = 0.58;
            mat.metalness = 0.0;
            mat.envMapIntensity = 0.5;
          } else if (mat.name === "Hair") {
            mat.roughness = 0.46;
            mat.envMapIntensity = 0.65;
          }
          obj.material = mat;
        }
        const dict = obj.morphTargetDictionary;
        const influences = obj.morphTargetInfluences;
        if (dict && influences) {
          for (const [key, idx] of Object.entries(dict)) {
            const list = morphBindings.get(key) ?? [];
            list.push({ influences, index: idx });
            morphBindings.set(key, list);
          }
        }
      });

      const ledMat = new THREE.MeshBasicMaterial({
        color: LED_COLORS.idle,
        side: THREE.DoubleSide,
        toneMapped: false,
      });
      const ledGlowMat = new THREE.MeshBasicMaterial({
        color: LED_COLORS.idle,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.34,
        toneMapped: false,
        depthWrite: false,
      });

      const head = root.getObjectByName("Head") ?? undefined;
      if (head) {
        const templeGroup = new THREE.Group();
        templeGroup.position.copy(TEMPLE_LOCAL_POS);
        templeGroup.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), TEMPLE_LOCAL_NORMAL);

        const bezel = new THREE.Mesh(
          new THREE.RingGeometry(0.46, 0.92, 32),
          new THREE.MeshStandardMaterial({ color: 0x1b242c, roughness: 0.3, metalness: 0.8, side: THREE.DoubleSide }),
        );
        const ledRing = new THREE.Mesh(new THREE.RingGeometry(0.54, 0.83, 32), ledMat);
        ledRing.position.z = 0.03;
        const ledHalo = new THREE.Mesh(new THREE.RingGeometry(0.42, 1.08, 32), ledGlowMat);
        ledHalo.position.z = 0.02;

        templeGroup.add(bezel, ledHalo, ledRing);
        head.add(templeGroup);
      }

      this.rig = {
        root,
        head,
        neck: root.getObjectByName("Neck") ?? undefined,
        spine1: root.getObjectByName("Spine1") ?? undefined,
        spine2: root.getObjectByName("Spine2") ?? undefined,
        leftEye: root.getObjectByName("LeftEye") ?? undefined,
        rightEye: root.getObjectByName("RightEye") ?? undefined,
        leftShoulder: root.getObjectByName("LeftShoulder") ?? undefined,
        rightShoulder: root.getObjectByName("RightShoulder") ?? undefined,
        leftArm: root.getObjectByName("LeftArm") ?? undefined,
        rightArm: root.getObjectByName("RightArm") ?? undefined,
        leftForeArm: root.getObjectByName("LeftForeArm") ?? undefined,
        rightForeArm: root.getObjectByName("RightForeArm") ?? undefined,
        restQuats,
        morphBindings,
        ledMat,
        ledGlowMat,
      };

      this.applyRelaxedArms(0);
      this.scene.add(root);
      this.stepAnimation(1 / 60);
      if (this.renderer && this.camera) {
        this.resize();
        this.renderer.render(this.scene, this.camera);
        this.canvas.dataset.avatarReady = "true";
      }
    } catch {
      this.canvas.dataset.avatarReady = "error";
    }
  }

  private rotateBoneWorld(bone: THREE.Object3D | undefined, rx: number, ry: number, rz: number): void {
    if (!bone || !bone.parent || !this.rig) return;
    const rest = this.rig.restQuats.get(bone);
    if (!rest) return;
    bone.parent.getWorldQuaternion(this.parentWorldQ);
    this.tempEuler.set(rx, ry, rz, "XYZ");
    this.deltaWorldQ.setFromEuler(this.tempEuler);
    this.localDeltaQ.copy(this.parentWorldQ).invert().multiply(this.deltaWorldQ).multiply(this.parentWorldQ);
    bone.quaternion.copy(this.localDeltaQ).multiply(rest);
    bone.updateMatrixWorld(true);
  }

  private applyRelaxedArms(breath: number): void {
    if (!this.rig) return;
    const lift = breath * 0.012;
    this.rotateBoneWorld(this.rig.leftShoulder, 0, 0, -0.12 + lift);
    this.rotateBoneWorld(this.rig.rightShoulder, 0, 0, 0.12 - lift);
    this.rotateBoneWorld(this.rig.leftArm, -0.06, 0.08, -1.24 + lift * 0.5);
    this.rotateBoneWorld(this.rig.rightArm, -0.06, -0.08, 1.24 - lift * 0.5);
    this.rotateBoneWorld(this.rig.leftForeArm, -0.22, 0.25, -0.06);
    this.rotateBoneWorld(this.rig.rightForeArm, -0.22, -0.25, 0.06);
  }

  private startLoop(): void {
    if (this.rafId || !this.renderer) return;
    this.lastTimeMs = performance.now();
    const tick = (nowMs: number): void => {
      if (!this.active || this.disposed || !this.renderer || !this.scene || !this.camera) {
        this.rafId = 0;
        return;
      }
      this.rafId = requestAnimationFrame(tick);
      const dt = Math.min(0.05, Math.max(0.001, (nowMs - this.lastTimeMs) / 1000));
      this.lastTimeMs = nowMs;
      const cw = this.canvas.clientWidth;
      const ch = this.canvas.clientHeight;
      if (cw > 0 && ch > 0 && (cw !== this.width || ch !== this.height)) this.resize();
      this.stepAnimation(dt);
      this.renderer.render(this.scene, this.camera);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private updateBlink(dt: number): number {
    if (this.blinkTimer < 0) {
      this.nextBlinkIn -= dt;
      if (this.nextBlinkIn <= 0) {
        this.blinkTimer = 0;
        this.nextBlinkIn = 2.4 + ((Math.sin(this.elapsed * 3.7) * 0.5 + 0.5) * 2.6);
      }
      return 0;
    }
    this.blinkTimer += dt;
    const duration = 0.15;
    if (this.blinkTimer >= duration) {
      this.blinkTimer = -1;
      return 0;
    }
    const half = duration * 0.45;
    return this.blinkTimer < half
      ? this.blinkTimer / half
      : 1 - (this.blinkTimer - half) / (duration - half);
  }

  private stepAnimation(dt: number): void {
    this.elapsed += dt;
    this.motionBoost = Math.max(0, this.motionBoost - dt * 2.4);
    const rig = this.rig;
    if (!rig) return;

    const blinkWeight = this.updateBlink(dt);
    const rawSample = this.audioSource ? this.audioSource() : null;
    const bands = extractVoiceBands(rawSample?.spectrum, rawSample?.volume ?? 0);
    const pose = computeConciergePose({
      state: this.state,
      elapsed: this.elapsed,
      blinkWeight,
      motionBoost: this.motionBoost,
      bands,
    });

    const headRate = 1 - Math.exp(-dt * 9);
    const eyeRate = 1 - Math.exp(-dt * 16);
    const morphRate = 1 - Math.exp(-dt * 18);

    this.smoothedHead.pitch += (pose.headPitch - this.smoothedHead.pitch) * headRate;
    this.smoothedHead.yaw += (pose.headYaw - this.smoothedHead.yaw) * headRate;
    this.smoothedHead.roll += (pose.headRoll - this.smoothedHead.roll) * headRate;
    this.smoothedHead.eyePitch += (pose.eyePitch - this.smoothedHead.eyePitch) * eyeRate;
    this.smoothedHead.eyeYaw += (pose.eyeYaw - this.smoothedHead.eyeYaw) * eyeRate;

    this.rotateBoneWorld(rig.spine1, pose.breath * 0.008, 0, 0);
    this.rotateBoneWorld(rig.spine2, pose.breath * 0.012, this.smoothedHead.yaw * 0.14, 0);
    this.applyRelaxedArms(pose.breath);
    this.rotateBoneWorld(rig.neck, this.smoothedHead.pitch * 0.35, this.smoothedHead.yaw * 0.35, this.smoothedHead.roll * 0.35);
    this.rotateBoneWorld(rig.head, this.smoothedHead.pitch * 0.65, this.smoothedHead.yaw * 0.65, this.smoothedHead.roll * 0.65);
    this.rotateBoneWorld(rig.leftEye, this.smoothedHead.eyePitch, this.smoothedHead.eyeYaw, 0);
    this.rotateBoneWorld(rig.rightEye, this.smoothedHead.eyePitch, this.smoothedHead.eyeYaw, 0);

    for (const [group, targetValue] of Object.entries(pose.morphs)) {
      const rate = group === "blink" ? 1 : morphRate;
      const prev = this.smoothedMorphs[group] ?? 0;
      const next = prev + (targetValue - prev) * rate;
      this.smoothedMorphs[group] = next;
      const keys = MORPH_GROUPS[group];
      if (!keys) continue;
      for (const key of keys) {
        const bindings = rig.morphBindings.get(key);
        if (!bindings) continue;
        for (const binding of bindings) binding.influences[binding.index] = next;
      }
    }

    this.ledColorObj.setHex(pose.ledColor).multiplyScalar(pose.ledIntensity);
    rig.ledMat.color.copy(this.ledColorObj);
    rig.ledGlowMat.color.setHex(pose.ledColor);
    rig.ledGlowMat.opacity = 0.18 + pose.ledIntensity * 0.24;
  }
}
