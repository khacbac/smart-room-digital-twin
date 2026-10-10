// Single source of the app's colours and type scale. CommonJS so tailwind.config.js can
// read it too. Hex values come from dashboard/src/app/globals.css (:root and the dark
// media query): change them there first, then here.

/** Mixes `pct` % of `hex` into `base` (like CSS color-mix in srgb). */
function mix(hex, base, pct) {
  const a = parseInt(hex.slice(1), 16);
  const b = parseInt(base.slice(1), 16);
  const ch = (n, shift) => (n >> shift) & 255;
  const out = [16, 8, 0].map((s) => Math.round(ch(a, s) * (pct / 100) + ch(b, s) * (1 - pct / 100)));
  return `#${out.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

function scheme(c) {
  return {
    ...c,
    // tints used by badges, banners and the danger button (dashboard's color-mix values)
    "normal-tint": mix(c["state-normal"], c.surface, 8),
    "uncomfortable-tint": mix(c["state-uncomfortable"], c.surface, 10),
    "warning-tint": mix(c["state-warning"], c.surface, 10),
    "danger-tint": mix(c["state-danger"], c.surface, 6),
    "danger-line": mix(c["state-danger"], c.surface, 22),
    "accent-tint": mix(c.accent, c.surface, 12),
  };
}

const light = scheme({
  bg: "#f6f7f4",
  surface: "#ffffff",
  "surface-2": "#f4f5f1",
  border: "#e5e8e1",
  grid: "#edf0e9",
  text: "#26382f",
  muted: "#657369",
  accent: "#527562",
  "accent-text": "#ffffff",
  "state-normal": "#397454",
  "state-uncomfortable": "#9b741d",
  "state-warning": "#ba6728",
  "state-danger": "#be4949",
  "series-temp": "#c88967",
  "series-hum": "#74a7c3",
  "series-aq": "#849b78",
});

const dark = scheme({
  bg: "#19211d",
  surface: "#222c25",
  "surface-2": "#2b352c",
  border: "#354035",
  grid: "#313b32",
  text: "#e2e7dd",
  muted: "#a0ac9c",
  accent: "#8da58a",
  "accent-text": "#19251b",
  "state-normal": "#92bb8d",
  "state-uncomfortable": "#dbc479",
  "state-warning": "#dfac78",
  "state-danger": "#e9948e",
  "series-temp": "#d8a080",
  "series-hum": "#87b7c9",
  "series-aq": "#b1c29a",
});

// Metric card tones: `bg` is the icon disc, `color` the icon; the card itself is a 38 %
// tint of `bg` on white (light) or the plain surface (dark), like the dashboard.
const tones = {
  peach: { bg: "#f6e4d9", color: "#b98463", line: "#f1e5db" },
  blue: { bg: "#e1edf5", color: "#6891ad", line: "#e2ecef" },
  sand: { bg: "#f5eed8", color: "#b39955", line: "#f1ecdb" },
  sage: { bg: "#e4eddd", color: "#729663", line: "#e4ecde" },
  lilac: { bg: "#ebe5f2", color: "#9885ab", line: "#e9e6ed" },
};

function metricTones(c, isDark) {
  return Object.fromEntries(
    Object.entries(tones).map(([name, t]) => [
      name,
      isDark
        ? { card: c.surface, line: c.border, disc: mix(t.bg, c.surface, 14), icon: c.text }
        : { card: mix(t.bg, "#ffffff", 38), line: t.line, disc: t.bg, icon: t.color },
    ]),
  );
}

const typeScale = {
  display: { size: 30, lineHeight: 36, weight: "600", tracking: -1 },
  title: { size: 22, lineHeight: 28, weight: "600", tracking: -0.5 },
  heading: { size: 17, lineHeight: 22, weight: "600", tracking: -0.35 },
  metric: { size: 34, lineHeight: 40, weight: "600", tracking: -1 },
  "metric-unit": { size: 15, lineHeight: 20, weight: "600", tracking: 0 },
  body: { size: 15, lineHeight: 22, weight: "400", tracking: 0 },
  label: { size: 13, lineHeight: 18, weight: "600", tracking: 0 },
  caption: { size: 12, lineHeight: 16, weight: "400", tracking: 0 },
  eyebrow: { size: 11, lineHeight: 14, weight: "700", tracking: 1.2 },
};

/** Nunito Sans family name per weight (as registered by expo-font). */
const fontFamily = {
  400: "NunitoSans_400Regular",
  600: "NunitoSans_600SemiBold",
  700: "NunitoSans_700Bold",
};

module.exports = { light, dark, metricTones: { light: metricTones(light, false), dark: metricTones(dark, true) }, typeScale, fontFamily, mix };
