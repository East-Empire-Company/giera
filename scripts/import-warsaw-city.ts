import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { decodeWarsawTile, mapWarsawPalette, type WarsawPaletteEntry, type WarsawTileData } from "../src/shared/warsaw-city-data";

const SOURCE_WIDTH = 96;
const SOURCE_DEPTH = 96;
const CROP_X = 619;
const CROP_Y = 2468;
const WORLD_X = -80;
const WORLD_Z = -112;
const VERTICAL_OFFSET = 17;
const TILE_XS = [4, 5];
const TILE_YS = [19, 20];
const TILE_LEVELS = ["1", "1f"] as const;
const MAX_GENERATED_BYTES = 300 * 1024;
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = "web/public/data/meta.json";
const revisionPattern = /^[a-f0-9]{40}$/;

type SourceMeta = {
  W: number;
  H: number;
  D: number;
  base: number;
  crs: string;
  sources: Record<string, string>;
  tiles: { N: number };
  palette: WarsawPaletteEntry[];
};

type TileFile = {
  level: string;
  x: number;
  y: number;
  path: string;
  gitBlob: string;
  sha256: string;
};

type SourceRun = { z: number; length: number; paletteIndex: number };

function gitText(sourceRoot: string, args: string[]): string {
  return execFileSync("git", ["-C", sourceRoot, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function githubRawUrl(sourceRoot: string, revision: string, path: string): string {
  const remote = gitText(sourceRoot, ["remote", "get-url", "origin"]);
  const normalized = remote.replace(/^git@github\.com:/, "https://github.com/").replace(/\.git$/, "");
  const url = new URL(normalized);
  if (url.hostname !== "github.com") throw new Error(`Cannot fetch missing source blob from GitHub origin: ${remote}`);
  const repo = url.pathname.split("/").filter(Boolean);
  if (repo.length !== 2) throw new Error(`Invalid source GitHub origin: ${remote}`);
  return `https://raw.githubusercontent.com/${repo.join("/")}/${revision}/${path}`;
}

async function readPinnedBlob(sourceRoot: string, revision: string, path: string): Promise<{ bytes: Buffer; gitBlob: string }> {
  const gitBlob = gitText(sourceRoot, ["rev-parse", "--verify", `${revision}:${path}`]);
  let bytes: Buffer;
  try {
    bytes = execFileSync("git", ["-C", sourceRoot, "show", `${revision}:${path}`], { maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
  } catch {
    const response = await fetch(githubRawUrl(sourceRoot, revision, path));
    if (!response.ok) throw new Error(`Cannot fetch pinned source blob ${path}: HTTP ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
  }
  const actualBlob = execFileSync("git", ["-C", sourceRoot, "hash-object", "--stdin"], {
    input: bytes,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
  if (actualBlob !== gitBlob) throw new Error(`Pinned source blob mismatch for ${path}: expected ${gitBlob}, got ${actualBlob}`);
  return { bytes, gitBlob };
}

function parseArguments(argv: string[]): { sourceRoot: string; sourceRevision: string } {
  const args = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 2) {
    const name = argv[i];
    const value = argv[i + 1];
    if ((name !== "--source-root" && name !== "--source-revision") || !value || args.has(name)) {
      throw new Error("Usage: bun run scripts/import-warsaw-city.ts --source-root PATH --source-revision SHA");
    }
    args.set(name, value);
  }
  const sourceRoot = args.get("--source-root");
  const sourceRevision = args.get("--source-revision");
  if (!sourceRoot || !sourceRevision || !revisionPattern.test(sourceRevision)) {
    throw new Error("Both --source-root and a full 40-character --source-revision are required");
  }
  return { sourceRoot: resolve(sourceRoot), sourceRevision };
}

function writeVarint(bytes: number[], value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`Invalid Warsaw data integer: ${value}`);
  while (value >= 128) {
    bytes.push((value & 0x7f) | 0x80);
    value = Math.floor(value / 128);
  }
  bytes.push(value);
}

function tileRunOffsets(tile: WarsawTileData): Uint32Array {
  const offsets = new Uint32Array(tile.counts.length + 1);
  for (let i = 0; i < tile.counts.length; i++) offsets[i + 1] = offsets[i] + tile.counts[i] * 3;
  return offsets;
}

function mapTileColumn(tile: WarsawTileData, offsets: Uint32Array, N: number, x: number, y: number): { ground: number; runs: SourceRun[] } {
  const side = N + 2;
  const tileIndex = (y + 1) * side + x + 1;
  const runOffset = offsets[tileIndex];
  const runs: SourceRun[] = [];
  for (let i = 0; i < tile.counts[tileIndex]; i++) {
    const offset = runOffset + i * 3;
    runs.push({ z: tile.runs[offset], length: tile.runs[offset + 1], paletteIndex: tile.runs[offset + 2] });
  }
  return { ground: tile.ground[tileIndex], runs };
}

function tileFileInfo(path: string, level: string, x: number, y: number, gitBlob: string, bytes: Buffer): TileFile {
  return { level, x, y, path, gitBlob, sha256: createHash("sha256").update(bytes).digest("hex") };
}

function median(values: number[]): number {
  values.sort((a, b) => a - b);
  const middle = values.length >> 1;
  return values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
}

async function importCity(sourceRoot: string, sourceRevision: string): Promise<void> {
  if (!existsSync(sourceRoot)) throw new Error(`Source Git repository does not exist: ${sourceRoot}`);
  const resolvedRevision = gitText(sourceRoot, ["rev-parse", "--verify", `${sourceRevision}^{commit}`]);
  if (resolvedRevision !== sourceRevision) throw new Error(`Source revision did not resolve exactly: ${sourceRevision}`);

  const metaBlob = await readPinnedBlob(sourceRoot, sourceRevision, sourcePath);
  const meta = JSON.parse(metaBlob.bytes.toString("utf8")) as SourceMeta;
  const N = meta.tiles?.N;
  if (N !== 128 || !Array.isArray(meta.palette) || meta.palette.length === 0) throw new Error("Pinned source metadata has an unsupported tile or palette shape");

  const tileFiles: TileFile[] = [];
  const columns = Array.from({ length: SOURCE_WIDTH * SOURCE_DEPTH }, () => [] as SourceRun[]);
  const ground = new Uint8Array(SOURCE_WIDTH * SOURCE_DEPTH);
  const usage = new Uint32Array(meta.palette.length);
  let groundColumnCount = 0;
  let maxSolid = -1;

  for (const level of TILE_LEVELS) {
    for (const ty of TILE_YS) {
      for (const tx of TILE_XS) {
        const path = `web/public/data/tiles/${level}/${tx}_${ty}.bin`;
        const raw = await readPinnedBlob(sourceRoot, sourceRevision, path);
        tileFiles.push(tileFileInfo(path, level, tx, ty, raw.gitBlob, raw.bytes));
        const tile = decodeWarsawTile(gunzipSync(raw.bytes), N);
        const tileOffsets = tileRunOffsets(tile);
        const sourceX0 = tx * N;
        const sourceY0 = ty * N;
        for (let sourceY = Math.max(CROP_Y, sourceY0); sourceY <= Math.min(CROP_Y + SOURCE_DEPTH - 1, sourceY0 + N - 1); sourceY++) {
          for (let sourceX = Math.max(CROP_X, sourceX0); sourceX <= Math.min(CROP_X + SOURCE_WIDTH - 1, sourceX0 + N - 1); sourceX++) {
            const localX = sourceX - CROP_X;
            const localZ = sourceY - CROP_Y;
            const flatIndex = localZ * SOURCE_WIDTH + localX;
            const column = mapTileColumn(tile, tileOffsets, N, sourceX - sourceX0, sourceY - sourceY0);
            if (level === "1") {
              ground[flatIndex] = column.ground;
              groundColumnCount++;
            }
            for (const run of column.runs) {
              if (run.length === 0 || run.paletteIndex >= meta.palette.length || run.z + run.length > meta.H) {
                throw new Error(`Invalid source run in ${path} at (${sourceX}, ${sourceY})`);
              }
              columns[flatIndex].push(run);
              usage[run.paletteIndex] += run.length;
              maxSolid = Math.max(maxSolid, run.z + run.length - 1);
            }
          }
        }
      }
    }
  }

  if (groundColumnCount !== ground.length || ground.some((value) => value === 0)) throw new Error("Pinned crop does not contain ground data for every column");
  const groundTops = Array.from(ground, (value) => value - 1);
  const minimumGroundTop = Math.min(...groundTops);
  const medianGroundTop = median(groundTops);
  if (minimumGroundTop !== 41 || medianGroundTop !== 43 || maxSolid !== 70) {
    throw new Error(`Pinned crop measurements changed: ground ${minimumGroundTop}/${medianGroundTop}, top solid ${maxSolid}`);
  }

  const mapping = mapWarsawPalette(meta.palette, usage);
  const packed: number[] = [];
  for (let index = 0; index < columns.length; index++) {
    const runs = columns[index].sort((a, b) => a.z - b.z || a.paletteIndex - b.paletteIndex);
    writeVarint(packed, ground[index]);
    writeVarint(packed, runs.length);
    let previousEnd = -1;
    for (const run of runs) {
      if (run.z < previousEnd) throw new Error(`Overlapping source layers at crop column ${index}`);
      writeVarint(packed, run.z);
      writeVarint(packed, run.length);
      writeVarint(packed, run.paletteIndex);
      previousEnd = run.z + run.length;
    }
  }

  const packedBase64 = Buffer.from(packed).toString("base64");
  const wrappedBase64 = packedBase64.match(/.{1,120}/g)?.join("\n") ?? "";
  const mappingBlockIds = JSON.stringify(Array.from(mapping.blockIds));
  const mappingTintIds = JSON.stringify(Array.from(mapping.tintIds));
  const tintPalettes = JSON.stringify(mapping.tintPalettes);
  const generated = [
    `export const WARSAW_CITY_SOURCE_REVISION = ${JSON.stringify(sourceRevision)};`,
    `export const WARSAW_CITY_WIDTH = ${SOURCE_WIDTH};`,
    `export const WARSAW_CITY_DEPTH = ${SOURCE_DEPTH};`,
    `export const WARSAW_CITY_WORLD_X = ${WORLD_X};`,
    `export const WARSAW_CITY_WORLD_Z = ${WORLD_Z};`,
    `export const WARSAW_CITY_VERTICAL_OFFSET = ${VERTICAL_OFFSET};`,
    `export const WARSAW_CITY_SOURCE_GROUND_MIN = ${minimumGroundTop};`,
    `export const WARSAW_CITY_SOURCE_GROUND_MEDIAN = ${medianGroundTop};`,
    `export const WARSAW_CITY_SOURCE_MAX_SOLID = ${maxSolid};`,
    `export const WARSAW_CITY_PALETTE_BLOCK_IDS = Uint8Array.from(${mappingBlockIds});`,
    `export const WARSAW_CITY_PALETTE_TINT_IDS = Uint8Array.from(${mappingTintIds});`,
    `export const WARSAW_CITY_TINT_PALETTES = ${tintPalettes} as const;`,
    `export const WARSAW_CITY_PACKED_DATA = \`${wrappedBase64}\`;`,
    "",
  ].join("\n");
  const generatedBytes = Buffer.byteLength(generated, "utf8");
  if (generatedBytes > MAX_GENERATED_BYTES) throw new Error(`Generated city data exceeds 300 KiB: ${generatedBytes} bytes`);

  const palette = meta.palette.map(([red, green, blue, materialId], index) => ({
    index,
    rgb: [red, green, blue],
    materialId,
    blockId: mapping.blockIds[index],
    tintId: mapping.tintIds[index],
    voxelCount: usage[index],
  }));
  const manifest = {
    source: {
      repository: "https://github.com/stared/warsaw-vibe-voxel",
      revision: sourceRevision,
      sourceBaseMeters: meta.base,
      sourceCrs: meta.crs,
      metadataSha256: createHash("sha256").update(metaBlob.bytes).digest("hex"),
      sources: meta.sources,
      layerSemantics: {
        "1": "Base buildings and ground; grass is replaced with bare earth, trees and trunks are omitted.",
        "1f": "Foliage layer containing foliage, trunks, and grass.",
      },
      tiles: tileFiles,
    },
    crop: {
      sourceX: CROP_X,
      sourceY: CROP_Y,
      width: SOURCE_WIDTH,
      depth: SOURCE_DEPTH,
      tileN: N,
      tileXs: TILE_XS,
      tileYs: TILE_YS,
      sourceGroundTopMin: minimumGroundTop,
      sourceGroundTopMedian: medianGroundTop,
      sourceMaxSolid: maxSolid,
      verticalOffset: VERTICAL_OFFSET,
      worldX: WORLD_X,
      worldZ: WORLD_Z,
      connector: { sourceStreetX: [703, 706], sourceStreetY: 2563, worldX: [4, 7], worldZ: -17, groundTop: 43, worldTop: 60 },
    },
    data: { generatedBytes, packedBytes: packed.length, packedBase64Bytes: Buffer.byteLength(packedBase64, "utf8") },
    palette,
    tintPalettes: mapping.tintPalettes,
    licenses: {
      sourceCode: { license: "MIT", copyright: "Copyright (c) 2026 Piotr Migdał", notice: "Source repository code license only; no source application code is copied." },
      openStreetMap: { license: "ODbL 1.0", attribution: "© OpenStreetMap contributors", url: "https://www.openstreetmap.org/copyright" },
      gugik: { attribution: "GUGiK NMPT/NMT 2025 and 2025 orthophotomap", terms: "Open data, reusable under Article 40a of the Polish Geodetic and Cartographic Law." },
    },
  };

  const generatedPath = resolve(projectRoot, "src/shared/warsaw-city-data.generated.ts");
  const manifestPath = resolve(projectRoot, "src/shared/warsaw-city-manifest.json");
  mkdirSync(dirname(generatedPath), { recursive: true });
  writeFileSync(generatedPath, generated);
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Generated ${generatedBytes} bytes from ${tileFiles.length} verified tiles; crop ${SOURCE_WIDTH}x${SOURCE_DEPTH}, ground ${minimumGroundTop}/${medianGroundTop}, highest solid ${maxSolid}.`);
}

try {
  const { sourceRoot, sourceRevision } = parseArguments(process.argv.slice(2));
  await importCity(sourceRoot, sourceRevision);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
