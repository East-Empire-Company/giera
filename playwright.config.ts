import { createServer } from "node:net";
import { defineConfig, devices } from "@playwright/test";

async function selectPort(): Promise<number> {
  const configured = process.env.GIERA_TEST_VITE_PORT;
  if (configured !== undefined) {
    const port = Number(configured);
    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
      throw new Error("GIERA_TEST_VITE_PORT must be a valid TCP port");
    }
    return port;
  }
  for (let port = 5173; port <= 65_535; port += 1) {
    const probe = createServer();
    const available = await new Promise<boolean>((resolve) => {
      probe.once("error", () => resolve(false));
      probe.listen(port, "127.0.0.1", () => probe.close(() => resolve(true)));
    });
    if (available) return port;
  }
  throw new Error("No free Vite port found");
}

const vitePort = await selectPort();
const viteOrigin = `http://127.0.0.1:${vitePort}`;
const jsonOut = process.env.GIERA_JSON_OUT;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  globalTimeout: 1_800_000,
  reporter: jsonOut ? [["list"], ["json", { outputFile: jsonOut }]] : "list",
  use: {
    baseURL: viteOrigin,
    trace: "on-first-retry",
    viewport: { width: 1280, height: 720 },
    launchOptions: {
      args: [
        "--use-gl=angle",
        "--use-angle=metal",
        "--disable-background-timer-throttling",
        "--disable-backgrounding-occluded-windows",
        "--disable-renderer-backgrounding",
      ],
    },
  },
  projects: [
    {
      name: "chromium",
      testMatch: "**/{game,shots}.spec.ts",
      use: devices["Desktop Chrome"],
    },
    {
      name: "mechanics",
      testMatch: "**/{mechanics,tycoon-headquarters}.spec.ts",
      use: devices["Desktop Chrome"],
    },
    {
      name: "goldens",
      testMatch: "**/goldens.spec.ts",
      use: devices["Desktop Chrome"],
    },
    {
      name: "perf",
      testMatch: "**/perf.spec.ts",
      use: devices["Desktop Chrome"],
    },
    {
      name: "lan",
      testMatch: "**/lan.spec.ts",
      use: devices["Desktop Chrome"],
    },
    {
      name: "companion",
      testMatch: "**/companion.spec.ts",
      use: devices["Desktop Chrome"],
    },
  ],
  webServer: {
    command: `bun run dev --port ${vitePort}`,
    url: viteOrigin,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
