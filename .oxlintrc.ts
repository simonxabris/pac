import { defineConfig } from "oxlint";

export default defineConfig({
  ignorePatterns: ["paac.config.ts"],
  options: {
    typeAware: true,
    typeCheck: true,
  },
  plugins: ["import"],
});
