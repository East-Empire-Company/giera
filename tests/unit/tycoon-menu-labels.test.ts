// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { TycoonManager } from "../../src/client/game/tycoon";

afterEach(() => vi.restoreAllMocks());

describe("tycoon launch labels", () => {
  it("hides launch-only name and expansion labels, then restores them for gameplay", () => {
    const context = {
      clearRect() {}, fillRect() {}, strokeRect() {}, beginPath() {}, roundRect() {}, fill() {}, stroke() {},
      arc() {}, moveTo() {}, lineTo() {}, closePath() {}, fillText() {}, measureText: () => ({ width: 100 }),
    } as unknown as CanvasRenderingContext2D;
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => context);
    vi.spyOn(GLTFLoader.prototype, "loadAsync").mockImplementation(() => new Promise(() => {}));
    const tycoon = new TycoonManager({ x: 0, y: 50, z: 0 }, new THREE.Scene(), { label: "Ziemek" });
    const nameLabel = tycoon.object?.children.find((child) => child instanceof THREE.Sprite && child.scale.x === 3.2);
    const expansionLabel = tycoon.expansion.group.children.find((child) => child instanceof THREE.Sprite);
    expect(tycoon.object?.getObjectByName("hq-headquarters-art")).toBeDefined();

    tycoon.updateMenuVisuals(1 / 60);
    expect(nameLabel?.visible).toBe(false);
    expect(expansionLabel?.visible).toBe(false);

    tycoon.updateVisuals(1 / 60);
    expect(nameLabel?.visible).toBe(true);
    expect(expansionLabel?.visible).toBe(true);
  });
});
