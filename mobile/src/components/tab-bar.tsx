import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import type { LucideIcon } from "lucide-react-native";
import { Activity, History, House, Mic, SlidersHorizontal } from "lucide-react-native";
import { useSetAtom } from "jotai";
import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { haptics } from "@/lib/haptics";
import { useTheme } from "@/lib/theme/theme";
import { voiceOpenAtom } from "@/features/voice/_atoms/session";
import { Text } from "./text";
import { Touchable } from "./touchable";

export const TAB_BAR_HEIGHT = 64;

const ICONS: Record<string, LucideIcon> = {
  index: House,
  trends: Activity,
  controls: SlidersHorizontal,
  activity: History,
};

/** Two tabs, the assistant's mic, two tabs. */
export function TabBar({ state, descriptors, navigation, badges }: BottomTabBarProps & { badges: Record<string, boolean> }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const openVoice = useSetAtom(voiceOpenAtom);

  const tab = (index: number) => {
    const route = state.routes[index];
    if (!route) return null;
    const { options } = descriptors[route.key]!;
    const focused = state.index === index;
    const Icon = ICONS[route.name] ?? House;
    const label = typeof options.title === "string" ? options.title : route.name;
    const badge = badges[route.name];
    return (
      <Pressable
        key={route.key}
        accessibilityRole="tab"
        accessibilityState={{ selected: focused }}
        accessibilityLabel={badge ? `${label}, new alerts` : label}
        onPress={() => {
          const event = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
          if (!focused && !event.defaultPrevented) navigation.navigate(route.name, route.params);
        }}
        style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 3 }}
      >
        <View style={{ paddingHorizontal: 16, paddingVertical: 4, borderRadius: 999, backgroundColor: focused ? colors["accent-tint"] : "transparent" }}>
          <Icon size={22} color={focused ? colors.accent : colors.muted} />
          {badge && (
            <View
              style={{
                position: "absolute",
                top: 2,
                right: 12,
                width: 9,
                height: 9,
                borderRadius: 5,
                backgroundColor: colors["state-danger"],
                borderWidth: 1.5,
                borderColor: colors.surface,
              }}
            />
          )}
        </View>
        <Text variant="caption" weight={600} color={focused ? colors.accent : colors.muted} style={{ fontSize: 11 }} maxFontSizeMultiplier={1.2}>
          {label}
        </Text>
      </Pressable>
    );
  };

  return (
    <View
      style={{
        flexDirection: "row",
        height: TAB_BAR_HEIGHT + insets.bottom,
        paddingBottom: insets.bottom,
        backgroundColor: colors.surface,
        borderTopWidth: 1,
        borderTopColor: colors.border,
      }}
    >
      {tab(0)}
      {tab(1)}
      <View style={{ width: 76, alignItems: "center" }}>
        <Touchable
          accessibilityRole="button"
          accessibilityLabel="Ask your room by voice"
          onPress={() => {
            haptics.press();
            openVoice(true);
          }}
          style={({ pressed }) => ({
            marginTop: -18,
            width: 58,
            height: 58,
            borderRadius: 29,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: colors.accent,
            borderWidth: 4,
            borderColor: colors.surface,
            transform: [{ scale: pressed ? 0.94 : 1 }],
            shadowColor: "#000",
            shadowOpacity: 0.18,
            shadowRadius: 8,
            shadowOffset: { width: 0, height: 3 },
            elevation: 6,
          })}
        >
          <Mic size={24} color={colors["accent-text"]} />
        </Touchable>
      </View>
      {tab(2)}
      {tab(3)}
    </View>
  );
}
