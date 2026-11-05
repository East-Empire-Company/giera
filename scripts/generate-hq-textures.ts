import { mkdir, writeFile } from "node:fs/promises";
import sharp from "sharp";

const tiles = {
  hero_floor: { base: [25, 39, 70, 255], line: [48, 75, 118, 255], accent: [58, 225, 230, 255] },
  hero_wall: { base: [221, 230, 235, 255], line: [113, 139, 158, 255], accent: [34, 52, 86, 255] },
  hero_glass: { base: [60, 205, 225, 70], line: [175, 250, 255, 150], accent: [255, 255, 255, 190] },
  neon_block: { base: [22, 45, 58, 255], line: [35, 80, 88, 255], accent: [142, 255, 78, 255] },
} as const;

for (const [name, palette] of Object.entries(tiles)) {
  const pixels = Buffer.alloc(16 * 16 * 4);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const border = x === 0 || y === 0 || x === 15 || y === 15;
      const seam = x === 7 || y === 7;
      const bolt = (x === 2 || x === 13) && (y === 2 || y === 13);
      const color = bolt ? palette.accent : border || seam ? palette.line : palette.base;
      color.forEach((channel, i) => {
        pixels[(y * 16 + x) * 4 + i] = channel;
      });
    }
  }
  await mkdir("public/assets/textures/tiles", { recursive: true });
  const png = await sharp(pixels, { raw: { width: 16, height: 16, channels: 4 } }).png().toBuffer();
  await writeFile(`public/assets/textures/tiles/${name}.png`, png);
}
