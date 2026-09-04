import { defineConfig } from "vitest/config";

const integration = process.env.SIDECAR_INTEGRATION === "1";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: integration ? [] : ["tests/integration.test.ts"],
    // Integration tests clone, sync, and spawn the CLI; the default five
    // seconds reports finished work as a timeout on a loaded machine.
    ...(integration ? { testTimeout: 60_000 } : {}),
    maxWorkers: 2,
    setupFiles: ["tests/setup.ts"],
  },
});
