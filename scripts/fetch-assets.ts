import { execFileSync } from "node:child_process";
import { copyFile, mkdir, readdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

const kenneySlugs = ["voxel-pack", "blocky-characters", "ui-pack", "particle-pack"];
const directArchives = [
  { name: "aroach-block-textures", url: "https://opengameart.org/sites/default/files/blocks_2.zip" },
  { name: "aroach-foliage-textures", url: "https://opengameart.org/sites/default/files/blocks_0.zip" },
  { name: "joeenderman-textures-1", url: "https://opengameart.org/sites/default/files/assorted_textures_1.zip" },
  { name: "joeenderman-textures-2", url: "https://opengameart.org/sites/default/files/assorted_textures_2.zip" },
  { name: "ambientcg-ice-normal", url: "https://ambientcg.com/get?file=Ice001_1K-JPG.zip" },
];
const cacheRoot = resolve(".cache/assets");
const publicRoot = resolve("public/assets");
type AssetSourceId = "kenney-voxel-pack" | "kenney-blocky-characters" | "kenney-ui-pack" | "kenney-particle-pack" | "aroach-block-textures" | "aroach-foliage-textures" | "joeenderman-textures-1" | "joeenderman-textures-2" | "ambientcg-ice-normal";
type AssetPick = { source: AssetSourceId; member: string; path: string };

const sourceInfo: Record<AssetSourceId, { title: string; author: string; license: string; url: string }> = {
  "kenney-voxel-pack": { title: "Voxel Pack", author: "Kenney", license: "CC0", url: "https://kenney.nl/assets/voxel-pack" },
  "kenney-blocky-characters": { title: "Blocky Characters v2", author: "Kenney", license: "CC0", url: "https://kenney.nl/assets/blocky-characters" },
  "kenney-ui-pack": { title: "UI Pack", author: "Kenney", license: "CC0", url: "https://kenney.nl/assets/ui-pack" },
  "kenney-particle-pack": { title: "Particle Pack", author: "Kenney", license: "CC0", url: "https://kenney.nl/assets/particle-pack" },
  "aroach-block-textures": { title: "16x16 Block Texture Set", author: "ARoachIFoundOnMyPillow", license: "CC0", url: "https://opengameart.org/content/16x16-block-texture-set" },
  "aroach-foliage-textures": { title: "16*16 Block Textures", author: "ARoachIFoundOnMyPillow", license: "CC0", url: "https://opengameart.org/content/1616-block-textures" },
  "joeenderman-textures-1": { title: "Assorted Minecraft style textures", author: "JoeEnderman", license: "CC0", url: "https://opengameart.org/content/assorted-minecraft-style-textures" },
  "joeenderman-textures-2": { title: "Assorted Minecraft style textures", author: "JoeEnderman", license: "CC0", url: "https://opengameart.org/content/assorted-minecraft-style-textures" },
  "ambientcg-ice-normal": { title: "Ice 001 NormalGL", author: "ambientCG", license: "CC0 / Public Domain", url: "https://ambientcg.com/view?id=Ice001" },
};

const assetPicks: Record<string, Record<string, AssetPick>> = {
  tiles: {
    stone: { source: "aroach-block-textures", member: "blocks/stone_generic.png", path: "assets/textures/tiles/stone.png" },
    cobblestone: { source: "aroach-block-textures", member: "blocks/cobblestone.png", path: "assets/textures/tiles/cobblestone.png" },
    dirt: { source: "aroach-block-textures", member: "blocks/dirt.png", path: "assets/textures/tiles/dirt.png" },
    grass_top: { source: "aroach-block-textures", member: "blocks/grass_top.png", path: "assets/textures/tiles/grass_top.png" },
    grass_side: { source: "aroach-block-textures", member: "blocks/grass_side.png", path: "assets/textures/tiles/grass_side.png" },
    sand: { source: "aroach-block-textures", member: "blocks/sand_ugly.png", path: "assets/textures/tiles/sand.png" },
    oak_log_top: { source: "aroach-block-textures", member: "blocks/oak_log_top.png", path: "assets/textures/tiles/oak_log_top.png" },
    oak_log_side: { source: "aroach-block-textures", member: "blocks/oak_log_side.png", path: "assets/textures/tiles/oak_log_side.png" },
    ginkgo_leaves: { source: "aroach-foliage-textures", member: "blocks/ginkgo_leaves.png", path: "assets/textures/tiles/ginkgo_leaves.png" },
    oak_planks: { source: "aroach-block-textures", member: "blocks/oak_planks.png", path: "assets/textures/tiles/oak_planks.png" },
    glass: { source: "aroach-block-textures", member: "blocks/glass.png", path: "assets/textures/tiles/glass.png" },
    water: { source: "kenney-voxel-pack", member: "PNG/Tiles/water.png", path: "assets/textures/tiles/water.png" },
    default_mineral_coal: { source: "joeenderman-textures-1", member: "default_mineral_coal.png", path: "assets/textures/tiles/default_mineral_coal.png" },
    default_mineral_iron: { source: "joeenderman-textures-1", member: "default_mineral_iron.png", path: "assets/textures/tiles/default_mineral_iron.png" },
    default_mineral_gold: { source: "joeenderman-textures-1", member: "default_mineral_gold.png", path: "assets/textures/tiles/default_mineral_gold.png" },
  },
  models: {
    playerOne: { source: "kenney-blocky-characters", member: "Models/GLB format/character-a.glb", path: "assets/models/character-a.meshopt.glb" },
    playerTwo: { source: "kenney-blocky-characters", member: "Models/GLB format/character-b.glb", path: "assets/models/character-b.meshopt.glb" },
  },
  sky: {
    clouds: { source: "kenney-voxel-pack", member: "PNG/Other/clouds.png", path: "assets/sky/clouds.png" },
    sideClouds: { source: "kenney-voxel-pack", member: "PNG/Other/skybox_sideClouds.png", path: "assets/sky/skybox_sideClouds.png" },
  },
  particles: {
    dirt01: { source: "kenney-particle-pack", member: "PNG (Transparent)/dirt_01.png", path: "assets/particles/dirt_01.png" },
    dirt02: { source: "kenney-particle-pack", member: "PNG (Transparent)/dirt_02.png", path: "assets/particles/dirt_02.png" },
    spark01: { source: "kenney-particle-pack", member: "PNG (Transparent)/spark_01.png", path: "assets/particles/spark_01.png" },
    smoke01: { source: "kenney-particle-pack", member: "PNG (Transparent)/smoke_01.png", path: "assets/particles/smoke_01.png" },
    star01: { source: "kenney-particle-pack", member: "PNG (Transparent)/star_01.png", path: "assets/particles/star_01.png" },
  },
  ui: {
    button: { source: "kenney-ui-pack", member: "PNG/Green/Default/button_rectangle_depth_gradient.png", path: "assets/ui/kenney/button_rectangle_depth_gradient.png" },
    roundButton: { source: "kenney-ui-pack", member: "PNG/Green/Default/button_round_depth_line.png", path: "assets/ui/kenney/button_round_depth_line.png" },
    squareButton: { source: "kenney-ui-pack", member: "PNG/Green/Default/button_square_depth_line.png", path: "assets/ui/kenney/button_square_depth_line.png" },
    checkmark: { source: "kenney-ui-pack", member: "PNG/Green/Default/check_square_color_checkmark.png", path: "assets/ui/kenney/check_square_color_checkmark.png" },
    star: { source: "kenney-ui-pack", member: "PNG/Green/Default/star.png", path: "assets/ui/kenney/star.png" },
  },
  icons: {
    axe: { source: "kenney-voxel-pack", member: "PNG/Items/axe_iron.png", path: "assets/ui/icons/axe_iron.png" },
    pickaxe: { source: "kenney-voxel-pack", member: "PNG/Items/pick_iron.png", path: "assets/ui/icons/pick_iron.png" },
    coal: { source: "kenney-voxel-pack", member: "PNG/Items/ore_coal.png", path: "assets/ui/icons/ore_coal.png" },
    iron: { source: "kenney-voxel-pack", member: "PNG/Items/ore_iron.png", path: "assets/ui/icons/ore_iron.png" },
    gold: { source: "kenney-voxel-pack", member: "PNG/Items/ore_gold.png", path: "assets/ui/icons/ore_gold.png" },
  },
  normalMaps: {
    water: { source: "ambientcg-ice-normal", member: "Ice001_1K-JPG_NormalGL.jpg", path: "assets/textures/water-normal.jpg" },
  },
};

export function resolveKenneyZipUrl(slug: string, html: string): string {
  if (!/^[a-z0-9-]+$/.test(slug)) throw new RangeError("Invalid Kenney asset slug");
  const links = html.matchAll(/href=["']([^"']+\.zip(?:\?[^"']*)?)["']/gi);
  for (const match of links) {
    const url = new URL(match[1], `https://kenney.nl/assets/${slug}`);
    if (url.hostname === "kenney.nl" && url.pathname.startsWith(`/media/pages/assets/${slug}/`) && url.pathname.toLowerCase().endsWith(".zip")) return url.href;
  }
  throw new Error(`Kenney ZIP not found for ${slug}`);
}

async function download(url: string, path: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed (${response.status}): ${url}`);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, Buffer.from(await response.arrayBuffer()));
}

function extractArchive(archive: string, target: string): void {
  const members = execFileSync("unzip", ["-Z1", archive], { encoding: "utf8" }).split(/\r?\n/).filter(Boolean);
  for (const member of members) {
    const normalized = member.replaceAll("\\", "/");
    const segments = normalized.split("/");
    if (isAbsolute(normalized) || /^[a-z]:\//i.test(normalized) || segments.includes("..") || normalized.startsWith("/")) throw new Error(`Unsafe archive member: ${member}`);
    const destination = resolve(target, normalized);
    const rel = relative(target, destination);
    if (rel.startsWith(`..${sep}`) || rel === "..") throw new Error(`Unsafe archive member: ${member}`);
  }
  execFileSync("unzip", ["-o", "-qq", archive, "-d", target], { stdio: "inherit" });
}

async function fetchKenneyPack(slug: string): Promise<void> {
  const pageUrl = `https://kenney.nl/assets/${slug}`;
  const page = await fetch(pageUrl);
  if (!page.ok) throw new Error(`Kenney page failed (${page.status}): ${pageUrl}`);
  const zipUrl = resolveKenneyZipUrl(slug, await page.text());
  const archive = join(cacheRoot, "downloads", `kenney-${slug}.zip`);
  const target = join(cacheRoot, "unpacked", `kenney-${slug}`);
  await download(zipUrl, archive);
  await mkdir(target, { recursive: true });
  extractArchive(archive, target);
  console.log(`Fetched ${slug} from ${zipUrl}`);
}

async function fetchDirectArchive(source: { name: string; url: string }): Promise<void> {
  const archive = join(cacheRoot, "downloads", `${source.name}.zip`);
  const target = join(cacheRoot, "unpacked", source.name);
  await download(source.url, archive);
  await mkdir(target, { recursive: true });
  extractArchive(archive, target);
  console.log(`Fetched ${source.name}`);
}

async function fetchCrackOverlay(): Promise<void> {
  const path = join(publicRoot, "textures", "crackover.png");
  await download("https://opengameart.org/sites/default/files/oga-textures/31071/crackover.png", path);
  console.log(`Fetched ${relative(publicRoot, path)}`);
}

export function parseGoogleFontCss(css: string): { css: string; files: { url: string; file: string }[] } {
  const files: { url: string; file: string }[] = [];
  const localized = css.replace(/url\(["']?(https:\/\/fonts\.gstatic\.com\/[^"')]+\.(woff2|ttf))["']?\)/gi, (_match, url: string, extension: string) => {
    const file = `pixelify-sans-${files.length}.${extension.toLowerCase()}`;
    files.push({ url, file });
    return `url("./${file}")`;
  });
  if (files.length === 0) throw new Error("Google Fonts returned no Pixelify Sans font files");
  return { css: localized, files };
}

async function fetchPixelifySans(): Promise<string[]> {
  const cssUrl = "https://fonts.googleapis.com/css2?family=Pixelify+Sans:wght@400;500;600;700&display=swap";
  const response = await fetch(cssUrl, { headers: { "user-agent": "Mozilla/5.0" } });
  if (!response.ok) throw new Error(`Google Fonts CSS failed (${response.status})`);
  const { css, files } = parseGoogleFontCss(await response.text());
  const fontDir = join(publicRoot, "fonts");
  await mkdir(fontDir, { recursive: true });
  for (const file of files) await download(file.url, join(fontDir, file.file));
  await writeFile(join(fontDir, "pixelify-sans.css"), css);
  await download("https://raw.githubusercontent.com/google/fonts/main/ofl/pixelifysans/OFL.txt", join(fontDir, "OFL.txt"));
  return ["assets/fonts/pixelify-sans.css", "assets/fonts/OFL.txt", ...files.map((file) => `assets/fonts/${file.file}`)];
}

async function packageSelectedAssets(fontPaths: string[]): Promise<void> {
  const manifest: Record<string, Record<string, string>> = {};
  const notices = [
    "# Third-party asset notices",
    "",
    "Visual assets are downloaded from the sources below. Texture packing preserves source pixels; no art is synthesized or recolored.",
    "",
    "| Runtime path | Source file | Author | License |",
    "|---|---|---|---|",
  ];
  for (const [group, picks] of Object.entries(assetPicks)) {
    manifest[group] = {};
    for (const [key, pick] of Object.entries(picks)) {
      const info = sourceInfo[pick.source];
      const sourcePath = join(cacheRoot, "unpacked", pick.source, pick.member);
      const outputPath = join(publicRoot, pick.path.slice("assets/".length));
      await mkdir(dirname(outputPath), { recursive: true });
      if (group === "models") {
        execFileSync(resolve("node_modules/.bin/gltf-transform"), ["meshopt", sourcePath, outputPath, "--level", "medium"], { stdio: "inherit" });
      } else {
        await copyFile(sourcePath, outputPath);
      }
      manifest[group][key] = pick.path;
      notices.push(`| \`${pick.path}\` | [${info.title}](${info.url}) / \`${pick.member}\` | ${info.author} | ${info.license} |`);
    }
  }
  manifest.overlays = { crack: "assets/textures/crackover.png" };
  manifest.fonts = Object.fromEntries(fontPaths.map((path, index) => [`file${index}`, path]));
  notices.push(
    "| `assets/textures/crackover.png` | [64x Textures an Overlays](https://opengameart.org/node/31077) / `crackover.png` | FacadeGaikan | CC0 |",
    "| `assets/fonts/*` | [Pixelify Sans](https://fonts.google.com/specimen/Pixelify+Sans) | Pixelify Sans Project Authors | SIL OFL 1.1 |",
  );
  await writeFile(resolve("src/shared/asset-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(join(publicRoot, "NOTICES.md"), `${notices.join("\n")}\n`);
}

async function main(): Promise<void> {
  if (process.argv.includes("--package-only")) {
    const fonts = (await readdir(join(publicRoot, "fonts"))).map((file) => `assets/fonts/${file}`);
    await packageSelectedAssets(fonts);
    return;
  }
  await mkdir(cacheRoot, { recursive: true });
  for (const slug of kenneySlugs) await fetchKenneyPack(slug);
  for (const source of directArchives) await fetchDirectArchive(source);
  await fetchCrackOverlay();
  const fonts = await fetchPixelifySans();
  await packageSelectedAssets(fonts);
  console.log("Downloaded and packaged verified source assets; see public/assets/NOTICES.md.");
}

if (import.meta.main) await main();


