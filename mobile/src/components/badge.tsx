import type { DevicePresence } from "@srdt/contracts";
import { PRESENCE_LABEL } from "@srdt/twin-core";
import { View } from "react-native";
import { useTheme } from "@/lib/theme/theme";
import { Text } from "./text";

/** Dot + label pill, like the dashboard's `.badge`. */
export function Badge(props: { label: string; color: string; background: string; dot?: boolean }) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 999,
        backgroundColor: props.background,
      }}
    >
      {props.dot !== false && <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: props.color }} />}
      <Text variant="label" color={props.color} style={{ fontSize: 12 }}>
        {props.label}
      </Text>
    </View>
  );
}

export function PresenceBadge({ presence, stale }: { presence: DevicePresence; stale?: boolean }) {
  const { colors } = useTheme();
  const look =
    presence === "online"
      ? { color: colors["state-normal"], bg: colors["normal-tint"] }
      : presence === "offline"
        ? { color: colors.muted, bg: colors["surface-2"] }
        : { color: colors["state-uncomfortable"], bg: colors["uncomfortable-tint"] };
  return (
    <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
      <Badge label={PRESENCE_LABEL[presence]} color={look.color} background={look.bg} />
      {stale && (
        <Badge label="Stale data" color={colors["state-uncomfortable"]} background={colors["uncomfortable-tint"]} />
      )}
    </View>
  );
}
