#!/usr/bin/env bun
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MUSIC_PLAYLIST, MUSIC_TRACKS, VOICE_PATHS, parseAudioManifest } from "../src/client/audio/sound";
import { getItemIcon } from "../src/client/game/hud";

const ROOT = resolve(import.meta.dir, "..");
const missing: string[] = [];

function checkPublic(relPath: string, source: string): void {
  if (!relPath.startsWith("assets/") && !relPath.startsWith("/assets/")) return;
  const clean = relPath.replace(/^\//, "");
  if (!existsSync(resolve(ROOT, "public", clean))) missing.push(`${clean}  (from ${source})`);
}

function collectAssetStrings(node: unknown): string[] {
  if (typeof node === "string") return [node];
  if (Array.isArray(node)) return node.flatMap(collectAssetStrings);
  if (node && typeof node === "object")
    return Object.values(node).flatMap(collectAssetStrings);
  return [];
}

for (const [id, path] of Object.entries(MUSIC_TRACKS)) checkPublic(path, `MUSIC_TRACKS.${id}`);
for (const [id, path] of Object.entries(VOICE_PATHS)) checkPublic(path, `VOICE_PATHS.${id}`);

const generatedManifestPath = resolve(ROOT, "public/assets/audio/generated/manifest.json");
if (!existsSync(generatedManifestPath)) {
  missing.push("assets/audio/generated/manifest.json  (generated audio provenance)");
} else {
  const generated = parseAudioManifest(JSON.parse(readFileSync(generatedManifestPath, "utf-8")));
  for (const [id, path] of Object.entries(generated)) checkPublic(path, `generated-manifest.${id}`);
}

for (const id of MUSIC_PLAYLIST) {
  if (!(id in MUSIC_TRACKS)) missing.push(`playlist id "${id}" is not a MUSIC_TRACKS key`);
}

const hudSrc = readFileSync(resolve(ROOT, "src/client/game/hud.ts"), "utf-8");
const iconsBlock = hudSrc.slice(hudSrc.indexOf("const icons: Record<string, string> = {"), hudSrc.indexOf("};", hudSrc.indexOf("const icons: Record<string, string> = {")));
const iconKeys = [...iconsBlock.matchAll(/^\s{4}([a-z_]+):/gm)].map((m) => m[1]);
for (const key of iconKeys) checkPublic(getItemIcon(key), `getItemIcon.${key}`);

const indexHtml = readFileSync(resolve(ROOT, "index.html"), "utf-8");
const splashBlock = indexHtml.slice(indexHtml.indexOf('id="boot-video"'), indexHtml.indexOf("</video>", indexHtml.indexOf('id="boot-video"')));
const splashSources = [...splashBlock.matchAll(/src="(\/assets\/[^"]+)"/g)].map((m) => m[1]);
if (splashSources.length === 0) missing.push("index.html boot-video has no <source> for the splash video");
for (const s of splashSources) checkPublic(s, "index.html boot-video");

for (const manifest of ["src/shared/asset-manifest.json", "src/shared/atlas-manifest.json"]) {
  const data = JSON.parse(readFileSync(resolve(ROOT, manifest), "utf-8"));
  for (const s of collectAssetStrings(data)) checkPublic(s, manifest);
}

if (missing.length > 0) {
  console.error(`CONTENT STAGE FAIL — ${missing.length} missing/invalid asset reference(s):`);
  for (const m of missing) console.error(`  - ${m}`);
  process.exit(1);
}
const staticCount = Object.keys(MUSIC_TRACKS).length + Object.keys(VOICE_PATHS).length;
console.log(`content: OK — ${staticCount} static refs, ${iconKeys.length} icons, playlist, manifests all present.`);
