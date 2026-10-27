import * as THREE from "three";

export type SurfaceDetail = {
  frequency: number;
  strength: number;
  bump: number;
  weave: boolean;
  roughness: number;
};

export const FABRIC: SurfaceDetail = { frequency: 70, strength: 0.38, bump: 0.5, weave: true, roughness: 0.92 };
export const DENIM: SurfaceDetail = { frequency: 90, strength: 0.5, bump: 0.7, weave: true, roughness: 0.95 };
export const SKIN: SurfaceDetail = { frequency: 40, strength: 0.08, bump: 0.1, weave: false, roughness: 0.72 };
export const LEATHER: SurfaceDetail = { frequency: 45, strength: 0.28, bump: 0.65, weave: false, roughness: 0.8 };

const FN = /* glsl */ `
varying vec3 gFabPos;
varying vec3 gFabNormal;
uniform vec4 gFabParams;
float gFabHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float gFabVNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(gFabHash(i), gFabHash(i + vec2(1.0, 0.0)), f.x), mix(gFabHash(i + vec2(0.0, 1.0)), gFabHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
vec2 gFabUv() {
  vec3 q = gFabPos * gFabParams.x;
  vec3 a = abs(gFabNormal);
  return (a.x > a.y && a.x > a.z) ? q.yz : ((a.y > a.z) ? q.xz : q.xy);
}
float gFabFade(vec2 uv) {
  float fw = max(length(dFdx(uv)), length(dFdy(uv)));
  return 1.0 - smoothstep(0.25, 0.7, fw);
}
float gFabHeight() {
  vec2 uv = gFabUv();
  float fade = gFabFade(uv);
  float n = gFabVNoise(uv * 1.5);
  float n2 = gFabVNoise(uv * 0.5 + 17.0);
  float weave = 0.5 + 0.5 * sin(uv.x * 6.2831853) * sin(uv.y * 6.2831853);
  float h = gFabParams.w > 0.5 ? (0.55 * weave * fade + 0.3 * n + 0.15 * n2) : (0.6 * n + 0.4 * n2);
  return mix(0.5, h, fade);
}
vec2 gFabGrad() {
  float h = gFabHeight();
  return vec2(dFdx(h), dFdy(h)) * gFabParams.z * 0.5;
}
`;

export function applySurfaceDetail(material: THREE.MeshStandardMaterial, detail: SurfaceDetail): void {
  material.roughness = detail.roughness;
  material.metalness = 0;
  material.bumpMap = BUMP_STUB;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.gFabParams = { value: new THREE.Vector4(detail.frequency, detail.strength, detail.bump, detail.weave ? 1 : 0) };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 gFabPos;\nvarying vec3 gFabNormal;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\ngFabPos = position;\ngFabNormal = normal;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${FN}`)
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>
        diffuseColor.rgb *= 1.0 - gFabParams.y * (gFabHeight() - 0.5);`
      );
    const chunk = THREE.ShaderChunk.normal_fragment_maps;
    if (!chunk.includes("dHdxy_fwd()")) throw new Error("Three.js normal_fragment_maps changed; dHdxy_fwd() missing");
    shader.fragmentShader = shader.fragmentShader.replace("#include <normal_fragment_maps>", chunk.replace("dHdxy_fwd()", "gFabGrad()"));
  };
  material.customProgramCacheKey = () => `giera-surface-${detail.frequency}-${detail.weave ? "w" : "s"}`;
  material.needsUpdate = true;
}

const BUMP_STUB = (() => {
  const tex = new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1);
  tex.needsUpdate = true;
  return tex;
})();
