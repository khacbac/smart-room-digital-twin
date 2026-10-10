import tokens from "./tokens.js";

// Typed view of tokens.js for code that needs raw hex values (SVG, charts, native props).

export type ThemeColors = typeof tokens.light;
export type ColorName = keyof ThemeColors;
export type MetricTone = keyof typeof tokens.metricTones.light;

export const palette = { light: tokens.light, dark: tokens.dark };
export const metricTones = tokens.metricTones;
export const typeScale = tokens.typeScale;
export const fontFamily = tokens.fontFamily;
