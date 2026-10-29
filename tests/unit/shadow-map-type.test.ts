import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { SHADOW_MAP_TYPE } from "../../src/client/render/renderer";

describe("renderer shadow map type", () => {
  it("never selects the shadow filter Three.js r186 rewrites with a warning", () => {
    expect(SHADOW_MAP_TYPE).not.toBe(THREE.PCFSoftShadowMap);
    expect([THREE.PCFShadowMap, THREE.VSMShadowMap]).toContain(SHADOW_MAP_TYPE);
  });
});
