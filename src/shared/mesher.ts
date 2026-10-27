import { getBlockDef } from "./blocks";
import { CHUNK_SIZE, CHUNK_VOLUME, getBlockIndex } from "./chunk";

export type TileUV = readonly number[];
export type AtlasTile = { id: number; uv: TileUV };
export type MeshGroup = { tile: number; start: number; count: number };
export type ChunkMesh = {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  colors: Float32Array;
  indices: Uint32Array;
  groups: MeshGroup[];
};
type Face = { tile: AtlasTile; sign: number; ao0: number; ao1: number; ao2: number; ao3: number; key: string; smooth: boolean; leaf: boolean };
type TileMesh = { positions: number[]; normals: number[]; uvs: number[]; colors: number[]; indices: number[] };

const AXES = [
  { normal: 0, u: 1, v: 2 },
  { normal: 1, u: 2, v: 0 },
  { normal: 2, u: 0, v: 1 },
] as const;

const isSmoothBlock = (id: number): boolean => id === 4 || id === 5 || id === 6;

function columnTop(getBlock: (x: number, y: number, z: number) => number, x: number, z: number, y: number): number | null {
  for (let yy = y + 1; yy >= y - 2; yy--) {
    if (isSmoothBlock(getBlock(x, yy, z)) && !isSmoothBlock(getBlock(x, yy + 1, z))) return yy + 1;
  }
  return null;
}

export function smoothVertexHeight(getBlock: (x: number, y: number, z: number) => number, x: number, y: number, z: number): number {
  let sum = 0;
  let anyAtLevel = false;
  for (const [ox, oz] of [[-1, -1], [0, -1], [-1, 0], [0, 0]] as const) {
    const top = columnTop(getBlock, x + ox, z + oz, y);
    if (top === y) anyAtLevel = true;
    sum += top !== null && Math.abs(top - y) <= 1 ? top : y;
  }
  return anyAtLevel ? sum / 4 : y;
}

/** Visual height of the smoothed ground under (x,z) minus the voxel top the physics body stands on. */
export function smoothGroundOffset(getBlock: (x: number, y: number, z: number) => number, x: number, z: number, feetY: number): number {
  const cx = Math.floor(x);
  const cz = Math.floor(z);
  const top = Math.round(feetY);
  if (!isSmoothBlock(getBlock(cx, top - 1, cz))) return 0;
  const fx = x - cx;
  const fz = z - cz;
  const h = (ox: number, oz: number) => smoothVertexHeight(getBlock, cx + ox, top, cz + oz);
  const visual = h(0, 0) * (1 - fx) * (1 - fz) + h(1, 0) * fx * (1 - fz) + h(0, 1) * (1 - fx) * fz + h(1, 1) * fx * fz;
  return visual - top;
}
const LEAF_ID = 8;

export function roundLeafVertex(
  getBlock: (x: number, y: number, z: number) => number,
  x: number,
  y: number,
  z: number,
  fnx: number,
  fny: number,
  fnz: number,
  origin: readonly number[] = [0, 0, 0]
): { x: number; y: number; z: number; nx: number; ny: number; nz: number } {
  let n = 0;
  let sx = 0;
  let sy = 0;
  let sz = 0;
  for (let dx = -1; dx <= 0; dx++) for (let dy = -1; dy <= 0; dy++) for (let dz = -1; dz <= 0; dz++) {
    if (getBlock(x + dx, y + dy, z + dz) === LEAF_ID) {
      n++;
      sx += x + dx + 0.5;
      sy += y + dy + 0.5;
      sz += z + dz + 0.5;
    }
  }
  if (n === 0 || n === 8) return { x, y, z, nx: fnx, ny: fny, nz: fnz };
  const cx = sx / n;
  const cy = sy / n;
  const cz = sz / n;
  const k = Math.min(0.5, 0.1 * (8 - n));
  const jit = (a: number, b: number, c: number): number => {
    let h = Math.imul(a, 374761393) ^ Math.imul(b, 668265263) ^ Math.imul(c, 2147483647);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return (((h ^ (h >>> 16)) >>> 0) / 4294967295 - 0.5) * 0.3;
  };
  const wx = x + origin[0];
  const wy = y + origin[1];
  const wz = z + origin[2];
  const px = x + (cx - x) * k + jit(wx, wy, wz);
  const py = y + (cy - y) * k + jit(wy, wz, wx);
  const pz = z + (cz - z) * k + jit(wz, wx, wy);
  let bx = px - cx;
  let by = py - cy;
  let bz = pz - cz;
  const bl = Math.hypot(bx, by, bz) || 1;
  bx /= bl; by /= bl; bz /= bl;
  let nx = bx * 0.75 + fnx * 0.25;
  let ny = by * 0.75 + fny * 0.25;
  let nz = bz * 0.75 + fnz * 0.25;
  const nl = Math.hypot(nx, ny, nz) || 1;
  nx /= nl; ny /= nl; nz /= nl;
  return { x: px, y: py, z: pz, nx, ny, nz };
}

