import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.ts"],
    exclude: ["tests/e2e/**", "node_modules/**"],
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "json-summary"],
      include: ["src/**/*.ts"],
      reportsDirectory: "coverage",
      thresholds: {
        statements: 50,
        branches: 44,
        functions: 42,
        lines: 51,
        "src/shared/rng.ts": {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
        "src/shared/blocks.ts": {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
        "src/shared/chunk-worker-protocol.ts": {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
        "src/shared/mesher.ts": {
          statements: 95,
          branches: 95,
          functions: 100,
          lines: 100,
        },
        "src/shared/physics.ts": {
          statements: 90,
          branches: 85,
          functions: 100,
          lines: 90,
        },
        "src/shared/chunk.ts": {
          statements: 85,
          branches: 85,
          functions: 100,
          lines: 95,
        },
        "src/client/net/client.ts": {
          statements: 85,
          branches: 70,
          functions: 80,
          lines: 85,
        },
        "src/client/persist/db.ts": {
          statements: 40,
          branches: 60,
          functions: 30,
          lines: 45,
        },
        "src/client/game/hud.ts": {
          statements: 55,
          branches: 25,
          functions: 30,
          lines: 55,
        },
        "src/client/entities/drops.ts": {
          statements: 50,
          functions: 70,
          lines: 50,
        },
      },
    },
  },
});
