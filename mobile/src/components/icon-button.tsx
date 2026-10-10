import type { LucideIcon } from "lucide-react-native";
import { useTheme } from "@/lib/theme/theme";
import { Touchable } from "./touchable";

export function IconButton(props: { icon: LucideIcon; label: string; onPress: () => void; size?: number }) {
  const { colors } = useTheme();
  const Icon = props.icon;
  const size = props.size ?? 44;
  return (
    <Touchable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      onPress={props.onPress}
      hitSlop={4}
      style={({ pressed }) => ({
        width: size,
        height: size,
        borderRadius: size / 2,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: pressed ? colors["surface-2"] : colors.surface,
        borderWidth: 1,
        borderColor: colors.border,
      })}
    >
      <Icon size={20} color={colors.text} />
    </Touchable>
  );
}
