import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  platform: "node",
  target: "node24",
  clean: true,
  sourcemap: true,
  // the shared packages ship TypeScript source; bundle them instead of importing the .ts at runtime (no build step).
  noExternal: ["@srdt/contracts", "@srdt/twin-core"],
});
