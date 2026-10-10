import path from "node:path";
import type { NextConfig } from "next";

const config: NextConfig = {
  // Static HTML/JS in `out/`, so the dashboard can be served by Firebase Hosting (or any
  // static host). Everything live comes from the backend API at runtime.
  output: "export",
  // the shared packages ship TypeScript source
  transpilePackages: ["@srdt/contracts", "@srdt/twin-core"],
  // the pnpm workspace root, so Turbopack resolves packages/contracts
  turbopack: { root: path.join(import.meta.dirname, "..") },
};

export default config;
