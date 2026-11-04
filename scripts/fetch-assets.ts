import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

const kenneySlugs = ["voxel-pack", "blocky-characters", "ui-pack", "particle-pack"];
const directArchives = [
  { name: "aroach-block-textures", url: "https://opengameart.org/sites/default/files/blocks_2.zip" },
  { name: "aroach-foliage-textures", url: "https://opengameart.org/sites/default/files/blocks_0.zip" },
  { name: "joeenderman-textures-1", url: "https://opengameart.org/sites/default/files/assorted_textures_1.zip" },
  { name: "joeenderman-textures-2", url: "https://opengameart.org/sites/default/files/assorted_textures_2.zip" },
  { name: "ambientcg-ice-normal", url: "https://ambientcg.com/get?file=Ice001_1K-JPG.zip" },
  { name: "kenney-factory-kit", url: "https://opengameart.org/sites/default/files/kenney_factory-kit_3.0.zip" },
  { name: "kenney-ui-pack-adventure", url: "https://opengameart.org/sites/default/files/kenney_ui-pack-adventure.zip" },
];
const cacheRoot = resolve(".cache/assets");
const publicRoot = resolve("public/assets");
type AssetSourceId =
  | "kenney-voxel-pack"
  | "kenney-blocky-characters"
  | "kenney-ui-pack"
  | "kenney-ui-pack-adventure"
  | "kenney-particle-pack"
  | "aroach-block-textures"
  | "aroach-foliage-textures"
  | "joeenderman-textures-1"
  | "joeenderman-textures-2"
  | "ambientcg-ice-normal"
  | "ambientcg-pbr"
  | "polyhaven-hdri"
  | "kaykit-adventurers"
  | "quaternius-nature"
  | "kenney-factory-kit"
  | "valid-rocketbox";
type AssetPick = { source: AssetSourceId; member: string; path: string; preplaced?: boolean };

const sourceInfo: Record<AssetSourceId, { title: string; author: string; license: string; url: string }> = {
  "kenney-voxel-pack": { title: "Voxel Pack", author: "Kenney", license: "CC0", url: "https://kenney.nl/assets/voxel-pack" },
  "kenney-blocky-characters": { title: "Blocky Characters v2", author: "Kenney", license: "CC0", url: "https://kenney.nl/assets/blocky-characters" },
  "kenney-ui-pack": { title: "UI Pack", author: "Kenney", license: "CC0", url: "https://kenney.nl/assets/ui-pack" },
  "kenney-ui-pack-adventure": { title: "UI Pack - Adventure", author: "Kenney", license: "CC0", url: "https://opengameart.org/content/ui-pack-adventure" },
  "kenney-particle-pack": { title: "Particle Pack", author: "Kenney", license: "CC0", url: "https://kenney.nl/assets/particle-pack" },
  "aroach-block-textures": { title: "16x16 Block Texture Set", author: "ARoachIFoundOnMyPillow", license: "CC0", url: "https://opengameart.org/content/16x16-block-texture-set" },
  "aroach-foliage-textures": { title: "16*16 Block Textures", author: "ARoachIFoundOnMyPillow", license: "CC0", url: "https://opengameart.org/content/1616-block-textures" },
  "joeenderman-textures-1": { title: "Assorted Minecraft style textures", author: "JoeEnderman", license: "CC0", url: "https://opengameart.org/content/assorted-minecraft-style-textures" },
  "joeenderman-textures-2": { title: "Assorted Minecraft style textures", author: "JoeEnderman", license: "CC0", url: "https://opengameart.org/content/assorted-minecraft-style-textures" },
  "ambientcg-ice-normal": { title: "Ice 001 NormalGL", author: "ambientCG", license: "CC0 / Public Domain", url: "https://ambientcg.com/view?id=Ice001" },
  "ambientcg-pbr": { title: "ambientCG PBR materials (Grass001, Ground020, Rock064, Rock058, Ground080, Bark001, ScatteredLeaves009, Planks010, Asphalt033, PavingStones151, Bricks097, Plaster001, RoofingTiles013A)", author: "ambientCG", license: "CC0 / Public Domain", url: "https://ambientcg.com" },
  "polyhaven-hdri": { title: "Kloofendal 48d Partly Cloudy 1K HDR", author: "Poly Haven", license: "CC0", url: "https://polyhaven.com/a/kloofendal_48d_partly_cloudy" },
  "kaykit-adventurers": { title: "KayKit - Character Pack : Adventurers 2.0 (characters + Rig_Medium animations)", author: "Kay Lousberg", license: "CC0 1.0", url: "https://kaylousberg.itch.io/kaykit-adventurers" },
  "quaternius-nature": { title: "Ultimate Stylized Nature (Grass_Small, Bush_Small_Flowers, Flower_1)", author: "Quaternius", license: "CC0", url: "https://quaternius.com/packs/ultimatestylizednature.html" },
  "kenney-factory-kit": { title: "Factory Kit 3.0", author: "Kenney", license: "CC0", url: "https://opengameart.org/sites/default/files/kenney_factory-kit_3.0.zip" },
  "valid-rocketbox": { title: "Validated Avatar Library (VALID) / Microsoft Rocketbox", author: "Tiffany Do, Microsoft Rocketbox", license: "MIT", url: "https://github.com/c-frame/valid-avatars-glb" },
};

