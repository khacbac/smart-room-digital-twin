import type { CommandStatus } from "@srdt/contracts";
import { View } from "react-native";
import { useTheme } from "@/lib/theme/theme";
import { Text } from "./text";

/** Command status chip: open (accent), executed (normal), anything else failed (danger). */
export function StatusPill({ status }: { status: CommandStatus }) {
  const { colors } = useTheme();
  const look =
    status === "executed"
      ? { fg: colors["state-normal"], bg: colors["normal-tint"] }
      : status === "pending" || status === "sent"
        ? { fg: colors.accent, bg: colors["accent-tint"] }
        : { fg: colors["state-danger"], bg: colors["danger-tint"] };
  return (
    <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, backgroundColor: look.bg }}>
      <Text variant="caption" weight={600} color={look.fg}>
        {status}
      </Text>
    </View>
  );
}

/** "Auto" / "Manual" / "Unknown". */
export function Tag({ label }: { label: string }) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        paddingHorizontal: 10,
        paddingVertical: 3,
        borderRadius: 999,
        backgroundColor: colors["surface-2"],
        borderWidth: 1,
        borderColor: colors.border,
      }}
    >
      <Text variant="caption" weight={600} tone="muted">
        {label}
      </Text>
    </View>
  );
}
