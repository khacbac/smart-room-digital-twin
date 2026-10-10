import type { EventRecord } from "@srdt/contracts";
import { Activity, CircleAlert } from "lucide-react-native";
import { View } from "react-native";
import { clockTime } from "@srdt/twin-core";
import { Text } from "@/components/text";
import { useTheme } from "@/lib/theme/theme";

/** "STATE_CHANGED" → "State changed". */
export function eventLabel(type: string): string {
  const words = type.toLowerCase().split("_");
  return words.map((w, i) => (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w)).join(" ");
}

export function eventText(e: EventRecord): string {
  const reasons = e.data.reasons;
  return e.type === "STATE_CHANGED" && Array.isArray(reasons) && reasons.length > 0
    ? `${e.message} (${reasons.join(", ")})`
    : e.message;
}

export function EventRow({ event: e }: { event: EventRecord }) {
  const { colors } = useTheme();
  const tone =
    e.severity === "critical"
      ? { fg: colors["state-danger"], bg: colors["danger-tint"] }
      : e.severity === "warning"
        ? { fg: colors["state-warning"], bg: colors["warning-tint"] }
        : { fg: colors.accent, bg: colors["accent-tint"] };
  const Icon = e.severity === "info" ? Activity : CircleAlert;
  return (
    <View style={{ flexDirection: "row", gap: 12, paddingVertical: 12 }} accessible accessibilityLabel={`${eventLabel(e.type)}, ${e.severity}. ${eventText(e)}`}>
      <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: tone.bg, alignItems: "center", justifyContent: "center" }}>
        <Icon size={17} color={tone.fg} />
      </View>
      <View style={{ flex: 1, gap: 3 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text variant="label" style={{ flexShrink: 1 }} numberOfLines={1}>
            {eventLabel(e.type)}
          </Text>
          <View style={{ paddingHorizontal: 7, paddingVertical: 1, borderRadius: 999, backgroundColor: tone.bg }}>
            <Text variant="caption" weight={600} color={tone.fg} style={{ fontSize: 11 }}>
              {e.severity}
            </Text>
          </View>
          <View style={{ flex: 1 }} />
          <Text variant="caption" tone="muted" numeric>
            {clockTime(e.createdAt)}
          </Text>
        </View>
        <Text variant="caption" tone="muted">
          {eventText(e)}
        </Text>
      </View>
    </View>
  );
}