const assetPicks: Record<string, Record<string, AssetPick>> = {
  tiles: {
    stone: { source: "kenney-voxel-pack", member: "PNG/Tiles/stone.png", path: "assets/textures/tiles/stone.png" },
    cobblestone: { source: "kenney-voxel-pack", member: "PNG/Tiles/gravel_stone.png", path: "assets/textures/tiles/cobblestone.png" },
    dirt: { source: "kenney-voxel-pack", member: "PNG/Tiles/dirt.png", path: "assets/textures/tiles/dirt.png" },
    grass_top: { source: "kenney-voxel-pack", member: "PNG/Tiles/grass_top.png", path: "assets/textures/tiles/grass_top.png" },

    grass_side: { source: "kenney-voxel-pack", member: "PNG/Tiles/dirt_grass.png", path: "assets/textures/tiles/grass_side.png" },
    sand: { source: "kenney-voxel-pack", member: "PNG/Tiles/sand.png", path: "assets/textures/tiles/sand.png" },
    oak_log_top: { source: "aroach-block-textures", member: "blocks/oak_log_top.png", path: "assets/textures/tiles/oak_log_top.png" },
    oak_log_side: { source: "aroach-block-textures", member: "blocks/oak_log_side.png", path: "assets/textures/tiles/oak_log_side.png" },
    ginkgo_leaves: { source: "kenney-voxel-pack", member: "PNG/Tiles/leaves_transparent.png", path: "assets/textures/tiles/ginkgo_leaves.png" },
    oak_planks: { source: "kenney-voxel-pack", member: "PNG/Tiles/wood.png", path: "assets/textures/tiles/oak_planks.png" },
    water: { source: "kenney-voxel-pack", member: "PNG/Tiles/water.png", path: "assets/textures/tiles/water.png" },
    glass: { source: "kenney-voxel-pack", member: "PNG/Tiles/glass.png", path: "assets/textures/tiles/glass.png" },
    default_mineral_coal: { source: "joeenderman-textures-1", member: "default_mineral_coal.png", path: "assets/textures/tiles/default_mineral_coal.png" },
    default_mineral_iron: { source: "joeenderman-textures-1", member: "default_mineral_iron.png", path: "assets/textures/tiles/default_mineral_iron.png" },
    default_mineral_gold: { source: "joeenderman-textures-1", member: "default_mineral_gold.png", path: "assets/textures/tiles/default_mineral_gold.png" },
    asphalt: { source: "ambientcg-pbr", member: "Asphalt033_1K-JPG_Color.jpg", path: "assets/textures/pbr/Asphalt033/Asphalt033_1K-JPG_Color.jpg", preplaced: true },
    paving: { source: "ambientcg-pbr", member: "PavingStones151_1K-JPG_Color.jpg", path: "assets/textures/pbr/PavingStones151/PavingStones151_1K-JPG_Color.jpg", preplaced: true },
    brick: { source: "ambientcg-pbr", member: "Bricks097_1K-JPG_Color.jpg", path: "assets/textures/pbr/Bricks097/Bricks097_1K-JPG_Color.jpg", preplaced: true },
    plaster: { source: "ambientcg-pbr", member: "Plaster001_1K-JPG_Color.jpg", path: "assets/textures/pbr/Plaster001/Plaster001_1K-JPG_Color.jpg", preplaced: true },
    roof_tile: { source: "ambientcg-pbr", member: "RoofingTiles013A_1K-JPG_Color.jpg", path: "assets/textures/pbr/RoofingTiles013A/RoofingTiles013A_1K-JPG_Color.jpg", preplaced: true },
  },
  models: {
    playerOne: { source: "kaykit-adventurers", member: "Characters/gltf/Knight.glb", path: "assets/models/kaykit/knight.glb", preplaced: true },
    playerTwo: { source: "kaykit-adventurers", member: "Characters/gltf/Rogue.glb", path: "assets/models/kaykit/rogue.glb", preplaced: true },
    mina: { source: "kaykit-adventurers", member: "Characters/gltf/Mage.glb", path: "assets/models/kaykit/mage.glb", preplaced: true },
    staszek: { source: "kaykit-adventurers", member: "Characters/gltf/Ranger.glb", path: "assets/models/kaykit/ranger.glb", preplaced: true },
    factoryConveyor: { source: "kenney-factory-kit", member: "Models/GLB format/conveyor.glb", path: "assets/models/kenney-factory-kit/conveyor.glb" },
    factoryLongConveyor: { source: "kenney-factory-kit", member: "Models/GLB format/conveyor-long.glb", path: "assets/models/kenney-factory-kit/conveyor-long.glb" },
    factoryMachine: { source: "kenney-factory-kit", member: "Models/GLB format/machine.glb", path: "assets/models/kenney-factory-kit/machine.glb" },
    factoryHopper: { source: "kenney-factory-kit", member: "Models/GLB format/hopper-square.glb", path: "assets/models/kenney-factory-kit/hopper-square.glb" },
    factoryScanner: { source: "kenney-factory-kit", member: "Models/GLB format/scanner-low.glb", path: "assets/models/kenney-factory-kit/scanner-low.glb" },
    factoryButton: { source: "kenney-factory-kit", member: "Models/GLB format/button-floor-round.glb", path: "assets/models/kenney-factory-kit/button-floor-round.glb" },
    factoryGear: { source: "kenney-factory-kit", member: "Models/GLB format/cog-a.glb", path: "assets/models/kenney-factory-kit/cog-a.glb" },
  },
  concierge: {
    iskra: { source: "valid-rocketbox", member: "avatars/White/White_F_2_Casual.glb", path: "assets/models/concierge/iskra.glb", preplaced: true },
  },
  modelTextures: {
    factoryKit: { source: "kenney-factory-kit", member: "Models/GLB format/Textures/colormap.png", path: "assets/models/kenney-factory-kit/Textures/colormap.png" },
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
    launchPanel: { source: "kenney-ui-pack-adventure", member: "PNG/Double/panel_brown.png", path: "assets/ui/kenney-adventure/panel_brown.png" },
    launchBanner: { source: "kenney-ui-pack-adventure", member: "PNG/Double/banner_classic_curtain.png", path: "assets/ui/kenney-adventure/banner_classic_curtain.png" },
    launchButton: { source: "kenney-ui-pack-adventure", member: "PNG/Double/button_brown.png", path: "assets/ui/kenney-adventure/button_brown.png" },
    launchModeEmpty: { source: "kenney-ui-pack-adventure", member: "PNG/Double/checkbox_beige_empty.png", path: "assets/ui/kenney-adventure/checkbox_beige_empty.png" },
    launchModeSelected: { source: "kenney-ui-pack-adventure", member: "PNG/Double/checkbox_beige_checked.png", path: "assets/ui/kenney-adventure/checkbox_beige_checked.png" },
    launchStar: { source: "kenney-ui-pack-adventure", member: "PNG/Double/minimap_icon_star_yellow.png", path: "assets/ui/kenney-adventure/minimap_icon_star_yellow.png" },
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
      const outputPath = join(publicRoot, pick.path.slice("assets/".length));
      await mkdir(dirname(outputPath), { recursive: true });
      if (pick.preplaced) {
        if (!existsSync(outputPath)) throw new Error(`Preplaced asset missing (manual download required): ${outputPath} — source: ${info.url}`);
      } else {
        const sourcePath = join(cacheRoot, "unpacked", pick.source, pick.member);
        if (group === "models") {
          execFileSync(resolve("node_modules/.bin/gltf-transform"), ["meshopt", sourcePath, outputPath, "--level", "medium"], { stdio: "inherit" });
        } else {
          await copyFile(sourcePath, outputPath);
        }
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
    "| `assets/models/kaykit/anims/Rig_Medium_*.glb` | [KayKit - Character Pack : Adventurers 2.0](https://kaylousberg.itch.io/kaykit-adventurers) / `Animations/gltf/Rig_Medium/*.glb` | Kay Lousberg | CC0 1.0 |",
    "| `assets/models/props/*` | [Ultimate Stylized Nature](https://quaternius.com/packs/ultimatestylizednature.html) / `glTF/{Grass_Small,Bush_Small_Flowers,Flower_1}.*` | Quaternius | CC0 |",
    "| `assets/sky/kloofendal_48d_partly_cloudy_1k.hdr` | [Kloofendal 48d Partly Cloudy](https://polyhaven.com/a/kloofendal_48d_partly_cloudy) / `1k HDR` | Poly Haven | CC0 |",
    "| `assets/textures/pbr/*` | [ambientCG](https://ambientcg.com) / `<id>_1K-JPG_{Color,NormalGL,Roughness,AmbientOcclusion}.jpg` | ambientCG | CC0 / Public Domain |",
  );
  await writeFile(resolve("src/shared/asset-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(join(publicRoot, "NOTICES.md"), `${notices.join("\n")}\n`);
}

const pbrMaterialIds = ["Grass001", "Ground020", "Rock064", "Rock058", "Ground080", "Bark001", "ScatteredLeaves009", "Planks010", "Asphalt033", "PavingStones151", "Bricks097", "Plaster001", "RoofingTiles013A"] as const;

async function fetchAmbientCgPbr(): Promise<void> {
  for (const id of pbrMaterialIds) {
    const target = join(publicRoot, "textures/pbr", id);
    const requiredMaps = ["Color", "NormalGL", "Roughness"];
    if (requiredMaps.every((map) => existsSync(join(target, `${id}_1K-JPG_${map}.jpg`)))) continue;
    const zip = join(cacheRoot, `${id}_1K-JPG.zip`);
    if (!existsSync(zip)) await download(`https://ambientcg.com/get?file=${id}_1K-JPG.zip`, zip);
    const extracted = join(cacheRoot, `${id}_1K-JPG`);
    if (!requiredMaps.every((map) => existsSync(join(extracted, `${id}_1K-JPG_${map}.jpg`)))) {
      await mkdir(extracted, { recursive: true });
      execFileSync("unzip", ["-oq", zip, "-d", extracted]);
    }
    await mkdir(target, { recursive: true });
    for (const map of requiredMaps) {
      await copyFile(join(extracted, `${id}_1K-JPG_${map}.jpg`), join(target, `${id}_1K-JPG_${map}.jpg`));
    }
    const ao = join(extracted, `${id}_1K-JPG_AmbientOcclusion.jpg`);
    if (existsSync(ao)) await copyFile(ao, join(target, `${id}_1K-JPG_AmbientOcclusion.jpg`));
  }
}

async function packagePbrAssets(): Promise<void> {
  const manifestPath = resolve("src/shared/asset-manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, Record<string, string>>;
  for (const [key, pick] of Object.entries(assetPicks.tiles)) {
    if (pick.source === "ambientcg-pbr") manifest.tiles[key] ??= pick.path;
  }
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  const noticesPath = join(publicRoot, "NOTICES.md");
  const oldTitle = "ambientCG PBR materials (Grass001, Ground020, Rock064, Rock058, Ground080, Bark001, ScatteredLeaves009, Planks010)";
  let notices = (await readFile(noticesPath, "utf8")).replaceAll(oldTitle, sourceInfo["ambientcg-pbr"].title);
  const additions: string[] = [];
  for (const pick of Object.values(assetPicks.tiles)) {
    if (pick.source !== "ambientcg-pbr" || notices.includes(`| \`${pick.path}\` |`)) continue;
    const info = sourceInfo[pick.source];
    additions.push(`| \`${pick.path}\` | [${info.title}](${info.url}) / \`${pick.member}\` | ${info.author} | ${info.license} |`);
  }
  if (additions.length) notices = `${notices.endsWith("\n") ? notices : `${notices}\n`}${additions.join("\n")}\n`;
  await writeFile(noticesPath, notices);
}

async function fetchHdri(): Promise<void> {
  const target = join(publicRoot, "sky/kloofendal_48d_partly_cloudy_1k.hdr");
  if (existsSync(target)) return;
  await download("https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/kloofendal_48d_partly_cloudy_1k.hdr", target);
}

async function main(): Promise<void> {
  if (process.argv.includes("--pbr-only")) {
    await mkdir(cacheRoot, { recursive: true });
    await fetchAmbientCgPbr();
    await packagePbrAssets();
    return;
  }
  if (process.argv.includes("--package-only")) {
    const fonts = (await readdir(join(publicRoot, "fonts"))).map((file) => `assets/fonts/${file}`);
    await packageSelectedAssets(fonts);
    return;
  }
  await mkdir(cacheRoot, { recursive: true });
  for (const slug of kenneySlugs) await fetchKenneyPack(slug);
  for (const source of directArchives) await fetchDirectArchive(source);
  await fetchCrackOverlay();
  await fetchAmbientCgPbr();
  await fetchHdri();
  const fonts = await fetchPixelifySans();
  await packageSelectedAssets(fonts);
  console.log("Downloaded and packaged verified source assets; see public/assets/NOTICES.md.");
}

if (import.meta.main) await main();


