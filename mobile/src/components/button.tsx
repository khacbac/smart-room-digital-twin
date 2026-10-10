import type { LucideIcon } from "lucide-react-native";
import { ActivityIndicator, View, type PressableProps } from "react-native";
import { useTheme } from "@/lib/theme/theme";
import { Text } from "./text";
import { Touchable } from "./touchable";

export type ButtonVariant = "primary" | "quiet" | "danger" | "outline";

export interface ButtonProps extends Omit<PressableProps, "children" | "style"> {
  label: string;
  icon?: LucideIcon;
  variant?: ButtonVariant;
  loading?: boolean;
  compact?: boolean;
  flex?: boolean;
}

/** 48 dp tall; a pending command swaps the icon for a spinner without changing the size. */
export function Button({ label, icon: Icon, variant = "primary", loading, compact, flex, disabled, ...rest }: ButtonProps) {
  const { colors } = useTheme();
  const look = {
    primary: { bg: colors.accent, fg: colors["accent-text"], line: colors.accent },
    quiet: { bg: colors["surface-2"], fg: colors.text, line: colors["surface-2"] },
    outline: { bg: colors.surface, fg: colors.text, line: colors.border },
    danger: { bg: colors["danger-tint"], fg: colors["state-danger"], line: colors["danger-line"] },
  }[variant];
  const off = disabled || loading;
  return (
    <Touchable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      disabled={off}
      android_ripple={{ color: colors.border, foreground: true }}
      style={({ pressed }) => ({
        flex: flex ? 1 : undefined,
        minHeight: compact ? 40 : 48,
        paddingHorizontal: compact ? 12 : 16,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: look.line,
        backgroundColor: look.bg,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        overflow: "hidden",
        opacity: disabled && !loading ? 0.45 : pressed ? 0.85 : 1,
        transform: [{ scale: pressed ? 0.98 : 1 }],
      })}
      {...rest}
    >
      <View style={{ width: 18, height: 18, alignItems: "center", justifyContent: "center" }}>
        {loading ? <ActivityIndicator size="small" color={look.fg} /> : Icon ? <Icon size={18} color={look.fg} /> : null}
      </View>
      <Text variant="label" color={look.fg} numberOfLines={1}>
        {label}
      </Text>
    </Touchable>
  );
}
