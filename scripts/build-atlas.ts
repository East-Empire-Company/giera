import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import sharp from "sharp";
import assetManifest from "../src/shared/asset-manifest.json";

const ATLAS_WEBP_QUALITY = 92;

type TileSize = { name: string; width: number; height: number };
type Placement = TileSize & { x: number; y: number };
type PackedAtlas = { width: number; height: number; placements: Placement[] };

function nextPowerOfTwo(value: number): number {
  let result = 1;
  while (result < value) result *= 2;
  return result;
}

export function packTiles(images: TileSize[], maxWidth = 512): PackedAtlas {
  if (!Number.isInteger(maxWidth) || maxWidth < 1) throw new RangeError("Atlas width must be a positive integer");
  const names = new Set<string>();
  let totalArea = 0;
  let largestWidth = 1;
  for (const image of images) {
    if (!image.name || names.has(image.name) || !Number.isInteger(image.width) || !Number.isInteger(image.height) || image.width < 1 || image.height < 1) {
      throw new RangeError(`Invalid or duplicate tile: ${image.name}`);
    }
    names.add(image.name);
    totalArea += image.width * image.height;
    largestWidth = Math.max(largestWidth, image.width);
  }
  const width = Math.min(maxWidth, nextPowerOfTwo(Math.max(largestWidth, Math.ceil(Math.sqrt(totalArea)))));
  if (largestWidth > maxWidth) throw new RangeError("Image exceeds atlas width");
  const ordered = [...images].sort((a, b) => b.height - a.height || b.width - a.width || a.name.localeCompare(b.name));
  const placements: Placement[] = [];
  let x = 0;
  let y = 0;
  let rowHeight = 0;
  let usedWidth = 0;
  for (const image of ordered) {
    if (image.width > width) throw new RangeError("Image exceeds atlas width");
    if (x + image.width > width) {
      y += rowHeight;
      x = 0;
      rowHeight = 0;
    }
    placements.push({ ...image, x, y });
    x += image.width;
    usedWidth = Math.max(usedWidth, x);
    rowHeight = Math.max(rowHeight, image.height);
  }
  return { width: nextPowerOfTwo(usedWidth || 1), height: nextPowerOfTwo(y + rowHeight || 1), placements };
}

type AtlasImage = { path: string; x: number; y: number };

