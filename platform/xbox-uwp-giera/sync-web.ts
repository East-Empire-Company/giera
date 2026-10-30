#!/usr/bin/env bun
import { cp, mkdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";

const here = import.meta.dir;
const repo = join(here, "..", "..");
const dist = join(repo, "dist");
const www = join(here, "Assets", "www");

const skipBuild = process.argv.includes("--skip-build");

if (!skipBuild) {
  const build = Bun.spawnSync(["bun", "run", "build"], { cwd: repo, stdout: "inherit", stderr: "inherit" });
  if (build.exitCode !== 0) {
    console.error("vite build failed");
    process.exit(build.exitCode ?? 1);
  }
}

const index = Bun.file(join(dist, "index.html"));
if (!(await index.exists())) {
  console.error(`missing ${join(dist, "index.html")} — run the build first`);
  process.exit(1);
}

await rm(www, { recursive: true, force: true });
await mkdir(www, { recursive: true });
await cp(dist, www, { recursive: true });

let files = 0;
let bytes = 0;
for await (const entry of new Bun.Glob("**/*").scan({ cwd: www, onlyFiles: true })) {
  files += 1;
  bytes += (await stat(join(www, entry))).size;
}

console.log(`synced ${files} files, ${(bytes / 1024 / 1024).toFixed(1)} MB -> platform/xbox-uwp-giera/Assets/www`);