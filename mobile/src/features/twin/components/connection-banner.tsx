import { useAtomValue } from "jotai";
import { RefreshCw } from "lucide-react-native";
import { View } from "react-native";
import { Text } from "@/components/text";
import { useTheme } from "@/lib/theme/theme";
import { connectionAtom, twinStatusAtom } from "../_atoms/state";

/** Thin notice while the live stream is down but older data is still on screen. */
export function ConnectionBanner() {
  const connection = useAtomValue(connectionAtom);
  const status = useAtomValue(twinStatusAtom);
  const { colors } = useTheme();
  if (status !== "ready" || connection === "live") return null;
  return (
    <View
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingHorizontal: 14,
        paddingVertical: 10,
        borderRadius: 12,
        backgroundColor: colors["uncomfortable-tint"],
      }}
    >
      <RefreshCw size={15} color={colors["state-uncomfortable"]} />
      <Text variant="label" color={colors["state-uncomfortable"]}>
        {connection === "reconnecting" ? "Live updates paused, reconnecting…" : "Connecting to live updates…"}
      </Text>
    </View>
  );
}
