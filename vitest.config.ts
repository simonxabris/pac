import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.spec.ts"],
    resolveSnapshotPath: (testPath, snapExtension) => {
      const relativeTestPath = path.relative(process.cwd(), testPath);
      return path.join("__snapshots__", `${relativeTestPath}${snapExtension}`);
    },
    coverage: {
      provider: "v8",
    },
  },
});
