import { useEffect, useRef } from "react";
import { useAtomValue } from "jotai";
import type { AssistantCommandResult } from "@srdt/contracts";
import { CircleAlert } from "lucide-react-native";
import { View } from "react-native";
import { ACTION_LABEL, apiErrorText, isOpenStatus } from "@srdt/twin-core";
import { StatusPill } from "@/components/pill";
import { Text } from "@/components/text";
import { haptics } from "@/lib/haptics";
import { useTheme } from "@/lib/theme/theme";
import { commandsAtom } from "@/features/twin/_atoms/state";

/** One command the assistant sent, with its status followed live over the stream. */
export function CommandResult({ result }: { result: AssistantCommandResult }) {
  const { colors } = useTheme();
  const live = useAtomValue(commandsAtom).find((c) => c.id === result.commandId);
  const status = live?.status ?? result.status;
  const announced = useRef(false);

  useEffect(() => {
    if (!status || announced.current || isOpenStatus(status)) return;
    announced.current = true;
    if (status === "executed") haptics.success();
    else haptics.error();
  }, [status]);

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        padding: 12,
        borderRadius: 12,
        backgroundColor: colors["surface-2"],
      }}
      accessible
      accessibilityLabel={`${ACTION_LABEL[result.action]}, ${status ?? result.error ?? ""}`}
    >
      <View style={{ flex: 1 }}>
        <Text variant="label">
          {ACTION_LABEL[result.action]}
          {result.value != null && result.action === "OPEN_WINDOW" ? ` ${result.value}°` : ""}
        </Text>
        {result.error && (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 }}>
            <CircleAlert size={12} color={colors["state-danger"]} />
            <Text variant="caption" tone="state-danger">
              {apiErrorText(result.error, result.error)}
            </Text>
          </View>
        )}
      </View>
      {status && <StatusPill status={status} />}
    </View>
  );
}
