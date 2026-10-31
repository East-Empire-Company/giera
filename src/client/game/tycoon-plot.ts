import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import assetManifest from "../../shared/asset-manifest.json";
import { withRetry } from "../../shared/retry";
import type { Cylinder } from "../../shared/entity-collision";

export type TycoonPlotOptions = {
  surfaceAt: (x: number, z: number) => number;
  blocked?: (x: number, z: number) => boolean;
};

type FactoryModel =
  | "factoryConveyor"
  | "factoryLongConveyor"
  | "factoryMachine"
  | "factoryHopper"
  | "factoryScanner"
  | "factoryButton"
  | "factoryGear";

type Stage = { tier: number; object: THREE.Group; age: number };
type AnimatedButton = { mixer: THREE.AnimationMixer; action: THREE.AnimationAction; root: THREE.Object3D };
type Product = { object: THREE.Group; age: number };

const FACTORY_MODELS: Record<FactoryModel, string> = {
  factoryConveyor: assetManifest.models.factoryConveyor,
  factoryLongConveyor: assetManifest.models.factoryLongConveyor,
  factoryMachine: assetManifest.models.factoryMachine,
  factoryHopper: assetManifest.models.factoryHopper,
  factoryScanner: assetManifest.models.factoryScanner,
  factoryButton: assetManifest.models.factoryButton,
  factoryGear: assetManifest.models.factoryGear,
};

const MACHINE_HEIGHT = 1.3;
const MAIN_MACHINE_SCALE = 1.8;
const SIDE_MACHINE_SCALE = 1.25;
const PRODUCT_POOL_SIZE = 6;
const PRODUCT_DURATION = 2.4;
const PRODUCT_SCALE = 0.38;
const PRODUCT_START_X = -2.35;
const PRODUCT_END_X = 4.45;
const PRODUCT_Z = -4.6;

export class TycoonPlot {
  readonly group = new THREE.Group();
  private readonly surfaceAt: (x: number, z: number) => number;
  private readonly blocked?: (x: number, z: number) => boolean;
  private readonly originY: number;
  private readonly templates = new Map<FactoryModel, THREE.Group>();
  private readonly clips = new Map<FactoryModel, THREE.AnimationClip[]>();
  private readonly stages: Stage[] = [];
  private readonly colliderRoots: THREE.Object3D[] = [];
  private readonly collisionBodies: Cylinder[] = [];
  private readonly collisionBounds = new THREE.Box3();
  private readonly collisionSize = new THREE.Vector3();
  private readonly gears: THREE.Group[] = [];
  private readonly buttons: AnimatedButton[] = [];
  private readonly products: Product[] = [];
  private pendingProducts = 0;
  private productBeltTop = 0;
  private productBottom = 0;
  private shadowMaterialRegistrar?: (material: THREE.Material) => void;
  private time = 0;
  private tier = 1;
  private lastTier = 0;
  private disposed = false;
  private collisionDirty = true;

  private registerCollider(root: THREE.Object3D): void {
    this.colliderRoots.push(root);
    this.collisionDirty = true;
  }

  getCollisionBodies(): readonly Cylinder[] {
    if (!this.collisionDirty) return this.collisionBodies;
    this.group.updateWorldMatrix(true, true);
    let count = 0;
    for (const root of this.colliderRoots) {
      if (!root.visible) continue;
      this.collisionBounds.makeEmpty();
      this.collisionBounds.setFromObject(root);
      if (this.collisionBounds.isEmpty()) continue;
      const size = this.collisionBounds.getSize(this.collisionSize);
      const radius = Math.max(size.x, size.z) * 0.5;
      if (radius <= 0.05 || size.y <= 0.05) continue;
      let body = this.collisionBodies[count];
      if (!body) {
        body = { x: 0, y: 0, z: 0, radius: 0, height: 0 };
        this.collisionBodies.push(body);
      }
      body.x = (this.collisionBounds.min.x + this.collisionBounds.max.x) * 0.5;
      body.y = this.collisionBounds.min.y;
      body.z = (this.collisionBounds.min.z + this.collisionBounds.max.z) * 0.5;
      body.radius = radius;
      body.height = size.y;
      count++;
    }
    this.collisionBodies.length = count;
    this.collisionDirty = false;
    return this.collisionBodies;
  }

  constructor(origin: THREE.Vector3, options: TycoonPlotOptions) {
    this.surfaceAt = options.surfaceAt;
    this.blocked = options.blocked;
    this.originY = origin.y;
    this.group.position.copy(origin);
    this.group.name = "tycoon-plot";
    void this.loadModels().catch((error: unknown) => {
      if (this.disposed) return;
      console.error("Unable to build tycoon factory", error);
      this.dispose();
    });
  }
  registerShadowMaterials(register: (material: THREE.Material) => void): void {
    this.shadowMaterialRegistrar = register;
    for (const template of this.templates.values()) this.registerModelMaterials(template);
  }

