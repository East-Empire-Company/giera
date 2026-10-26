#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const EVIDENCE = resolve(ROOT, ".ai/evidence/pipeline");
const HOME = process.env.HOME ?? "";
const KUBECONFIG = resolve(HOME, "cluster-migration/kube/kubeconfig.yaml");
const AGE_KEY = resolve(HOME, "cluster-migration/.secrets/age-key.txt");
const FORGEJO_SECRET = resolve(HOME, "cluster-migration/homelab-cluster/secrets/forgejo-admin.enc.yaml");
const REGISTRY = "forgejo.tail5d39b4.ts.net";
const IMAGE = `${REGISTRY}/jakub/giera`;
const NAMESPACE = "giera";
const TAG = "giera";
const PUBLIC_URL = `https://${TAG}.tail5d39b4.ts.net`;

type Step = { step: string; status: "pass" | "fail"; detail: string; ms: number };
const steps: Step[] = [];

function run(cmd: string, args: string[], env?: Record<string, string>): { ok: boolean; out: string } {
  const res = spawnSync(cmd, args, {
    cwd: ROOT,
    encoding: "utf-8",
    env: { ...process.env, ...env, KUBECONFIG },
    maxBuffer: 32 * 1024 * 1024,
  });
  const out = `${res.stdout ?? ""}${res.stderr ?? ""}`.trim();
  return { ok: res.status === 0, out };
}

async function step(
  label: string,
  fn: () => { ok: boolean; detail: string } | Promise<{ ok: boolean; detail: string }>
): Promise<boolean> {
  const start = Date.now();
  const { ok, detail } = await fn();
  steps.push({ step: label, status: ok ? "pass" : "fail", detail: detail.slice(0, 400), ms: Date.now() - start });
  console.log(`${ok ? "✓" : "✗"} ${label}${ok ? "" : ` — ${detail}`}`);
  return ok;
}

function tsApiKey(): string {
  if (process.env.TS_APIKEY) return process.env.TS_APIKEY;
  const zsh = readFileSync(resolve(HOME, ".zshrc"), "utf-8");
  const match = zsh.match(/export TS_APIKEY=("?)([^\s"]+)\1/);
  if (!match) throw new Error("TS_APIKEY not found in env or ~/.zshrc");
  return match[2];
}

async function tsApi(path: string, method: string, body?: unknown): Promise<{ ok: boolean; status: number; text: string }> {
  const res = await fetch(`https://api.tailscale.com/api/v2${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${tsApiKey()}`,
      "Content-Type": "application/json",
      Accept: "application/hujson",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { ok: res.ok, status: res.status, text: await res.text() };
}

function hujsonToJson(text: string): unknown {
  return JSON.parse(text.replace(/,(\s*[}\]])/g, "$1"));
}

async function ensureTagFunnel(): Promise<{ ok: boolean; detail: string }> {
  const aclRes = await tsApi("/tailnet/-/acl", "GET");
  if (!aclRes.ok) return { ok: false, detail: `ACL fetch failed: ${aclRes.status} ${aclRes.text}` };
  const acl = hujsonToJson(aclRes.text) as {
    tagOwners?: Record<string, string[]>;
    nodeAttrs?: { target: string[]; attr: string[] }[];
  };
  const hasOwner = Boolean(acl.tagOwners?.[`tag:${TAG}`]);
  const hasFunnel = (acl.nodeAttrs ?? []).some(
    (n) => n.target?.includes(`tag:${TAG}`) && n.attr?.includes("funnel")
  );
  if (hasOwner && hasFunnel) return { ok: true, detail: "tag + funnel already present" };
  if (!acl.tagOwners) acl.tagOwners = {};
  acl.tagOwners[`tag:${TAG}`] = ["tag:jakub"];
  acl.nodeAttrs = acl.nodeAttrs ?? [];
  if (!hasFunnel) acl.nodeAttrs.push({ target: [`tag:${TAG}`], attr: ["funnel"] });
  const post = await tsApi("/tailnet/-/acl", "POST", acl);
  return post.ok
    ? { ok: true, detail: `acl updated (owner=${hasOwner ? "kept" : "added"}, funnel=${hasFunnel ? "kept" : "added"})` }
    : { ok: false, detail: `ACL update failed: ${post.status} ${post.text}` };
}

async function mintAuthKey(): Promise<{ ok: boolean; detail: string; key: string }> {
  const res = await tsApi("/tailnet/-/keys", "POST", {
    capabilities: {
      devices: {
        create: { reusable: true, ephemeral: true, preauthorized: true, tags: [`tag:${TAG}`] },
      },
    },
    expirySeconds: 7776000,
  });
  if (!res.ok) return { ok: false, detail: `key mint failed: ${res.status} ${res.text}`, key: "" };
  const parsed = JSON.parse(res.text) as { key?: string };
  if (!parsed.key) return { ok: false, detail: "key mint returned no key", key: "" };
  return { ok: true, detail: "authkey minted for tag:giera", key: parsed.key };
}

