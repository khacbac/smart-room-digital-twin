import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react-native";
import { View } from "react-native";
import { Text } from "@/components/text";
import { useTheme } from "@/lib/theme/theme";

export function ControlHeading(props: { icon: LucideIcon; title: string; subtitle: string; right?: ReactNode }) {
  const { colors } = useTheme();
  const Icon = props.icon;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 12 }}>
      <View
        style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: colors["surface-2"], alignItems: "center", justifyContent: "center" }}
      >
        <Icon size={19} color={colors.accent} />
      </View>
      <View style={{ flex: 1 }}>
        <Text variant="heading">{props.title}</Text>
        <Text variant="caption" tone="muted">
          {props.subtitle}
        </Text>
      </View>
      {props.right}
    </View>
  );
}
