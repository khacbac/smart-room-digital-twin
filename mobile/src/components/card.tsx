import { View, type ViewProps } from "react-native";
import { useTheme } from "@/lib/theme/theme";

export interface CardProps extends ViewProps {
  /** Faded while the device is offline: the values are the last known, not live. */
  dimmed?: boolean;
  padded?: boolean;
  background?: string;
  borderColor?: string;
}

export function Card({ dimmed, padded = true, background, borderColor, style, ...rest }: CardProps) {
  const { colors, scheme } = useTheme();
  return (
    <View
      {...rest}
      style={[
        {
          backgroundColor: background ?? colors.surface,
          borderColor: borderColor ?? colors.border,
          borderWidth: 1,
          borderRadius: 18,
          padding: padded ? 20 : 0,
          opacity: dimmed ? 0.55 : 1,
          // a whisper of shadow like the dashboard; Android draws it only on light
          shadowColor: "#23362a",
          shadowOpacity: scheme === "light" ? 0.04 : 0,
          shadowRadius: 14,
          shadowOffset: { width: 0, height: 3 },
        },
        style,
      ]}
    />
  );
}