export async function composeAtlas(images: AtlasImage[], width: number, height: number): Promise<Buffer> {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) throw new RangeError("Atlas dimensions must be positive integers");
  for (const image of images) {
    if (!Number.isInteger(image.x) || !Number.isInteger(image.y) || image.x < 0 || image.y < 0) throw new RangeError("Atlas offsets must be non-negative integers");
  }
  const overlays = images.map((image) => ({ input: image.path, left: image.x, top: image.y }));
  return sharp({ create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(overlays)
    .png({ compressionLevel: 9 })
    .toBuffer();
}

const PBR_SOURCES: Record<string, string | null> = {
  grass_top: "Grass001",
  grass_side: "Ground020",
  dirt: "Ground020",
  stone: "Rock064",
  cobblestone: "Rock058",
  sand: "Ground080",
  oak_log_side: "Bark001",
  oak_log_top: null,
  ginkgo_leaves: "ScatteredLeaves009",
  oak_planks: "Planks010",
  default_mineral_coal: "Rock064",
  default_mineral_iron: "Rock064",
  default_mineral_gold: "Rock064",
  asphalt: "Asphalt033",
  paving: "PavingStones151",
  brick: "Bricks097",
  plaster: "Plaster001",
  roof_tile: "RoofingTiles013A",
  tnt: "tnt",
  glass: null,
  water: null,
};

const GUTTER = 8;
const GRID_COLUMNS = 4;
const MAX_TILES = 24;

export function atlasGridDimensions(tileCount: number, resolution: number, gutter: number): {
  columns: number;
  rows: number;
  cell: number;
  width: number;
  height: number;
} {
  if (!Number.isInteger(tileCount) || tileCount < 0 || tileCount > MAX_TILES) throw new RangeError(`Tile count exceeds ${GRID_COLUMNS}x${Math.ceil(MAX_TILES / GRID_COLUMNS)} grid`);
  if (!Number.isInteger(resolution) || resolution < 1 || !Number.isInteger(gutter) || gutter < 0) {
    throw new RangeError("Atlas resolution and gutter must be valid integers");
  }
  const columns = GRID_COLUMNS;
  const rows = Math.max(1, Math.ceil(tileCount / columns));
  const cell = resolution + 2 * gutter;
  return { columns, rows, cell, width: columns * cell, height: rows * cell };
}

type TileMaps = { albedo: Buffer; normal: Buffer; orm: Buffer };

function pbrPath(id: string, map: string): string {
  return resolve("public/assets/textures/pbr", id, `${id}_1K-JPG_${map}.jpg`);
}

async function loadTileMaps(name: string, tilePath: string, res: number): Promise<TileMaps> {
  const sourceId = PBR_SOURCES[name];
  if (sourceId === undefined) throw new Error(`No PBR source mapping for tile: ${name}`);
  if (sourceId === null) {
    const legacy = await sharp(resolve("public", tilePath)).resize(res, res, { kernel: "nearest" }).png().toBuffer();
    const flatNormal = Buffer.alloc(res * res * 4, Buffer.from([128, 128, 255, 255]));
    const neutralOrm = Buffer.alloc(res * res * 4);
    for (let i = 0; i < res * res; i++) {
      neutralOrm[i * 4] = 255;
      neutralOrm[i * 4 + 1] = 230;
    }
    const normal = sharp(flatNormal, { raw: { width: res, height: res, channels: 4 } }).png().toBuffer();
    const orm = sharp(neutralOrm, { raw: { width: res, height: res, channels: 4 } }).png().toBuffer();
    return { albedo: legacy, normal: await normal, orm: await orm };
  }
  for (const map of ["Color", "NormalGL", "Roughness"]) {
    if (!existsSync(pbrPath(sourceId, map))) throw new Error(`Missing PBR map for ${name}: ${pbrPath(sourceId, map)} (run bun run assets:fetch)`);
  }
  const resize = { width: res, height: res };
  const albedo = sharp(pbrPath(sourceId, "Color")).resize(resize).png().toBuffer();
  const normal = sharp(pbrPath(sourceId, "NormalGL")).resize(resize).png().toBuffer();
  const aoPath = pbrPath(sourceId, "AmbientOcclusion");
  const [aoRaw, roughRaw] = await Promise.all([
    existsSync(aoPath)
      ? sharp(aoPath).resize(resize).extractChannel(0).raw().toBuffer()
      : Buffer.alloc(res * res, 255),
    sharp(pbrPath(sourceId, "Roughness")).resize(resize).extractChannel(0).raw().toBuffer(),
  ]);
  const ormRaw = Buffer.alloc(res * res * 4);
  for (let i = 0; i < res * res; i++) {
    ormRaw[i * 4] = aoRaw[i];
    ormRaw[i * 4 + 1] = roughRaw[i];
    ormRaw[i * 4 + 2] = 0;
    ormRaw[i * 4 + 3] = 255;
  }
  const orm = sharp(ormRaw, { raw: { width: res, height: res, channels: 4 } }).png().toBuffer();
  return { albedo: await albedo, normal: await normal, orm: await orm };
}


async function addGutter(tile: Buffer, res: number): Promise<Buffer> {
  const g = GUTTER;
  const cell = res + 2 * g;
  const edge = async (left: number, top: number, width: number, height: number): Promise<{ input: Buffer; left: number; top: number }> => ({
    input: await sharp(tile).extract({ left, top, width, height }).toBuffer(),
    left,
    top,
  });
  const edgeMappings: Array<[number, number, number, number, number, number]> = [
    [res - g, 0, g, res, 0, g],
    [0, 0, g, res, res + g, g],
    [0, res - g, res, g, g, 0],
    [0, 0, res, g, g, res + g],
    [res - g, res - g, g, g, 0, 0],
    [0, res - g, g, g, res + g, 0],
    [res - g, 0, g, g, 0, res + g],
    [0, 0, g, g, res + g, res + g],
  ];
  const overlays: Array<{ input: Buffer; left: number; top: number }> = [{ input: tile, left: g, top: g }];
  for (const [sl, st, sw, sh, dl, dt] of edgeMappings) {
    const piece = await edge(sl, st, sw, sh);
    overlays.push({ input: piece.input, left: dl, top: dt });
  }
  return sharp({ create: { width: cell, height: cell, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } } })
    .composite(overlays)
    .png()
    .toBuffer();
}