function registryPassword(): { ok: boolean; detail: string; password: string; username: string } {
  if (!existsSync(FORGEJO_SECRET) || !existsSync(AGE_KEY)) {
    return { ok: false, detail: "forgejo-admin secret or age key missing", password: "", username: "" };
  }
  const res = spawnSync("sops", ["-d", FORGEJO_SECRET], {
    encoding: "utf-8",
    env: { ...process.env, SOPS_AGE_KEY_FILE: AGE_KEY },
  });
  if (res.status !== 0) return { ok: false, detail: `sops decrypt failed: ${res.stderr}`, password: "", username: "" };
  const yaml = res.stdout;
  const passwordB64 = yaml.match(/password:\s*(\S+)/)?.[1] ?? "";
  const usernameB64 = yaml.match(/username:\s*(\S+)/)?.[1] ?? "";
  if (!passwordB64) return { ok: false, detail: "no password in decrypted secret", password: "", username: "" };
  return {
    ok: true,
    detail: "registry credentials decrypted",
    password: Buffer.from(passwordB64, "base64").toString("utf-8"),
    username: Buffer.from(usernameB64, "base64").toString("utf-8"),
  };
}

const sha = (() => {
  const res = spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT, encoding: "utf-8" });
  return res.status === 0 ? res.stdout.trim() : "dev";
})();

let failed = false;
const must = (ok: boolean): boolean => {
  if (!ok) failed = true;
  return ok;
};

must(
  await step("cluster reachable", async () => {
    let res = { ok: false, out: "" };
    for (let attempt = 0; attempt < 3; attempt++) {
      res = run("kubectl", ["get", "nodes", "-o", "name"]);
      if (res.ok) break;
      await new Promise((r) => setTimeout(r, 3000));
    }
    return { ok: res.ok, detail: res.ok ? res.out : res.out };
  })
);

await step("registry mirror present on cluster nodes", async () => {
  const pod = "giera-mirror-check";
  const overrides = JSON.stringify({
    spec: {
      nodeSelector: { "kubernetes.io/hostname": "k3s-mikrus-1" },
      containers: [
        {
          name: "mirror-check",
          image: "busybox",
          command: ["sh", "-c", "cat /host/etc/rancher/k3s/registries.yaml | head -8"],
          volumeMounts: [{ name: "host", mountPath: "/host" }],
        },
      ],
      volumes: [{ name: "host", hostPath: { path: "/", type: "Directory" } }],
    },
  });
  run("kubectl", ["-n", NAMESPACE, "delete", "pod", pod, "--ignore-not-found"]);
  const created = run("kubectl", [
    "-n",
    NAMESPACE,
    "run",
    pod,
    "--image=busybox",
    "--restart=Never",
    `--overrides=${overrides}`,
  ]);
  if (!created.ok) {
    run("kubectl", ["-n", NAMESPACE, "delete", "pod", pod, "--ignore-not-found"]);
    return { ok: false, detail: created.out };
  }
  let out = "";
  for (let attempt = 0; attempt < 20; attempt++) {
    await new Promise((r) => setTimeout(r, 1000));
    const logs = run("kubectl", ["-n", NAMESPACE, "logs", pod]);
    if (logs.ok && logs.out.trim()) {
      out = logs.out;
      break;
    }
  }
  run("kubectl", ["-n", NAMESPACE, "delete", "pod", pod, "--ignore-not-found"]);
  const ok = out.includes("forgejo");
  return { ok, detail: ok ? out.split("\n").slice(0, 5).join(" | ") : out || "no registry mirror found" };
});

must(
  await step("registry proxy ready on cluster", () => {
    const res = run("kubectl", ["-n", "forgejo", "get", "deploy", "ts-proxy", "-o", "jsonpath={.status.readyReplicas}"]);
    const ready = Number(res.out.trim() || "0");
    return { ok: res.ok && ready >= 1, detail: `ts-proxy ready replicas: ${res.out.trim() || "0"}` };
  })
);

const creds = registryPassword();
must(await step("registry credentials", () => ({ ok: creds.ok, detail: creds.detail })));

if (creds.ok) {
  must(
    await step("docker login", () => {
      const res = spawnSync("docker", ["login", REGISTRY, "-u", creds.username, "--password-stdin"], {
        input: creds.password,
        encoding: "utf-8",
      });
      return { ok: res.status === 0, detail: `${res.stdout ?? ""}${res.stderr ?? ""}`.trim() };
    })
  );
}

must(
  await step("build + push image", () => {
    const res = run("docker", [
      "buildx",
      "build",
      "--platform",
      "linux/amd64",
      "--provenance=false",
      "--sbom=false",
      "--tag",
      `${IMAGE}:${sha}`,
      "--tag",
      `${IMAGE}:latest`,
      "--push",
      ".",
    ]);
    return { ok: res.ok, detail: res.out.split("\n").slice(-4).join(" | ") };
  })
);

