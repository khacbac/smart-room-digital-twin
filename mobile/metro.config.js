const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");

// Expo's default config already knows pnpm workspaces (watch folders, symlinks). The only
// extra is keeping Metro out of the other apps: the dashboard has its own React 19.3.
const config = getDefaultConfig(__dirname);
const root = path.resolve(__dirname, "..");
const escape = (p) => p.replace(/[/\\^$*+?.()|[\]{}]/g, "\\$&");

config.resolver.blockList = [
  ...[].concat(config.resolver.blockList ?? []),
  new RegExp(`^${escape(path.join(root, "dashboard"))}/.*`),
  new RegExp(`^${escape(path.join(root, "server"))}/.*`),
  new RegExp(`^${escape(path.join(root, "device"))}/.*`),
  new RegExp(`^${escape(path.join(root, "ml"))}/.*`),
];

module.exports = withNativeWind(config, { input: "./global.css" });
