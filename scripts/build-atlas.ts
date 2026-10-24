import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import sharp from "sharp";
import assetManifest from "../src/shared/asset-manifest.json";

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

async function main(): Promise<void> {
  const tileFiles = Object.entries(assetManifest.tiles);
  const sizes: TileSize[] = [];
  for (const [name, path] of tileFiles) {
    const metadata = await sharp(resolve("public", path)).metadata();
    if (!metadata.width || !metadata.height || metadata.format !== "png") throw new Error(`Expected PNG tile: ${path}`);
    sizes.push({ name, width: metadata.width, height: metadata.height });
  }
  const packed = packTiles(sizes);
  const images = packed.placements.map((placement) => ({
    path: resolve("public", assetManifest.tiles[placement.name as keyof typeof assetManifest.tiles]),
    x: placement.x,
    y: placement.y,
  }));
  const atlasPath = resolve("public/assets/textures/atlas.png");
  await writeFile(atlasPath, await composeAtlas(images, packed.width, packed.height));
  const tiles: Record<string, { id: number; uv: [number, number, number, number]; path: string }> = {};
  for (const [id, placement] of packed.placements.entries()) {
    const u0 = (placement.x + 0.5) / packed.width;
    const u1 = (placement.x + placement.width - 0.5) / packed.width;
    const v0 = 1 - (placement.y + placement.height - 0.5) / packed.height;
    const v1 = 1 - (placement.y + 0.5) / packed.height;
    tiles[placement.name] = {
      id,
      uv: [u0, v0, u1, v1],
      path: assetManifest.tiles[placement.name as keyof typeof assetManifest.tiles],
    };
  }
  const atlasManifest = { width: packed.width, height: packed.height, tiles };
  const manifestPath = resolve("src/shared/atlas-manifest.json");
  await writeFile(manifestPath, `${JSON.stringify(atlasManifest, null, 2)}\n`);
  console.log(`Packed ${packed.placements.length} downloaded tiles into ${dirname(atlasPath)}/atlas.png (${packed.width}x${packed.height}).`);
}

if (import.meta.main) await main();