if (failed) {
  console.error(`\nDEPLOY ABORTED — prerequisites or build+push failed; image ${IMAGE}:${sha} not confirmed pushed. Refusing to apply manifests or touch the rollout.`);
  process.exit(1);
}

must(
  await step("namespace", () => {
    const res = run("kubectl", ["get", "ns", NAMESPACE]);
    if (res.ok) return { ok: true, detail: "exists" };
    const created = run("kubectl", ["create", "ns", NAMESPACE]);
    return { ok: created.ok, detail: created.out };
  })
);

const secretExists = run("kubectl", ["-n", NAMESPACE, "get", "secret", "ts-sidecar-auth"]).ok;
if (!secretExists) {
  const minted = await mintAuthKey();
  must(await step("mint tailscale authkey", () => ({ ok: minted.ok, detail: minted.detail })));
  if (minted.ok) {
    must(
      await step("create ts-sidecar-auth secret", () => {
        const res = run("kubectl", [
          "-n",
          NAMESPACE,
          "create",
          "secret",
          "generic",
          "ts-sidecar-auth",
          "--from-literal=TS_AUTHKEY=" + minted.key,
        ]);
        return { ok: res.ok, detail: res.out };
      })
    );
  }
} else {
  steps.push({ step: "mint tailscale authkey", status: "pass", detail: "secret already present", ms: 0 });
}

must(
  await step("nexgate auth secret", () => {
    const exists = run("kubectl", ["-n", NAMESPACE, "get", "secret", "nexgate-auth"]).ok;
    if (exists) return { ok: true, detail: "exists" };
    const key = process.env.NEXGATE_OMP_API_KEY ?? process.env.NEXGATE_NEMOTRON_BOLT_API_KEY ?? "";
    if (!key) return { ok: false, detail: "NEXGATE_OMP_API_KEY missing in env" };
    const res = run("kubectl", [
      "-n",
      NAMESPACE,
      "create",
      "secret",
      "generic",
      "nexgate-auth",
      "--from-literal=NEXGATE_OMP_API_KEY=" + key,
    ]);
    return { ok: res.ok, detail: res.out };
  })
);

must(
  await step("tailscale acl tag + funnel", async () => {
    const res = await ensureTagFunnel();
    return res;
  })
);

must(
  await step("registry pull secret", () => {
    const exists = run("kubectl", ["-n", NAMESPACE, "get", "secret", "forgejo-registry"]).ok;
    if (exists) return { ok: true, detail: "exists" };
    const res = run("kubectl", [
      "-n",
      NAMESPACE,
      "create",
      "secret",
      "docker-registry",
      "forgejo-registry",
      "--docker-server=" + REGISTRY,
      "--docker-username=" + creds.username,
      "--docker-password=" + creds.password,
    ]);
    const raced = !res.ok && res.out.includes("already exists");
    return { ok: res.ok || raced, detail: raced ? "exists (created concurrently)" : res.out };
  })
);

must(
  await step("apply manifests", () => {
    const res = run("kubectl", ["apply", "-k", "k8s/"]);
    return { ok: res.ok, detail: res.out.split("\n").slice(-4).join(" | ") };
  })
);

must(
  await step("rollout", () => {
    run("kubectl", ["-n", NAMESPACE, "set", "image", `deploy/giera`, `app=${IMAGE}:${sha}`]);
    const res = run("kubectl", ["-n", NAMESPACE, "rollout", "status", "deploy/giera", "--timeout=180s"]);
    return { ok: res.ok, detail: res.out };
  })
);

must(
  await step("public url serves the game", async () => {
    for (let attempt = 1; attempt <= 12; attempt++) {
      const res = await fetch(PUBLIC_URL, { redirect: "follow" });
      if (res.ok) {
        const body = await res.text();
        return { ok: body.includes("<html"), detail: `HTTP ${res.status} (attempt ${attempt})` };
      }
      await new Promise((r) => setTimeout(r, 5000));
    }
    return { ok: false, detail: `${PUBLIC_URL} did not serve the game` };
  })
);

mkdirSync(EVIDENCE, { recursive: true });
writeFileSync(
  resolve(EVIDENCE, "deploy.json"),
  `${JSON.stringify({ deployedAt: new Date().toISOString(), image: `${IMAGE}:${sha}`, url: PUBLIC_URL, namespace: NAMESPACE, node: "k3s-mikrus-1", ok: !failed, steps }, null, 2)}\n`
);
console.log(failed ? "\nDEPLOY FAILED" : `\nDeployed ${IMAGE}:${sha} → ${PUBLIC_URL}`);
process.exit(failed ? 1 : 0);
