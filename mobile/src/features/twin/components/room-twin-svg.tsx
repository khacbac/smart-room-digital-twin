import { useEffect } from "react";
import type { EdgeState } from "@srdt/contracts";
import { STATE_LABEL } from "@srdt/twin-core";
import Svg, { Circle, Defs, Ellipse, G, LinearGradient, Path, Rect, Stop } from "react-native-svg";
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedProps,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { useTheme } from "@/lib/theme/theme";

// Port of dashboard/src/components/RoomTwin.tsx (same 680×350 scene and rules). Every
// live part mirrors reported device state; nothing is animated ahead of the device.

const AnimatedRect = Animated.createAnimatedComponent(Rect);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const AnimatedPath = Animated.createAnimatedComponent(Path);

export interface TwinView {
  edgeState: EdgeState | null;
  windowAngle: number | null;
  buzzer: boolean | null;
  light: number | null;
  airQuality: number | null;
  presence: boolean | null;
}

const OFF = "#d8d9cd";
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

export function RoomTwinSvg({ view }: { view: TwinView }) {
  const { colors } = useTheme();
  const reduced = useReducedMotion();
  const angle = view.windowAngle ?? 0;
  const sashTarget = Math.max(3, 89 * Math.cos((angle * Math.PI) / 180));
  const shade = view.light == null ? 0 : 0.28 * (1 - clamp01(view.light / 300));
  const haze = view.airQuality == null ? 0 : 0.2 * clamp01((view.airQuality - 300) / 700);

  const sash = useSharedValue(sashTarget);
  useEffect(() => {
    sash.value = reduced ? sashTarget : withTiming(sashTarget, { duration: 600, easing: Easing.out(Easing.cubic) });
  }, [sashTarget, reduced, sash]);
  const sashProps = useAnimatedProps(() => ({ width: sash.value }));

  const blinking = view.edgeState === "WARNING";
  const led = useSharedValue(1);
  useEffect(() => {
    if (blinking && !reduced) led.value = withRepeat(withSequence(withTiming(0.25, { duration: 500 }), withTiming(1, { duration: 500 })), -1);
    else {
      cancelAnimation(led);
      led.value = 1;
    }
  }, [blinking, reduced, led]);
  const ledProps = useAnimatedProps(() => ({ opacity: led.value }));

  const waves = useSharedValue(1);
  useEffect(() => {
    if (view.buzzer && !reduced) waves.value = withRepeat(withSequence(withTiming(0.2, { duration: 600 }), withTiming(1, { duration: 600 })), -1);
    else {
      cancelAnimation(waves);
      waves.value = 1;
    }
  }, [view.buzzer, reduced, waves]);
  const waveProps = useAnimatedProps(() => ({ opacity: waves.value }));

  const label = `Live room: ${view.edgeState ? STATE_LABEL[view.edgeState] : "unknown"}, window ${
    view.windowAngle == null ? "unknown" : `${angle} degrees`
  }, alarm ${view.buzzer == null ? "unknown" : view.buzzer ? "on" : "off"}`;

  return (
    <Svg viewBox="0 0 680 350" width="100%" height="100%" accessible accessibilityLabel={label} preserveAspectRatio="xMidYMid slice">
      <Defs>
        <LinearGradient id="room-wall" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#f3eee6" />
          <Stop offset="1" stopColor="#e5ddd0" />
        </LinearGradient>
        <LinearGradient id="room-floor" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#e2cfb6" />
          <Stop offset="1" stopColor="#cbb190" />
        </LinearGradient>
        <LinearGradient id="window-sky" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#c3dfdf" />
          <Stop offset="1" stopColor="#edf4df" />
        </LinearGradient>
      </Defs>
      <Rect width="680" height="350" fill="#f4f1eb" />
      <Path d="M70 40H600V235H70Z" fill="url(#room-wall)" />
      <Path d="M70 40L20 10V275L70 235Z" fill="#d4cbbb" />
      <Path d="M600 40L660 10V275L600 235Z" fill="#e3dbce" />
      <Path d="M70 235H600L660 330H20Z" fill="url(#room-floor)" />
      <G stroke="#bea582" opacity={0.4}>
        <Path d="M85 235L45 330M160 235L140 330M250 235L240 330M345 235V330M440 235L450 330M530 235L550 330M590 235L625 330M45 280H630" />
      </G>
      {/* Window sash narrows as the actual servo opens it. */}
      <G transform="translate(422 64)">
        <Rect width="120" height="121" rx="2" fill="url(#window-sky)" stroke="#8c9d91" strokeWidth="7" />
        <Path d="M5 100Q35 62 65 100Q90 74 118 94V118H5Z" fill="#aac5a0" />
        <AnimatedRect
          x="4"
          y="4"
          height="113"
          fill="#e4f0e8"
          fillOpacity={0.62}
          stroke="#8c9d91"
          strokeWidth="3"
          animatedProps={sashProps}
        />
        <Path d="M95 130H122" stroke="#a69681" strokeWidth="3" />
      </G>
      {/* Framed art, lamp and a furnished room. */}
      <Rect x="194" y="65" width="105" height="82" fill="#fcf8ef" stroke="#aa9071" strokeWidth="5" />
      <Circle cx="229" cy="95" r="17" fill="#d3a67e" />
      <Path d="M198 142Q229 104 250 129Q275 98 296 142" fill="#a4b39a" />
      <Path d="M365 113V240" stroke="#917f67" strokeWidth="4" />
      <Ellipse cx="365" cy="242" rx="21" ry="5" fill="#917f67" />
      <Path d="M338 114L348 82H381L391 114Z" fill="#f8f3e4" />
      <Ellipse cx="264" cy="283" rx="142" ry="34" fill="#ece5d7" />
      <Rect x="133" y="171" width="193" height="75" rx="14" fill="#b5bda5" />
      <Rect x="133" y="204" width="193" height="46" rx="10" fill="#9ea88e" />
      <Rect x="126" y="187" width="25" height="61" rx="8" fill="#a9b398" />
      <Rect x="312" y="187" width="25" height="61" rx="8" fill="#a9b398" />
      <Rect x="160" y="179" width="43" height="37" rx="6" fill="#eadfc9" transform="rotate(-8 180 198)" />
      <Rect x="262" y="178" width="42" height="39" rx="6" fill="#d4a688" transform="rotate(8 280 198)" />
      <Path d="M147 249V258M314 249V258" stroke="#826a51" strokeWidth="5" />
      <Ellipse cx="274" cy="273" rx="53" ry="15" fill="#ae8b67" />
      <Path d="M239 280L234 304M309 280L314 304" stroke="#8c7154" strokeWidth="5" />
      <Rect x="258" y="253" width="24" height="12" rx="3" fill="#f0e6d3" />
      <G transform="translate(561 228)">
        <Path d="M-14 0L-9 31H10L15 0" fill="#bc936e" />
        <Path
          d="M0 2V-58M0-25Q-36-55-19-60Q-6-63 0-25M0-13Q36-43 22-48Q9-50 0-13M0-41Q-18-76-5-81Q11-73 0-41"
          fill="#7b9770"
          stroke="#708963"
          strokeWidth="2"
        />
      </G>
      {/* Device LEDs preserve the firmware's state mapping. */}
      <G transform="translate(91 100)">
        <Rect x="-9" y="-12" width="27" height="74" rx="7" fill="#faf7ef" stroke="#c8c4b7" />
        <Circle cx="4" cy="3" r="5" fill={view.edgeState === "DANGER" ? colors["state-danger"] : OFF} />
        <AnimatedCircle
          cx="4"
          cy="25"
          r="5"
          fill={view.edgeState === "WARNING" || view.edgeState === "UNCOMFORTABLE" ? colors["state-uncomfortable"] : OFF}
          animatedProps={ledProps}
        />
        <Circle cx="4" cy="47" r="5" fill={view.edgeState === "NORMAL" ? colors["state-normal"] : OFF} />
      </G>
      <G transform="translate(342 168)">
        <Circle r="11" fill="#eee8db" stroke="#b8ae9e" />
        <Path d="M-4-3H0L4-6V6L0 3H-4Z" fill="#928b7d" />
        {view.buzzer ? (
          <AnimatedPath
            d="M15-8Q25 0 15 8M20-12Q35 0 20 12"
            fill="none"
            stroke={colors["state-danger"]}
            strokeWidth="2"
            animatedProps={waveProps}
          />
        ) : null}
      </G>
      {view.presence ? (
        <G transform="translate(420 225)" fill="#667f72">
          <Circle cy="-15" r="10" />
          <Rect x="-12" width="24" height="34" rx="10" />
          <Path d="M-6 31V56M6 31V56" stroke="#667f72" strokeWidth="7" strokeLinecap="round" />
        </G>
      ) : null}
      <Rect width="680" height="350" fill="#243428" opacity={shade} />
      <Rect width="680" height="350" fill="#b68979" opacity={haze} />
    </Svg>
  );
}
