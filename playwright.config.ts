import { defineConfig, devices } from "@playwright/test";

const jsonOut = process.env.GIERA_JSON_OUT;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: jsonOut ? [["list"], ["json", { outputFile: jsonOut }]] : "list",
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "on-first-retry",
    viewport: { width: 1280, height: 720 },
    launchOptions: {
      args: ["--use-gl=angle", "--use-angle=metal"],
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
      testMatch: "**/mechanics.spec.ts",
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
  ],
  webServer: {
    command: "bun run dev --port 5173",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
