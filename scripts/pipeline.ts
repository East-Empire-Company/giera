#!/usr/bin/env bun
import { spawn, spawnSync } from "node:child_process";
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { connect } from "node:net";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const EVIDENCE = resolve(ROOT, ".ai/evidence/pipeline");
const GOLDEN_CAPTURE_DIR = resolve(EVIDENCE, "golden-captured");
const GOLDENS_DIR = resolve(ROOT, "tests/goldens");
const LAN_PORT = 8791;
const LAN_DATA_DIR = resolve(ROOT, "server/data-test");
const LAN_WS = `ws://127.0.0.1:${LAN_PORT}/ws`;

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const valueOf = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

type StageResult = {
  stage: string;
  status: "pass" | "fail" | "skip";
  ms: number;
  detail: string;
};

function ensureDirs(): void {
  mkdirSync(EVIDENCE, { recursive: true });
  mkdirSync(GOLDEN_CAPTURE_DIR, { recursive: true });
}

function waitPort(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((res, rej) => {
    const attempt = (): void => {
      const sock = connect(port, "127.0.0.1");
      sock.once("connect", () => {
        sock.destroy();
        res();
      });
      sock.once("error", () => {
        sock.destroy();
        if (Date.now() > deadline) rej(new Error(`port ${port} never opened`));
        else setTimeout(attempt, 250);
      });
    };
    attempt();
  });
}

async function runCmd(name: string, cmd: string[], env?: Record<string, string>): Promise<StageResult> {
  const start = Date.now();
  console.log(`\n━━━ STAGE ${name} ━━━`);
  const res = spawnSync(cmd[0], cmd.slice(1), {
    cwd: ROOT,
    stdio: "inherit",
    env: { ...process.env, ...env },
    timeout: 900_000,
  });
  const ms = Date.now() - start;
  const ok = res.status === 0;
  console.log(`━━━ ${name}: ${ok ? "PASS" : "FAIL"} (${(ms / 1000).toFixed(1)}s)`);
  return { stage: name, status: ok ? "pass" : "fail", ms, detail: res.error?.message ?? `exit=${res.status}` };
}

async function runNetworkStage(): Promise<StageResult> {
  rmSync(LAN_DATA_DIR, { recursive: true, force: true });
  const serverProc = spawn("bun", ["server/index.ts"], {
    cwd: ROOT,
    stdio: ["ignore", "inherit", "inherit"],
    env: { ...process.env, PORT: String(LAN_PORT), GIERA_DATA_DIR: LAN_DATA_DIR },
  });
  try {
    await waitPort(LAN_PORT, 15_000);
    return await runCmd("network", ["bunx", "playwright", "test", "--project=lan"], {
      GIERA_TEST_WS: LAN_WS,
    });
  } finally {
    serverProc.kill("SIGTERM");
    setTimeout(() => rmSync(LAN_DATA_DIR, { recursive: true, force: true }), 500);
  }
}

function stageList(fast: boolean): { name: string; run: () => Promise<StageResult> }[] {
  const pw = (project: string) => ["bunx", "playwright", "test", `--project=${project}`];
  const stages: { name: string; run: () => Promise<StageResult> }[] = [
    { name: "typecheck", run: () => runCmd("typecheck", ["bun", "run", "typecheck"]) },
    { name: "unit", run: () => runCmd("unit", ["bun", "run", "test:coverage"]) },
    { name: "content", run: () => runCmd("content", ["bun", "scripts/pipeline-content.ts"]) },
    { name: "build", run: () => runCmd("build", ["bun", "run", "build"]) },
    {
      name: "e2e-mechanics",
      run: () =>
        runCmd("e2e-mechanics", pw("mechanics"), {
          GIERA_JSON_OUT: resolve(EVIDENCE, "mechanics-results.json"),
        }),
    },
  ];
  if (!fast) {
    stages.push({ name: "goldens", run: () => runCmd("goldens", pw("goldens")) });
    stages.push({
      name: "performance",
      run: () =>
        runCmd("performance", pw("perf"), {
          GIERA_JSON_OUT: resolve(EVIDENCE, "perf-results.json"),
        }),
    });
  }
  stages.push({ name: "network", run: runNetworkStage });
  stages.push({ name: "quality", run: () => runCmd("quality", ["bun", "scripts/pipeline-quality.ts"]) });
  return stages;
}

function writeReport(results: StageResult[], fast: boolean): void {
  const stamp = new Date().toISOString();
  const totals = {
    runAt: stamp,
    fast,
    pass: results.filter((r) => r.status === "pass").length,
    fail: results.filter((r) => r.status === "fail").length,
    skip: results.filter((r) => r.status === "skip").length,
    stages: results,
  };
  writeFileSync(resolve(EVIDENCE, "report.json"), JSON.stringify(totals, null, 2));
  const md = [
    `# Giera pipeline report — ${stamp}`,
    "",
    "| stage | status | s | detail |",
    "|---|---|---|---|",
    ...results.map((r) => `| ${r.stage} | ${r.status} | ${(r.ms / 1000).toFixed(1)} | ${r.detail} |`),
  ].join("\n");
  writeFileSync(resolve(EVIDENCE, "report.md"), md + "\n");
  console.log(`\nReport: ${resolve(EVIDENCE, "report.md")}`);
}

