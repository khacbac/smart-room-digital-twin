import { useEffect } from "react";
import { View } from "react-native";
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSpring } from "react-native-reanimated";

const WEIGHTS = [0.55, 0.85, 1, 0.8, 0.5];

/** Five bars that follow the microphone level. */
export function Waveform({ level, color }: { level: number; color: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 5, height: 40 }}>
      {WEIGHTS.map((w, i) => (
        <Bar key={i} level={level * w} color={color} />
      ))}
    </View>
  );
}

function Bar({ level, color }: { level: number; color: string }) {
  const reduced = useReducedMotion();
  const h = useSharedValue(6);
  useEffect(() => {
    const to = 6 + level * 34;
    h.value = reduced ? to : withSpring(to, { damping: 14, stiffness: 260 });
  }, [level, reduced, h]);
  const style = useAnimatedStyle(() => ({ height: h.value }));
  return <Animated.View style={[{ width: 6, borderRadius: 3, backgroundColor: color }, style]} />;
}
