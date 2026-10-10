import { useEffect, useRef, useState } from "react";
import { View, type LayoutChangeEvent } from "react-native";
import Svg, { Circle, G, Line, Path } from "react-native-svg";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { Easing, useAnimatedProps, useReducedMotion, useSharedValue, withTiming } from "react-native-reanimated";
import { WINDOW_ANGLE_MAX, WINDOW_ANGLE_MIN } from "@srdt/contracts";
import { Text } from "@/components/text";
import { haptics } from "@/lib/haptics";
import { useTheme } from "@/lib/theme/theme";

const AnimatedLine = Animated.createAnimatedComponent(Line);

// A quarter circle from 0° (closed, pointing right) to 90° (open, pointing up), pivot at
// the bottom-left like a window hinge. The thin needle is the angle the device reports;
// the big knob is the angle the user wants.

const SIZE = 200;
const PAD = 22;
const R = SIZE - PAD * 2;
const CX = PAD;
const CY = SIZE - PAD;

const toXY = (deg: number, r = R) => ({
  x: CX + r * Math.cos((deg * Math.PI) / 180),
  y: CY - r * Math.sin((deg * Math.PI) / 180),
});

export function AngleDial(props: {
  target: number;
  actual: number | null;
  onChange: (deg: number) => void;
  disabled?: boolean;
}) {
  const { colors } = useTheme();
  const reduced = useReducedMotion();
  const [scale, setScale] = useState(1);
  const lastTick = useRef(Math.floor(props.target / 10));

  const needle = useSharedValue(props.actual ?? 0);
  useEffect(() => {
    const to = props.actual ?? 0;
    needle.value = reduced ? to : withTiming(to, { duration: 600, easing: Easing.out(Easing.cubic) });
  }, [props.actual, reduced, needle]);
  const needleProps = useAnimatedProps(() => {
    const rad = (needle.value * Math.PI) / 180;
    return { x2: CX + (R - 16) * Math.cos(rad), y2: CY - (R - 16) * Math.sin(rad) };
  });

  const update = (deg: number) => {
    const clamped = Math.min(WINDOW_ANGLE_MAX, Math.max(WINDOW_ANGLE_MIN, Math.round(deg)));
    const tick = Math.floor(clamped / 10);
    if (tick !== lastTick.current) {
      lastTick.current = tick;
      haptics.tick();
    }
    props.onChange(clamped);
  };

  const fromTouch = (x: number, y: number) => {
    const dx = x / scale - CX;
    const dy = CY - y / scale;
    return (Math.atan2(Math.max(0, dy), Math.max(0, dx)) * 180) / Math.PI;
  };
  // Runs on the JS thread: each move only sets a number, and the haptic tick needs JS anyway.
  const pan = Gesture.Pan()
    .runOnJS(true)
    .enabled(!props.disabled)
    .minDistance(0)
    .onBegin((e) => update(fromTouch(e.x, e.y)))
    .onUpdate((e) => update(fromTouch(e.x, e.y)));

  const knob = toXY(props.target);
  const arc = (to: number) => {
    const end = toXY(to);
    return `M${CX + R} ${CY} A${R} ${R} 0 0 0 ${end.x} ${end.y}`;
  };

  return (
    <View
      onLayout={(e: LayoutChangeEvent) => setScale(Math.min(e.nativeEvent.layout.width - 96, SIZE) / SIZE)}
      style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 }}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel="Window opening angle"
      accessibilityValue={{ min: WINDOW_ANGLE_MIN, max: WINDOW_ANGLE_MAX, now: props.target, text: `${props.target} degrees` }}
      accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
      onAccessibilityAction={(e) => update(props.target + (e.nativeEvent.actionName === "increment" ? 5 : -5))}
    >
      <GestureDetector gesture={pan}>
        <View style={{ width: SIZE * scale, height: SIZE * scale, opacity: props.disabled ? 0.5 : 1 }}>
          <Svg width={SIZE * scale} height={SIZE * scale} viewBox={`0 0 ${SIZE} ${SIZE}`}>
            <Path d={arc(90)} stroke={colors["surface-2"]} strokeWidth={14} strokeLinecap="round" fill="none" />
            <Path d={arc(props.target)} stroke={colors.accent} strokeWidth={14} strokeLinecap="round" fill="none" opacity={0.35} />
            {[0, 30, 60, 90].map((deg) => {
              const a = toXY(deg, R + 12);
              const b = toXY(deg, R + 4);
              return <Line key={deg} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={colors.muted} strokeWidth={1.5} />;
            })}
            <G>
              <AnimatedLine x1={CX} y1={CY} stroke={colors.text} strokeWidth={2.5} strokeLinecap="round" animatedProps={needleProps} />
              <Circle cx={CX} cy={CY} r={6} fill={colors.text} />
            </G>
            <Circle cx={knob.x} cy={knob.y} r={15} fill={colors.accent} />
            <Circle cx={knob.x} cy={knob.y} r={6} fill={colors["accent-text"]} />
          </Svg>
        </View>
      </GestureDetector>
      <View pointerEvents="none" style={{ width: 88, gap: 2 }}>
        <Text variant="caption" tone="muted">
          Target
        </Text>
        <Text variant="metric" numeric tone="accent">
          {props.target}°
        </Text>
        <Text variant="caption" tone="muted" numeric style={{ marginTop: 6 }}>
          Window now
        </Text>
        <Text variant="heading" numeric>
          {props.actual == null ? "—" : `${props.actual}°`}
        </Text>
      </View>
    </View>
  );
}
