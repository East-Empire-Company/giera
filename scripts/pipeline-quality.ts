#!/usr/bin/env bun
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const EVIDENCE = resolve(ROOT, ".ai/evidence/pipeline");

type Json = Record<string, unknown>;

function walkSuites(node: Json, out: { title: string; message: string }[]): void {
  for (const suite of (node.suites as Json[] | undefined) ?? []) {
    for (const spec of (suite.specs as Json[] | undefined) ?? []) {
      const title = `${suite.title ?? ""} ${spec.title ?? ""}`.trim();
      for (const test of (spec.tests as Json[] | undefined) ?? []) {
        for (const result of (test.results as Json[] | undefined) ?? []) {
          for (const err of (result.errors as { message?: string }[] | undefined) ?? []) {
            out.push({ title, message: err.message ?? "unknown error" });
          }
        }
      }
    }
    walkSuites(suite, out);
  }
}

const errors: { title: string; message: string }[] = [];
const scanned: string[] = [];
if (existsSync(EVIDENCE)) {
  for (const file of readdirSync(EVIDENCE).filter((f) => f.endsWith("-results.json"))) {
    scanned.push(file);
    const data = JSON.parse(readFileSync(resolve(EVIDENCE, file), "utf-8")) as Json;
    walkSuites(data, errors);
  }
}

const pageErrors = errors.filter((e) => /pageerror/i.test(e.message));
const otherErrors = errors.filter((e) => !/pageerror/i.test(e.message));

function listFiles(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) listFiles(full, out);
    else out.push(full);
  }
  return out;
}

const corpusFiles = [
  ...listFiles(resolve(ROOT, "src")),
  ...listFiles(resolve(ROOT, "scripts")),
  ...listFiles(resolve(ROOT, "tests")),
  ...listFiles(resolve(ROOT, "public")).filter((f) => f.endsWith(".json")),
];
const corpus = corpusFiles.map((f) => readFileSync(f, "utf-8")).join("\n");

const assetFiles = listFiles(resolve(ROOT, "public/assets"));
const unreferenced = assetFiles.filter((f) => {
  const rel = f.slice(resolve(ROOT, "public").length + 1);
  return !corpus.includes(rel);
});

if (unreferenced.length > 0) {
  console.warn(`quality WARNING — ${unreferenced.length} asset file(s) not referenced by any manifest or code:`);
  for (const f of unreferenced) console.warn(`  - ${f.slice(resolve(ROOT, "public").length + 1)}`);
}

console.log(
  `quality: scanned ${scanned.length} playwright result file(s) (${scanned.join(", ") || "none"}), ${assetFiles.length} assets checked.`
);

if (pageErrors.length > 0) {
  console.error(`quality FAIL — ${pageErrors.length} pageerror(s) in e2e runs:`);
  for (const e of pageErrors) console.error(`  - ${e.title}: ${e.message.split("\n")[0]}`);
  process.exit(1);
}
if (otherErrors.length > 0) {
  console.error(`quality FAIL — ${otherErrors.length} failed e2e test(s):`);
  for (const e of otherErrors) console.error(`  - ${e.title}: ${e.message.split("\n")[0]}`);
  process.exit(1);
}
console.log("quality: OK — no pageerrors, no failed e2e tests.");
