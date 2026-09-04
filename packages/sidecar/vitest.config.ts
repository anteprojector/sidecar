import { defineConfig } from "vitest/config";

const integration = process.env.SIDECAR_INTEGRATION === "1";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: integration ? [] : ["tests/integration.test.ts"],
    maxWorkers: 2,
    setupFiles: ["tests/setup.ts"],
  },
});
