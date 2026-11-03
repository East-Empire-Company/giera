#!/usr/bin/env bun
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { connect, createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const EVIDENCE = resolve(ROOT, ".ai/evidence/pipeline");
const GOLDEN_CAPTURE_DIR = resolve(EVIDENCE, "golden-captured");
const GOLDENS_DIR = resolve(ROOT, "tests/goldens");
const DEFAULT_LAN_PORT = 8791;

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
async function unusedPort(preferred?: number): Promise<number> {
  const probe = createServer();
  const listen = (port: number) => new Promise<number>((resolvePort, reject) => {
    probe.once("error", reject);
    probe.listen(port, "127.0.0.1", () => {
      const address = probe.address();
      if (!address || typeof address === "string") return reject(new Error("Could not read bound port"));
      resolvePort(address.port);
    });
  });
  try {
    return await listen(preferred ?? 0);
  } catch (error) {
    if (preferred === undefined) throw error;
    probe.removeAllListeners("error");
    return await listen(0);
  } finally {
    if (probe.listening) await new Promise<void>((resolveClose) => probe.close(() => resolveClose()));
  }
}

async function stopProcess(proc: ChildProcess): Promise<void> {
  if (proc.exitCode !== null) return;
  const { promise, resolve } = Promise.withResolvers<void>();
  proc.once("exit", () => resolve());
  proc.kill("SIGTERM");
  const forceTimer = setTimeout(() => {
    if (proc.exitCode === null) proc.kill("SIGKILL");
  }, 2_000);
  forceTimer.unref();
  await promise;
  clearTimeout(forceTimer);
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
  const dataDir = mkdtempSync(join(tmpdir(), "giera-pipeline-lan-"));
  let serverProc: ChildProcess | undefined;
  try {
    const requested = process.env.GIERA_TEST_LAN_PORT;
    const preferred = requested === undefined ? DEFAULT_LAN_PORT : Number(requested);
    if (!Number.isInteger(preferred) || preferred < 1 || preferred > 65_535) {
      throw new Error("GIERA_TEST_LAN_PORT must be a valid TCP port");
    }
    const port = await unusedPort(preferred);
    const wsUrl = `ws://127.0.0.1:${port}/ws`;
    serverProc = spawn("bun", ["server/index.ts"], {
      cwd: ROOT,
      stdio: ["ignore", "inherit", "inherit"],
      env: { ...process.env, PORT: String(port), GIERA_DATA_DIR: dataDir },
    });
    await waitPort(port, 15_000);
    return await runCmd("network", ["bunx", "playwright", "test", "--project=lan", "--project=companion"], {
      GIERA_TEST_WS: wsUrl,
      GIERA_TEST_LAN_PORT: String(port),
      GIERA_TEST_DATA_DIR: dataDir,
    });
  } finally {
    try {
      if (serverProc) await stopProcess(serverProc);
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
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

async function runPipelineWithBackend(fast: boolean, goldensInit: boolean): Promise<number> {
  const dataDir = mkdtempSync(join(tmpdir(), "giera-pipeline-backend-"));
  let backend: ChildProcess | undefined;
  const envKeys = [
    "GIERA_TEST_BACKEND_ORIGIN",
    "GIERA_DATA_DIR",
    "ELEVEN_LABS_API_KEY",
    "ELEVENLABS_API_KEY",
    "NEXGATE_NEMOTRON_BOLT_API_KEY",
    "NEXGATE_OMP_API_KEY",
    "NEXGATE_URL",
  ] as const;
  const previous = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  try {
    const port = await unusedPort();
    backend = spawn("bun", ["server/index.ts"], {
      cwd: ROOT,
      stdio: ["ignore", "inherit", "inherit"],
      env: {
        ...process.env,
        PORT: String(port),
        GIERA_DATA_DIR: dataDir,
        ELEVEN_LABS_API_KEY: "",
        ELEVENLABS_API_KEY: "",
        NEXGATE_NEMOTRON_BOLT_API_KEY: "",
        NEXGATE_OMP_API_KEY: "",
        NEXGATE_URL: "http://127.0.0.1:9",
      },
    });
    process.env.GIERA_TEST_BACKEND_ORIGIN = `http://127.0.0.1:${port}`;
    process.env.GIERA_DATA_DIR = dataDir;
    process.env.ELEVEN_LABS_API_KEY = "";
    process.env.ELEVENLABS_API_KEY = "";
    process.env.NEXGATE_NEMOTRON_BOLT_API_KEY = "";
    process.env.NEXGATE_OMP_API_KEY = "";
    process.env.NEXGATE_URL = "http://127.0.0.1:9";
    await waitPort(port, 15_000);
    return await runPipeline(fast, goldensInit);
  } finally {
    try {
      try {
        if (backend) await stopProcess(backend);
      } finally {
        rmSync(dataDir, { recursive: true, force: true });
      }
    } finally {
      for (const key of envKeys) {
        if (previous[key] === undefined) delete process.env[key];
        else process.env[key] = previous[key];
      }
    }
  }
}

async function runAccept(): Promise<number> {
  const stage = valueOf("--stage");
  const reason = valueOf("--reason");
  if (!stage || !reason) {
    console.error('accept requires --stage goldens|mechanics and --reason "..."');
    return 2;
  }
  ensureDirs();
  mkdirSync(GOLDENS_DIR, { recursive: true });
  const triagePath = resolve(ROOT, "tests/goldens/TRIAGE.md");
  if (stage === "goldens") {
    const staging = resolve(GOLDENS_DIR, ".staging");
    const capture = await runCmd("goldens-capture", ["bunx", "playwright", "test", "--project=goldens"], {
      GIERA_GOLDENS_STAGE: "1",
    });
    if (capture.status !== "pass" || !existsSync(staging)) {
      rmSync(staging, { recursive: true, force: true });
      console.error("Golden capture failed; baselines left untouched.");
      return 1;
    }
    const force = flag("--force");
    for (const f of readdirSync(staging)) {
      if (!f.endsWith(".png")) continue;
      const staged = resolve(staging, f);
      const size = readFileSync(staged).length;
      if (size < 8_000) {
        console.error(`${f} is ${size} bytes; refusing a blank capture.`);
        return 1;
      }
      const current = resolve(GOLDENS_DIR, f);
      if (existsSync(current) && !force) {
        const ratio = Math.abs(size - readFileSync(current).length) / readFileSync(current).length;
        if (ratio > 0.4) {
          console.error(`${f} size changed ${(ratio * 100).toFixed(0)}%. Re-run with --force if that is intended.`);
          return 1;
        }
      }
      copyFileSync(staged, current);
      console.log(`accepted ${f} (${size} bytes)`);
    }
    rmSync(staging, { recursive: true, force: true });
  } else if (stage === "mechanics") {
    const values = valueOf("--values");
    if (!values) {
      console.error('mechanics accept requires --values "KEY=VALUE,KEY2=VALUE2"');
      return 2;
    }
    const allowed = new Set([
      "seed", "qaFixedDelta", "walkSpeedBlocksPerSec", "walkFrames", "walkDistanceBand",
      "jumpVyMin", "trampolineVy", "trampolineVyTolerance", "upgradeCostPerTier",
    ]);
    const constantsPath = resolve(ROOT, "tests/spec-constants.ts");
    let src = readFileSync(constantsPath, "utf-8");
    for (const pair of values.split(",")) {
      const eq = pair.indexOf("=");
      const key = pair.slice(0, eq).trim();
      const val = pair.slice(eq + 1).trim();
      if (!allowed.has(key) || !val) {
        console.error(`Unknown spec constant: ${key}`);
        return 2;
      }
      const re = new RegExp(`(${key}:\\s*)([^,\\n]+)`);
      if (!re.test(src)) {
        console.error(`Spec property not found: ${key}`);
        return 2;
      }
      src = src.replace(re, `$1${val}`);
    }
    writeFileSync(constantsPath, src, "utf-8");
  } else {
    console.error("accept --stage must be goldens or mechanics");
    return 2;
  }
  appendFileSync(
    triagePath,
    `## ${new Date().toISOString()} stage=${stage}\nreason: ${reason}\n${valueOf("--values") ? `values: ${valueOf("--values")}\n` : ""}\n`
  );
  console.log(`Accepted ${stage}. Triage: ${triagePath}`);
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
  ? await runAccept()
  : flag("--manual")
    ? await runManual()
    : await runPipelineWithBackend(flag("--fast"), flag("--goldens-init"));
process.exit(exitCode);