async function runPipeline(fast: boolean, goldensInit: boolean): Promise<number> {
  ensureDirs();
  const all = stageList(fast);
  const results: StageResult[] = [];
  for (const stage of all) {
    if (goldensInit && stage.name !== "goldens") {
      results.push({ stage: stage.name, status: "skip", ms: 0, detail: "goldens-init run" });
      continue;
    }
    let r: StageResult;
    try {
      r = goldensInit
        ? await runCmd("goldens", ["bunx", "playwright", "test", "--project=goldens"], {
            GIERA_GOLDENS_INIT: "1",
          })
        : await stage.run();
    } catch (e) {
      r = { stage: stage.name, status: "fail", ms: 0, detail: String(e) };
    }
    results.push(r);
    if (r.status === "fail") {
      for (const later of all.slice(all.indexOf(stage) + 1)) {
        results.push({ stage: later.name, status: "skip", ms: 0, detail: "fail-fast" });
      }
      break;
    }
    if (goldensInit) {
      console.log(`\nGoldens written to ${GOLDENS_DIR}. Review the 3 images before trusting the pipeline.`);
      break;
    }
  }
  writeReport(results, fast);
  return results.some((r) => r.status === "fail") ? 1 : 0;
}

function runAccept(): number {
  const stage = valueOf("--stage");
  const reason = valueOf("--reason");
  if (!stage || !reason) {
    console.error('accept requires --stage goldens|mechanics and --reason "..."');
    return 2;
  }
  ensureDirs();
  mkdirSync(GOLDENS_DIR, { recursive: true });
  if (stage === "goldens") {
    if (!existsSync(GOLDEN_CAPTURE_DIR)) {
      console.error(`No captured goldens at ${GOLDEN_CAPTURE_DIR}. Run the goldens stage first.`);
      return 2;
    }
    for (const f of readdirSync(GOLDEN_CAPTURE_DIR)) {
      if (f.endsWith(".png")) copyFileSync(resolve(GOLDEN_CAPTURE_DIR, f), resolve(GOLDENS_DIR, f));
    }
  } else if (stage === "mechanics") {
    const values = valueOf("--values");
    if (!values) {
      console.error('mechanics accept requires --values "KEY=VALUE,KEY2=VALUE2"');
      return 2;
    }
    const constantsPath = resolve(ROOT, "tests/spec-constants.ts");
    let src = readFileSync(constantsPath, "utf-8");
    for (const pair of values.split(",")) {
      const [key, val] = pair.split("=");
      const re = new RegExp(`(export const ${key} = )(.*?)(;)`);
      if (!re.test(src)) {
        console.error(`Unknown spec constant: ${key}`);
        return 2;
      }
      src = src.replace(re, `$1${val}$3`);
    }
    writeFileSync(constantsPath, src, "utf-8");
  } else {
    console.error("accept --stage must be goldens or mechanics");
    return 2;
  }
  appendFileSync(
    resolve(EVIDENCE, "TRIAGE.md"),
    `## ${new Date().toISOString()} stage=${stage}\nreason: ${reason}\n${valueOf("--values") ? `values: ${valueOf("--values")}\n` : ""}\n`
  );
  console.log(`Accepted ${stage}. Triage entry appended.`);
  return 0;
}

async function runManual(): Promise<number> {
  ensureDirs();
  try {
    await waitPort(5173, 1000);
    console.log("Dev server already running on 5173.");
  } catch {
    const log = openSync(resolve(EVIDENCE, "dev-server.log"), "a");
    const dev = spawn("bun", ["run", "dev", "--port", "5173"], {
      cwd: ROOT,
      detached: true,
      stdio: ["ignore", log, log],
    });
    dev.unref();
    await waitPort(5173, 30_000);
    console.log("Dev server started (log: .ai/evidence/pipeline/dev-server.log).");
  }
  spawnSync("open", ["http://localhost:5173/?seed=424242"]);
  console.log(`
MANUAL SESSION
- Game:      http://localhost:5173/?seed=424242
- Checklist: tests/MANUAL-CHECKLIST.md
- Evidence:  .ai/evidence/manual/YYYY-MM-DD/  (screenshots, notes, clip names)
Stop server: lsof -ti :5173 | xargs kill
`);
  return 0;
}

const exitCode = flag("--accept")
  ? runAccept()
  : flag("--manual")
    ? await runManual()
    : await runPipeline(flag("--fast"), flag("--goldens-init"));
process.exit(exitCode);
