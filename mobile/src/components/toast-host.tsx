import { useAtomValue, useSetAtom } from "jotai";
import { CircleAlert, CircleCheck, Info } from "lucide-react-native";
import { Pressable, View } from "react-native";
import Animated, { FadeInDown, FadeOutDown, LinearTransition } from "react-native-reanimated";
import { dismissToastAtom, toastsAtom } from "@/lib/toast";
import { useTheme } from "@/lib/theme/theme";
import { Text } from "./text";

/** Stack of toasts above the tab bar; tap to dismiss. */
export function ToastHost({ bottom }: { bottom: number }) {
  const toasts = useAtomValue(toastsAtom);
  const dismiss = useSetAtom(dismissToastAtom);
  const { colors } = useTheme();
  return (
    <View
      pointerEvents="box-none"
      accessibilityLiveRegion="polite"
      style={{ position: "absolute", left: 16, right: 16, bottom, gap: 8 }}
    >
      {toasts.map((t) => {
        const tone =
          t.tone === "success"
            ? { color: colors["state-normal"], Icon: CircleCheck }
            : t.tone === "error"
              ? { color: colors["state-danger"], Icon: CircleAlert }
              : { color: colors.accent, Icon: Info };
        return (
          <Animated.View key={t.id} entering={FadeInDown.duration(220)} exiting={FadeOutDown.duration(180)} layout={LinearTransition}>
            <Pressable
              onPress={() => dismiss(t.id)}
              accessibilityRole="alert"
              accessibilityHint="Dismisses the message"
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 10,
                padding: 14,
                paddingLeft: 16,
                borderRadius: 14,
                backgroundColor: colors.surface,
                borderWidth: 1,
                borderColor: colors.border,
                borderLeftWidth: 4,
                borderLeftColor: tone.color,
                shadowColor: "#000",
                shadowOpacity: 0.12,
                shadowRadius: 12,
                shadowOffset: { width: 0, height: 4 },
                elevation: 4,
              }}
            >
              <tone.Icon size={18} color={tone.color} />
              <Text variant="label" weight={600} style={{ flex: 1 }}>
                {t.text}
              </Text>
            </Pressable>
          </Animated.View>
        );
      })}
    </View>
  );
}
