import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "xbox-probe.spec.ts",
  fullyParallel: false,
  workers: 1,
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://127.0.0.1:4174",
    launchOptions: { args: ["--use-gl=angle", "--use-angle=metal"] },
  },
  webServer: {
    command: "bun scripts/serve-xbox-probe.ts",
    url: "http://127.0.0.1:4174/probe.html",
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
