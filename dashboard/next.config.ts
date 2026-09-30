import path from "node:path";
import type { NextConfig } from "next";

const config: NextConfig = {
  // Static HTML/JS in `out/`, so the dashboard can be served by Firebase Hosting (or any
  // static host). Everything live comes from the backend API at runtime.
  output: "export",
  // @srdt/contracts ships TypeScript source
  transpilePackages: ["@srdt/contracts"],
  // the pnpm workspace root, so Turbopack resolves packages/contracts
  turbopack: { root: path.join(import.meta.dirname, "..") },
};

export default config;