  private async loadModels(): Promise<void> {
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    const entries = Object.entries(FACTORY_MODELS) as [FactoryModel, string][];
    const results = await Promise.allSettled(
      entries.map(([, path]) => withRetry(() => loader.loadAsync(`/${path}`)))
    );
    const loaded: { name: FactoryModel; scene: THREE.Group; animations: THREE.AnimationClip[] }[] = [];
    const failures: string[] = [];
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const [name, path] = entries[i];
      if (result.status === "rejected") {
        failures.push(`${path}: ${String(result.reason)}`);
        continue;
      }
      loaded.push({ name, scene: result.value.scene, animations: result.value.animations });
    }
    if (failures.length > 0) {
      this.disposeScenes(loaded.map((model) => model.scene));
      throw new Error(`Critical tycoon model failures: ${failures.join("; ")}`);
    }
    if (this.disposed) {
      this.disposeScenes(loaded.map((model) => model.scene));
      return;
    }
    for (const model of loaded) {
      model.scene.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.castShadow = true;
          object.receiveShadow = true;
        }
      });
      this.templates.set(model.name, model.scene);
      this.clips.set(model.name, model.animations);
      this.registerModelMaterials(model.scene);
    }
    this.buildFactory();
    this.initializeProductPool();
    this.lastTier = 0;
    this.syncTier(this.tier);
  }

  private registerModelMaterials(root: THREE.Object3D): void {
    const register = this.shadowMaterialRegistrar;
    if (!register) return;
    root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) register(material);
    });
  }
  private groundAt(x: number, z: number): number {
    const y = this.surfaceAt(x, z);
    return Number.isFinite(y) ? y + 1 - this.originY : 0;
  }

  private addModel(
    name: FactoryModel,
    x: number,
    z: number,
    scale: number,
    parent: THREE.Group = this.group,
    lift = 0
  ): THREE.Group | undefined {
    const template = this.templates.get(name);
    if (!template || this.blocked?.(x, z)) return undefined;
    const parentX = parent === this.group ? 0 : parent.position.x;
    const parentY = parent === this.group ? 0 : parent.position.y;
    const parentZ = parent === this.group ? 0 : parent.position.z;
    const instance = template.clone(true);
    instance.position.set(
      x - parentX,
      this.groundAt(x, z) + lift - parentY,
      z - parentZ
    );
    instance.scale.setScalar(scale);
    parent.add(instance);
    if (parent === this.group) this.registerCollider(instance);
    if (name === "factoryButton") this.addButtonAnimation(instance);
    return instance;
  }

  private addGear(x: number, z: number, parent: THREE.Group = this.group): void {
    const template = this.templates.get("factoryGear");
    if (!template || this.blocked?.(x, z)) return;
    const parentX = parent === this.group ? 0 : parent.position.x;
    const parentY = parent === this.group ? 0 : parent.position.y;
    const parentZ = parent === this.group ? 0 : parent.position.z;
    const pivot = new THREE.Group();
    pivot.position.set(x - parentX, this.groundAt(x, z) + 1 - parentY, z - parentZ);
    const wheel = template.clone(true);
    wheel.rotation.z = Math.PI / 2;
    wheel.scale.setScalar(1.2);
    pivot.add(wheel);
    parent.add(pivot);
    if (parent === this.group) this.registerCollider(pivot);
    this.gears.push(pivot);
  }

  private addButtonAnimation(root: THREE.Object3D): void {
    const clip = this.clips.get("factoryButton")?.find((entry) => entry.name.toLowerCase() === "toggle");
    if (!clip) return;
    const mixer = new THREE.AnimationMixer(root);
    const action = mixer.clipAction(clip);
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    this.buttons.push({ mixer, action, root });
  }

  private addStage(tier: number, x: number, z: number, build: (root: THREE.Group) => void): void {
    const root = new THREE.Group();
    root.position.set(x, 0, z);
    root.scale.setScalar(0.001);
    root.visible = false;
    root.name = `tycoon-stage-${tier}`;
    this.group.add(root);
    build(root);
    this.stages.push({ tier, object: root, age: 0 });
    this.registerCollider(root);
  }

  private buildFactory(): void {
    this.addModel("factoryMachine", -3.2, -4.6, MAIN_MACHINE_SCALE);
    this.addModel("factoryHopper", -3.2, -4.6, MAIN_MACHINE_SCALE, this.group, MACHINE_HEIGHT * MAIN_MACHINE_SCALE);
    this.addGear(-4.28, -4.6);

    for (const x of [-1.3, 0.7, 2.7]) this.addModel("factoryLongConveyor", x, -4.6, 1);
    this.addModel("factoryConveyor", 4.2, -4.6, 1);
    this.addModel("factoryScanner", 0.7, -4.6, 1);
    this.addModel("factoryButton", 5.1, -4.6, 1.8);

    this.addStage(2, 5, -1.4, (root) => {
      this.addModel("factoryMachine", 5, -1.4, SIDE_MACHINE_SCALE, root);
    });
    this.addStage(3, 5, -1.4, (root) => {
      this.addModel("factoryHopper", 5, -1.4, SIDE_MACHINE_SCALE, root, MACHINE_HEIGHT * SIDE_MACHINE_SCALE);
    });
    this.addStage(4, 5, 1.4, (root) => {
      this.addModel("factoryScanner", 5, 1.4, 1.2, root);
    });
    this.addStage(5, 5, -2.6, (root) => {
      this.addModel("factoryButton", 5, -2.6, 1.8, root);
    });
  }

  produce(): void {
    if (this.disposed) return;
    if (this.products.length === 0) {
      this.pendingProducts = Math.min(PRODUCT_POOL_SIZE, this.pendingProducts + 1);
      return;
    }
    this.startProduct();
  }

  private initializeProductPool(): void {
    const conveyor = this.templates.get("factoryLongConveyor");
    const template = this.templates.get("factoryGear");
    if (!conveyor || !template) return;
    this.productBeltTop = new THREE.Box3().setFromObject(conveyor).max.y;
    const first = template.clone(true);
    first.rotation.z = Math.PI / 2;
    first.scale.setScalar(PRODUCT_SCALE);
    this.productBottom = new THREE.Box3().setFromObject(first).min.y;
    for (let i = 0; i < PRODUCT_POOL_SIZE; i++) {
      const object = i === 0 ? first : template.clone(true);
      if (i > 0) {
        object.rotation.z = Math.PI / 2;
        object.scale.setScalar(PRODUCT_SCALE);
      }
      object.name = `tycoon-product-${i}`;
      object.visible = false;
      this.group.add(object);
      this.products.push({ object, age: -1 });
    }
    const pending = this.pendingProducts;
    this.pendingProducts = 0;
    for (let i = 0; i < pending; i++) {
      this.startProduct(((i + 1) * PRODUCT_DURATION) / (pending + 1));
    }
  }

  private startProduct(age = 0): void {
    const product = this.products.find((entry) => entry.age < 0);
    if (!product) return;
    product.age = age;
    product.object.visible = true;
    this.positionProduct(product);
  }

  private positionProduct(product: Product): void {
    const progress = product.age / PRODUCT_DURATION;
    const x = PRODUCT_START_X + (PRODUCT_END_X - PRODUCT_START_X) * progress;
    product.object.position.set(
      x,
      this.groundAt(x, PRODUCT_Z) + this.productBeltTop - this.productBottom,
      PRODUCT_Z
    );
    product.object.rotation.y = product.age * Math.PI * 2;
  }

  private updateProducts(delta: number): void {
    for (const product of this.products) {
      if (product.age < 0) continue;
      product.age += delta;
      if (product.age >= PRODUCT_DURATION) {
        product.age = -1;
        product.object.visible = false;
        continue;
      }
      this.positionProduct(product);
    }
  }

  private syncTier(tier: number): void {
    if (tier !== this.lastTier) {
      if (this.lastTier > 0 && tier > this.lastTier) {
        for (const button of this.buttons) {
          button.action.stop();
          button.action.reset().play();
        }
      }
      for (const stage of this.stages) {
        if (stage.tier <= tier && !stage.object.visible) {
          stage.object.visible = true;
          stage.age = 0;
          this.collisionDirty = true;
        }
      }
      this.lastTier = tier;
    }
  }

  update(delta: number, tier: number): void {
    if (this.disposed) return;
    this.time += delta;
    this.tier = tier;
    for (const gear of this.gears) gear.rotation.x = this.time * 1.25;
    for (const button of this.buttons) button.mixer.update(delta);
    this.syncTier(tier);
    this.updateProducts(delta);

    for (const stage of this.stages) {
      if (!stage.object.visible) continue;
      if (stage.age < 0.45) {
        stage.age = Math.min(0.45, stage.age + delta);
        const progress = stage.age / 0.45;
        stage.object.scale.setScalar(Math.min(1.05, progress * (1 + Math.sin(progress * Math.PI) * 0.16)));
        this.collisionDirty = true;
      } else if (stage.object.scale.x !== 1) {
        stage.object.scale.setScalar(1);
        this.collisionDirty = true;
      }
    }
  }

  private disposeScenes(scenes: THREE.Object3D[]): void {
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    const textures = new Set<THREE.Texture>();
    for (const scene of scenes) {
      scene.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        geometries.add(object.geometry);
        const meshMaterials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of meshMaterials) {
          materials.add(material);
          for (const value of Object.values(material)) {
            if (value instanceof THREE.Texture) textures.add(value);
          }
        }
      });
    }
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    for (const texture of textures) texture.dispose();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const button of this.buttons) {
      button.mixer.stopAllAction();
      button.mixer.uncacheRoot(button.root);
    }
    this.buttons.length = 0;
    this.group.removeFromParent();
    this.group.clear();
    this.disposeScenes([...this.templates.values()]);
    this.templates.clear();
    this.clips.clear();
    this.gears.length = 0;
    this.products.length = 0;
    this.colliderRoots.length = 0;
    this.collisionBodies.length = 0;
    this.pendingProducts = 0;
    this.stages.length = 0;
  }
}