async function main(): Promise<void> {
  const resIndex = process.argv.indexOf("--res");
  const res = resIndex >= 0 ? Number(process.argv[resIndex + 1]) : 512;
  if (![256, 512].includes(res)) throw new RangeError("Unsupported --res (use 256 or 512)");
  const { columns, rows, cell, width: atlasWidth, height: atlasHeight } = atlasGridDimensions(Object.keys(assetManifest.tiles).length, res, GUTTER);
  const entries = Object.entries(assetManifest.tiles).sort(([a], [b]) => a.localeCompare(b));

  const albedoCells: Array<{ input: Buffer; left: number; top: number }> = [];
  const normalCells: Array<{ input: Buffer; left: number; top: number }> = [];
  const ormCells: Array<{ input: Buffer; left: number; top: number }> = [];
  const tiles: Record<string, { id: number; uv: [number, number, number, number]; normalRect: [number, number, number, number]; ormRect: [number, number, number, number]; path: string }> = {};
  for (const [id, [name, tilePath]] of entries.entries()) {
    const maps = await loadTileMaps(name, tilePath, res);
    const cx = (id % columns) * cell;
    const cy = Math.floor(id / columns) * cell;
    albedoCells.push({ input: await addGutter(maps.albedo, res), left: cx, top: cy });
    normalCells.push({ input: await addGutter(maps.normal, res), left: cx, top: cy });
    ormCells.push({ input: await addGutter(maps.orm, res), left: cx, top: cy });
    const u0 = (cx + GUTTER + 0.5) / atlasWidth;
    const u1 = (cx + cell - GUTTER - 0.5) / atlasWidth;
    const v0 = 1 - (cy + cell - GUTTER - 0.5) / atlasHeight;
    const v1 = 1 - (cy + GUTTER + 0.5) / atlasHeight;
    tiles[name] = { id, uv: [u0, v0, u1, v1], normalRect: [u0, v0, u1, v1], ormRect: [u0, v0, u1, v1], path: tilePath };
  }

  const compose = async (cells: typeof albedoCells, lossless = false): Promise<Buffer> =>
    sharp({ create: { width: atlasWidth, height: atlasHeight, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } } })
      .composite(cells)
      .webp(lossless ? { lossless: true, effort: 6 } : { quality: ATLAS_WEBP_QUALITY, alphaQuality: 100, effort: 6 })
      .toBuffer();
  const [albedoWebp, normalWebp, ormWebp] = await Promise.all([
    compose(albedoCells),
    compose(normalCells, true),
    compose(ormCells),
  ]);
  const atlasPath = resolve("public/assets/textures/atlas.webp");
  await writeFile(atlasPath, albedoWebp);
  await writeFile(resolve("public/assets/textures/atlas-normal.webp"), normalWebp);
  await writeFile(resolve("public/assets/textures/atlas-orm.webp"), ormWebp);
  const atlasManifest = { width: atlasWidth, height: atlasHeight, tileRes: res, gutter: GUTTER, tiles };
  await writeFile(resolve("src/shared/atlas-manifest.json"), `${JSON.stringify(atlasManifest, null, 2)}\n`);
  console.log(`Packed ${entries.length} tiles into 3 atlases at ${dirname(atlasPath)} (${atlasWidth}x${atlasHeight}, ${columns}x${rows}, res ${res}).`);
}

if (import.meta.main) await main();
