import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/e2e/**/*.e2e.ts"],
    globalSetup: ["test/e2e/global-setup.ts"],
    testTimeout: 300_000,
    hookTimeout: 1_800_000,
    maxWorkers: 1,
    fileParallelism: false,
    passWithNoTests: true,
  },
});
