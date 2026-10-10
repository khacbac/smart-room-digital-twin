import { useEffect, useState } from "react";
import { Pressable, View, type LayoutChangeEvent } from "react-native";
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSpring } from "react-native-reanimated";
import { useTheme } from "@/lib/theme/theme";
import { Text } from "./text";

export interface Segment<T extends string> {
  value: T;
  label: string;
  /** Small coloured dot before the label (chart series). */
  dot?: string;
}

/** 2–3 options; the selected thumb slides with a spring. */
export function SegmentedControl<T extends string>(props: {
  segments: Segment<T>[];
  value: T;
  onChange: (value: T) => void;
  compact?: boolean;
  label?: string;
}) {
  const { colors, scheme } = useTheme();
  const reduced = useReducedMotion();
  const [width, setWidth] = useState(0);
  const index = Math.max(
    0,
    props.segments.findIndex((s) => s.value === props.value),
  );
  const segWidth = width / props.segments.length;
  const x = useSharedValue(0);

  useEffect(() => {
    const to = index * segWidth;
    x.value = reduced ? to : withSpring(to, { damping: 18, stiffness: 220 });
  }, [index, segWidth, reduced, x]);

  const thumb = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  const height = props.compact ? 34 : 40;

  return (
    <View
      accessibilityRole="tablist"
      accessibilityLabel={props.label}
      onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width - 6)}
      style={{ flexDirection: "row", padding: 3, borderRadius: 12, backgroundColor: colors["surface-2"], height: height + 6 }}
    >
      {width > 0 && (
        <Animated.View
          style={[
            {
              position: "absolute",
              top: 3,
              left: 3,
              width: segWidth,
              height,
              borderRadius: 10,
              backgroundColor: scheme === "dark" ? colors.border : colors.surface,
              shadowColor: "#23362a",
              shadowOpacity: 0.08,
              shadowRadius: 4,
              shadowOffset: { width: 0, height: 1 },
              elevation: scheme === "dark" ? 0 : 1,
            },
            thumb,
          ]}
        />
      )}
      {props.segments.map((s) => {
        const active = s.value === props.value;
        return (
          <Pressable
            key={s.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            onPress={() => props.onChange(s.value)}
            style={{ flex: 1, height, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 }}
          >
            {s.dot && <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: s.dot }} />}
            <Text variant="label" tone={active ? "text" : "muted"} numberOfLines={1}>
              {s.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
