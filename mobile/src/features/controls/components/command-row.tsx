import type { CommandRecord } from "@srdt/contracts";
import { Bot, MousePointerClick, Sparkles } from "lucide-react-native";
import { View } from "react-native";
import { ACTION_LABEL, clockTime, toMs } from "@srdt/twin-core";
import { StatusPill } from "@/components/pill";
import { Text } from "@/components/text";
import { useTheme } from "@/lib/theme/theme";

const SOURCE_ICON = { dashboard: MousePointerClick, ai: Sparkles, api: Bot } as const;
const SOURCE_LABEL = { dashboard: "Manual", ai: "Voice assistant", api: "API" } as const;

export function CommandRow({ command: c, showLatency }: { command: CommandRecord; showLatency?: boolean }) {
  const { colors } = useTheme();
  const Icon = SOURCE_ICON[c.source];
  const created = toMs(c.createdAt);
  const acked = toMs(c.ackedAt);
  const latency =
    showLatency && c.status === "executed" && created !== null && acked !== null
      ? `acked in ${((acked - created) / 1000).toFixed(1)} s`
      : null;
  return (
    <View
      style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10 }}
      accessible
      accessibilityLabel={`${ACTION_LABEL[c.action]}${c.value != null ? ` ${c.value} degrees` : ""}, ${c.status}, ${SOURCE_LABEL[c.source]}`}
    >
      <Icon size={15} color={c.source === "ai" ? colors.accent : colors.muted} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="label" numberOfLines={1}>
          {ACTION_LABEL[c.action]}
          {c.value != null && c.action === "OPEN_WINDOW" ? ` ${c.value}°` : ""}
        </Text>
        {(c.reason || latency) && (
          <Text variant="caption" tone="muted" numberOfLines={1}>
            {c.reason ?? latency}
          </Text>
        )}
      </View>
      <StatusPill status={c.status} />
      <Text variant="caption" tone="muted" numeric>
        {clockTime(c.createdAt)}
      </Text>
    </View>
  );
}
