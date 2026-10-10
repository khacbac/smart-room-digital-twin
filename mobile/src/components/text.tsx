import { Text as RNText, type TextProps } from "react-native";
import type { ColorName } from "@/lib/theme/colors";
import { fontFamily, typeScale } from "@/lib/theme/colors";
import { useTheme } from "@/lib/theme/theme";

export type Variant = keyof typeof typeScale;

export interface AppTextProps extends TextProps {
  variant?: Variant;
  tone?: ColorName;
  /** Overrides the variant's weight. */
  weight?: 400 | 600 | 700;
  /** Digits keep their width so live values do not jitter. */
  numeric?: boolean;
  color?: string;
}

/** Text in the app's type scale (mobile/specs/03-design-system.md §3). */
export function Text({ variant = "body", tone = "text", weight, numeric, color, style, ...rest }: AppTextProps) {
  const { colors } = useTheme();
  const t = typeScale[variant];
  const w = weight ?? (Number(t.weight) as 400 | 600 | 700);
  return (
    <RNText
      maxFontSizeMultiplier={variant === "metric" || variant === "display" ? 1.3 : 1.6}
      {...rest}
      style={[
        {
          fontFamily: fontFamily[w],
          fontSize: t.size,
          lineHeight: t.lineHeight,
          letterSpacing: t.tracking,
          color: color ?? colors[tone],
          textTransform: variant === "eyebrow" ? "uppercase" : undefined,
          fontVariant: numeric ? ["tabular-nums"] : undefined,
        },
        style,
      ]}
    />
  );
}
