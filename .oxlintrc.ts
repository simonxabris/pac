import { defineConfig } from "oxlint";

export default defineConfig({
  ignorePatterns: ["paac.config.ts", "test/**/*.config.ts"],
  options: {
    typeAware: true,
    typeCheck: true,
  },
  plugins: ["import"],
});
