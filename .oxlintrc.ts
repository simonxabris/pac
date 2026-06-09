import { defineConfig } from "oxlint";

export default defineConfig({
  ignorePatterns: ["pac.config.ts", "test/**/*.config.ts"],
  options: {
    typeAware: true,
    typeCheck: true,
  },
  plugins: ["import"],
});
