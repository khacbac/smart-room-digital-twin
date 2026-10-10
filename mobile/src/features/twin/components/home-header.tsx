import { useAtomValue } from "jotai";
import { useRouter } from "expo-router";
import { Radio, Settings2 } from "lucide-react-native";
import { View } from "react-native";
import { ago, deriveRoomView } from "@srdt/twin-core";
import { PresenceBadge } from "@/components/badge";
import { IconButton } from "@/components/icon-button";
import { Text } from "@/components/text";
import { useNow } from "@/lib/hooks/use-now";
import { useTheme } from "@/lib/theme/theme";
import { latestTelemetryAtom } from "../_atoms/derived";
import { deviceAtom, lastTelemetryAtAtom } from "../_atoms/state";

export function HomeHeader() {
  const router = useRouter();
  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
        <View style={{ flex: 1, gap: 6 }}>
          <Text variant="eyebrow" tone="muted">
            My space · Overview
          </Text>
          <Text variant="display" accessibilityRole="header">
            Your room, at a glance
            <Text variant="display" tone="accent">
              .
            </Text>
          </Text>
        </View>
        <IconButton icon={Settings2} label="Settings" onPress={() => router.push("/settings")} />
      </View>
      <Text variant="body" tone="muted">
        A little insight. A more comfortable space.
      </Text>
      <DeviceLine />
    </View>
  );
}

/** Ticks every second; nothing else on Home re-renders with it. */
function DeviceLine() {
  const device = useAtomValue(deviceAtom);
  const live = useAtomValue(latestTelemetryAtom);
  const lastTelemetryAt = useAtomValue(lastTelemetryAtAtom);
  const now = useNow(1000);
  const { colors } = useTheme();
  if (!device) return null;
  const view = deriveRoomView(device, live, lastTelemetryAt, now);
  return (
    <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Radio size={16} color={colors.accent} />
        <Text variant="label">{device.name}</Text>
      </View>
      <PresenceBadge presence={device.presence} stale={view.stale} />
      <Text variant="caption" tone="muted">
        Last seen {ago(view.lastSeenAt, now)}
      </Text>
    </View>
  );
}
