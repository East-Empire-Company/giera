## 2026-10-29T10:13:36.523Z stage=goldens
reason: Giera art pass: terrain shading, stylized bark, lighting, foliage, and postprocessing

## 2026-10-29T11:33:35.634Z stage=goldens
reason: Art pass final: official CSM cascades (3x512, PCFShadowMap), smooth terrain normals, grass blades, flat bark palette, N8AO + bloom postfx. Reviewed diffs: red regions match shadows, foliage and bark only.

## 2026-10-29T12:26:43.451Z stage=goldens
reason: Art pass round 2: training dummy no longer renders black (white vertex colours), CSM now 2x1024 cascades with PBR specular restored, terrain casters limited to 80 blocks, blades no longer cast. Reviewed diffs: red regions are dummy, ground shadow shapes and foliage only.

## 2026-10-29T22:00:45.145Z stage=goldens
reason: tone mapping moved into the post chain (R5) plus cascaded shadows and grass decor landed after the 13:26 refresh; F2 merged opaque tile material verified look-neutral (0.0002% vs legacy path)

## 2026-10-29T22:04:02.044Z stage=goldens
reason: tone mapping moved into the post chain (R5) plus cascaded shadows and grass decor landed after the 13:26 refresh; F2 merged opaque tile material verified look-neutral (0.0002% vs legacy path); captures now freeze the sim at frame 600 so time-driven wind/NPC/particles cannot drift

## 2026-10-30T13:03:46.701Z stage=goldens
reason: intended worldgen/tycoon terrain change plus atlas re-encode to WebP (albedo+ORM q92, normal lossless) and 1k HDR env

## 2026-10-30T23:29:04.294Z stage=goldens
reason: HUD music pill replaced by 56x56 inventory button; headless chromium reports hover:none so inventory button stays hidden in golden captures

## 2026-11-01T01:06:31.134Z stage=goldens
reason: voxel AO anisotropy + range, smooth terrain deform, mining debris

## 2026-11-01T19:46:19.860Z stage=goldens
reason: Family GLB avatars and seeded NPC idle animations are intended visual changes

## 2026-11-01T20:22:48.714Z stage=goldens
reason: QA composer time now follows deterministic simulation time

## 2026-11-03T00:40:42.520Z stage=goldens
reason: Avatar ground-follow rework: footprint-sampled smoothGroundOffset with per-profile lift shifts character grounding slightly in tycoon view (companion/NPC terrain fix)

## 2026-11-04T00:32:13.652Z stage=goldens
reason: Visually reviewed expected/captured/diff for all 3. Intended changes only: Warsaw city connector (asphalt y=60 at x4..6,z<=4, probed via generateBlock) visible beside spawn; city district now fills tycoon-view background (camera looks toward -z); family avatars calibrated to 1.2 m (kids) so smaller at same positions. HUD, terrain, avatars intact; no blank or corrupt frames. Atlas TNT tile addition verified not to alter existing tiles (MAD<=2.85).

