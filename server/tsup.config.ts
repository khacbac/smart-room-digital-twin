import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  platform: "node",
  target: "node24",
  clean: true,
  sourcemap: true,
  // @srdt/contracts ships TypeScript source; bundle it instead of importing the .ts at runtime (it has no build step).
  noExternal: ["@srdt/contracts"],
});
