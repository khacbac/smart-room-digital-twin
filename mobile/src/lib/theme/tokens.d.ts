type Scheme = Record<
  | "bg"
  | "surface"
  | "surface-2"
  | "border"
  | "grid"
  | "text"
  | "muted"
  | "accent"
  | "accent-text"
  | "state-normal"
  | "state-uncomfortable"
  | "state-warning"
  | "state-danger"
  | "series-temp"
  | "series-hum"
  | "series-aq"
  | "normal-tint"
  | "uncomfortable-tint"
  | "warning-tint"
  | "danger-tint"
  | "danger-line"
  | "accent-tint",
  string
>;
type Tone = { card: string; line: string; disc: string; icon: string };
type Tones = Record<"peach" | "blue" | "sand" | "sage" | "lilac", Tone>;
type TypeStyle = { size: number; lineHeight: number; weight: "400" | "600" | "700"; tracking: number };

declare const tokens: {
  light: Scheme;
  dark: Scheme;
  metricTones: { light: Tones; dark: Tones };
  typeScale: Record<
    "display" | "title" | "heading" | "metric" | "metric-unit" | "body" | "label" | "caption" | "eyebrow",
    TypeStyle
  >;
  fontFamily: Record<400 | 600 | 700, string>;
  mix(hex: string, base: string, pct: number): string;
};
export default tokens;
