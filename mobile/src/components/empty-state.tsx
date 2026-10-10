import type { LucideIcon } from "lucide-react-native";
import { View } from "react-native";
import { useTheme } from "@/lib/theme/theme";
import { Text } from "./text";

export function EmptyState(props: { icon: LucideIcon; title: string; description: string }) {
  const { colors } = useTheme();
  const Icon = props.icon;
  return (
    <View style={{ alignItems: "center", paddingVertical: 28, paddingHorizontal: 16, gap: 8 }}>
      <View
        style={{
          width: 52,
          height: 52,
          borderRadius: 26,
          backgroundColor: colors["surface-2"],
          alignItems: "center",
          justifyContent: "center",
          marginBottom: 4,
        }}
      >
        <Icon size={22} color={colors.muted} />
      </View>
      <Text variant="heading" style={{ textAlign: "center" }}>
        {props.title}
      </Text>
      <Text variant="body" tone="muted" style={{ textAlign: "center" }}>
        {props.description}
      </Text>
    </View>
  );
}