export function meshChunk(input: {
  data: Uint8Array;
  cx: number;
  cy: number;
  cz: number;
  getBlock: (x: number, y: number, z: number) => number;
  atlas: Record<string, AtlasTile>;
}): ChunkMesh {
  if (input.data.length !== CHUNK_VOLUME) throw new RangeError(`Expected ${CHUNK_VOLUME} block IDs`);
  const origin = [input.cx * CHUNK_SIZE, input.cy * CHUNK_SIZE, input.cz * CHUNK_SIZE];
  const meshes = new Map<number, TileMesh>();
  const localBlock = (x: number, y: number, z: number): number => {
    if (x >= 0 && y >= 0 && z >= 0 && x < CHUNK_SIZE && y < CHUNK_SIZE && z < CHUNK_SIZE) {
      return input.data[getBlockIndex(x, y, z)];
    }
    return input.getBlock(origin[0] + x, origin[1] + y, origin[2] + z);
  };
  const smoothHeight = (x: number, y: number, z: number): number => smoothVertexHeight(localBlock, x, y, z);
  const addFace = (face: Face, axis: typeof AXES[number], slice: number, u: number, v: number, width: number, height: number): void => {
    let mesh = meshes.get(face.tile.id);
    if (!mesh) {
      mesh = { positions: [], normals: [], uvs: [], colors: [], indices: [] };
      meshes.set(face.tile.id, mesh);
    }
    const plane = slice + (face.sign > 0 ? 1 : 0);
    const baseX = axis.normal === 0 ? plane : axis.u === 0 ? u : v;
    const baseY = axis.normal === 1 ? plane : axis.u === 1 ? u : v;
    const baseZ = axis.normal === 2 ? plane : axis.u === 2 ? u : v;
    const vertexStart = mesh.positions.length / 3;
    for (let i = 0; i < 4; i++) {
      const corner = face.sign > 0 ? i : (i === 0 ? 0 : i === 1 ? 3 : i === 2 ? 2 : 1);
      const uCoord = corner === 1 || corner === 2 ? width : 0;
      const vCoord = corner >= 2 ? height : 0;
      const x = baseX + (axis.u === 0 ? uCoord : axis.v === 0 ? vCoord : 0);
      const y = baseY + (axis.u === 1 ? uCoord : axis.v === 1 ? vCoord : 0);
      const z = baseZ + (axis.u === 2 ? uCoord : axis.v === 2 ? vCoord : 0);
      const vy = face.smooth ? smoothHeight(x, y, z) : y;
      let vpx = x;
      let vpy = vy;
      let vpz = z;
      let vnx = axis.normal === 0 ? face.sign : 0;
      let vny = axis.normal === 1 ? face.sign : 0;
      let vnz = axis.normal === 2 ? face.sign : 0;
      if (face.leaf) {
        const r = roundLeafVertex(localBlock, x, y, z, vnx, vny, vnz, origin);
        vpx = r.x; vpy = r.y; vpz = r.z; vnx = r.nx; vny = r.ny; vnz = r.nz;
      }
      mesh.positions.push(vpx, vpy, vpz);
      mesh.normals.push(vnx, vny, vnz);
      mesh.uvs.push(face.leaf ? uCoord * 3 : uCoord, face.leaf ? vCoord * 3 : vCoord);
      let shade = face.ao0;
      if (face.sign > 0) {
        if (i === 1) shade = face.ao1;
        else if (i === 2) shade = face.ao2;
        else if (i === 3) shade = face.ao3;
      } else {
        if (i === 1) shade = face.ao3;
        else if (i === 2) shade = face.ao2;
        else if (i === 3) shade = face.ao1;
      }
      mesh.colors.push(shade, shade, shade);
    }
    if (face.smooth && axis.normal === 1 && face.sign > 0) {
      const p = mesh.positions;
      const o = vertexStart * 3;
      const sx = p[o + 3 * 2] - p[o];
      const sy = p[o + 3 * 2 + 1] - p[o + 1];
      const sz = p[o + 3 * 2 + 2] - p[o + 2];
      const tx = p[o + 3 * 3] - p[o + 3];
      const ty = p[o + 3 * 3 + 1] - p[o + 3 + 1];
      const tz = p[o + 3 * 3 + 2] - p[o + 3 + 2];
      let nx = sy * tz - sz * ty;
      let ny = sz * tx - sx * tz;
      let nz = sx * ty - sy * tx;
      const nl = Math.hypot(nx, ny, nz) || 1;
      nx /= nl; ny /= nl; nz /= nl;
      if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
      for (let i = 0; i < 4; i++) {
        mesh.normals[(vertexStart + i) * 3] = nx;
        mesh.normals[(vertexStart + i) * 3 + 1] = ny;
        mesh.normals[(vertexStart + i) * 3 + 2] = nz;
      }
    }
    mesh.indices.push(vertexStart, vertexStart + 1, vertexStart + 2, vertexStart, vertexStart + 2, vertexStart + 3);
  };
  for (const axis of AXES) {
    for (const sign of [-1, 1]) {
      for (let slice = 0; slice < CHUNK_SIZE; slice++) {
        const mask = new Array<Face | null>(CHUNK_SIZE * CHUNK_SIZE).fill(null);
        for (let v = 0; v < CHUNK_SIZE; v++) {
          for (let u = 0; u < CHUNK_SIZE; u++) {
            const px = axis.normal === 0 ? slice : axis.u === 0 ? u : v;
            const py = axis.normal === 1 ? slice : axis.u === 1 ? u : v;
            const pz = axis.normal === 2 ? slice : axis.u === 2 ? u : v;
            const blockId = localBlock(px, py, pz);
            if (blockId === 0) continue;
            const block = getBlockDef(blockId);
            const nx = px + (axis.normal === 0 ? sign : 0);
            const ny = py + (axis.normal === 1 ? sign : 0);
            const nz = pz + (axis.normal === 2 ? sign : 0);
            const neighborId = localBlock(nx, ny, nz);
            if (neighborId === blockId) continue;
            const neighborBlock = getBlockDef(neighborId);
            if (neighborBlock.solid && !neighborBlock.liquid && !block.liquid && neighborId !== 10) continue;
            const tileName = axis.normal === 1 ? (sign > 0 ? block.tiles.top : block.tiles.bottom) : block.tiles.side;
            if (!tileName) continue;
            const tile = input.atlas[tileName];
            if (!tile) throw new Error(`Missing atlas tile: ${tileName}`);
            let ao0 = 1;
            let ao1 = 1;
            let ao2 = 1;
            let ao3 = 1;
            for (let corner = 0; corner < 4; corner++) {
              const du = corner === 1 || corner === 2 ? 1 : -1;
              const dv = corner >= 2 ? 1 : -1;
              const side1 = getBlockDef(localBlock(nx + (axis.u === 0 ? du : 0), ny + (axis.u === 1 ? du : 0), nz + (axis.u === 2 ? du : 0))).solid;
              const side2 = getBlockDef(localBlock(nx + (axis.v === 0 ? dv : 0), ny + (axis.v === 1 ? dv : 0), nz + (axis.v === 2 ? dv : 0))).solid;
              const cornerBlocked = getBlockDef(localBlock(nx + (axis.u === 0 ? du : 0) + (axis.v === 0 ? dv : 0), ny + (axis.u === 1 ? du : 0) + (axis.v === 1 ? dv : 0), nz + (axis.u === 2 ? du : 0) + (axis.v === 2 ? dv : 0))).solid;
              const occlusion = side1 && side2 ? 3 : Number(side1) + Number(side2) + Number(cornerBlocked);
              const shade = 1 - occlusion * (0.55 / 3);
              if (corner === 0) ao0 = shade;
              else if (corner === 1) ao1 = shade;
              else if (corner === 2) ao2 = shade;
              else ao3 = shade;
            }
            const smoothBlock = blockId === 4 || blockId === 5 || blockId === 6;
            const leaf = blockId === 8;
            const key = `${blockId}:${tile.id}:${sign}:${ao0.toFixed(3)},${ao1.toFixed(3)},${ao2.toFixed(3)},${ao3.toFixed(3)}${smoothBlock || leaf ? `@${px},${py},${pz}` : ""}`;
            mask[u + CHUNK_SIZE * v] = { tile, sign, ao0, ao1, ao2, ao3, key, smooth: smoothBlock, leaf };
          }
        }
        for (let v = 0; v < CHUNK_SIZE; v++) {
          for (let u = 0; u < CHUNK_SIZE;) {
            const face = mask[u + CHUNK_SIZE * v];
            if (!face) {
              u++;
              continue;
            }
            let width = 1;
            while (u + width < CHUNK_SIZE && mask[u + width + CHUNK_SIZE * v]?.key === face.key) width++;
            let height = 1;
            let canGrow = true;
            while (v + height < CHUNK_SIZE && canGrow) {
              for (let offset = 0; offset < width; offset++) {
                if (mask[u + offset + CHUNK_SIZE * (v + height)]?.key !== face.key) {
                  canGrow = false;
                  break;
                }
              }
              if (canGrow) height++;
            }
            for (let dv = 0; dv < height; dv++) {
              for (let du = 0; du < width; du++) mask[u + du + CHUNK_SIZE * (v + dv)] = null;
            }
            addFace(face, axis, slice, u, v, width, height);
            u += width;
          }
        }
      }
    }
  }

  const tileIds = [...meshes.keys()].sort((a, b) => a - b);
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const groups: MeshGroup[] = [];
  for (const tile of tileIds) {
    const mesh = meshes.get(tile)!;
    const vertexOffset = positions.length / 3;
    const start = indices.length;
    positions.push(...mesh.positions);
    normals.push(...mesh.normals);
    uvs.push(...mesh.uvs);
    colors.push(...mesh.colors);
    for (const index of mesh.indices) indices.push(index + vertexOffset);
    groups.push({ tile, start, count: mesh.indices.length });
  }
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    uvs: new Float32Array(uvs),
    colors: new Float32Array(colors),
    indices: new Uint32Array(indices),
    groups,
  };
}
