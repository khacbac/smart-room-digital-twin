import { useMemo, useRef, useState } from "react";
import { View, type LayoutChangeEvent } from "react-native";
import { area, curveMonotoneX, line } from "d3-shape";
import { scaleLinear } from "d3-scale";
import Svg, { Circle, Defs, G, Line, LinearGradient, Path, Stop, Text as SvgText } from "react-native-svg";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { HISTORY_MS, clockTime } from "@srdt/twin-core";
import { Text } from "@/components/text";
import { haptics } from "@/lib/haptics";
import { fontFamily } from "@/lib/theme/colors";
import { STATE_TOKEN } from "@/lib/theme/state-color";
import { useTheme } from "@/lib/theme/theme";
import { downsample, nearest, type Point, type SeriesDef } from "../_lib/series";

const HEIGHT = 260;
const M = { top: 12, right: 34, bottom: 24, left: 36 };

const hhmm = (t: number) => clockTime(t).slice(0, 5);

/** 15-minute line chart with threshold lines and touch-to-read (drag along the chart). */
export function TrendChart(props: { series: SeriesDef; points: Point[]; now: number }) {
  const { colors } = useTheme();
  const [width, setWidth] = useState(0);
  const [scrub, setScrub] = useState<number | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const color = colors[props.series.color];
  const innerW = Math.max(0, width - M.left - M.right);
  const innerH = HEIGHT - M.top - M.bottom;

  const pts = useMemo(() => downsample(props.points, 300), [props.points]);

  const { x, y, yTicks, linePath, areaPath } = useMemo(() => {
    const x = scaleLinear().domain([props.now - HISTORY_MS, props.now]).range([0, innerW]);
    let domain = props.series.domain;
    if (!domain) {
      const vals = pts.map((p) => p.v).filter((v): v is number => v !== null);
      const lo = vals.length ? Math.floor(Math.min(...vals) - 1) : 20;
      const hi = vals.length ? Math.ceil(Math.max(...vals) + 1) : 35;
      domain = [lo, hi];
    }
    const y = scaleLinear().domain(domain).range([innerH, 0]).nice(4);
    const visible = pts.filter((p) => p.t >= props.now - HISTORY_MS - 5000);
    const linePath = line<Point>()
      .defined((p) => p.v !== null)
      .x((p) => x(p.t))
      .y((p) => y(p.v ?? 0))
      .curve(curveMonotoneX)(visible);
    const areaPath = area<Point>()
      .defined((p) => p.v !== null)
      .x((p) => x(p.t))
      .y0(innerH)
      .y1((p) => y(p.v ?? 0))
      .curve(curveMonotoneX)(visible);
    return { x, y, yTicks: y.ticks(4), linePath, areaPath };
  }, [pts, props.now, props.series.domain, innerW, innerH]);

  const xTicks = useMemo(() => {
    const start = props.now - HISTORY_MS;
    return [0, 1, 2, 3].map((i) => start + (i * HISTORY_MS) / 3);
  }, [props.now]);

  const pick = (px: number) => {
    if (pts.length === 0) return;
    const i = nearest(pts, x.invert(px - M.left));
    const p = pts[i];
    if (!p || p.v === null) return;
    setScrub((prev) => {
      if (prev !== i) haptics.tick();
      return i;
    });
  };
  const pan = Gesture.Pan()
    .runOnJS(true)
    .minDistance(0)
    .activeOffsetX([-6, 6])
    .failOffsetY([-14, 14])
    .onBegin((e) => {
      clearTimeout(hideTimer.current);
      pick(e.x);
    })
    .onUpdate((e) => pick(e.x))
    .onFinalize(() => {
      hideTimer.current = setTimeout(() => setScrub(null), 1500);
    });

  const sel = scrub !== null ? pts[scrub] : undefined;
  const selX = sel ? x(sel.t) : 0;
  const selY = sel && sel.v !== null ? y(sel.v) : 0;
  const unit = props.series.unit;

  return (
    <View onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)} style={{ height: HEIGHT }}>
      {width > 0 && (
        <GestureDetector gesture={pan}>
          <View accessible accessibilityLabel={`${props.series.title} over the last 15 minutes`}>
            <Svg width={width} height={HEIGHT}>
              <Defs>
                <LinearGradient id={`fill-${props.series.key}`} x1="0" y1="0" x2="0" y2="1">
                  <Stop offset="0" stopColor={color} stopOpacity={0.18} />
                  <Stop offset="1" stopColor={color} stopOpacity={0.01} />
                </LinearGradient>
              </Defs>
              <G x={M.left} y={M.top}>
                {yTicks.map((v) => (
                  <G key={v}>
                    <Line x1={0} x2={innerW} y1={y(v)} y2={y(v)} stroke={colors.grid} strokeDasharray="3 5" />
                    <SvgText x={-8} y={y(v) + 4} fontSize={11} fill={colors.muted} textAnchor="end" fontFamily={fontFamily[400]}>
                      {v}
                    </SvgText>
                  </G>
                ))}
                {props.series.lines.map((l) => {
                  const ly = y(l.value);
                  if (ly < 0 || ly > innerH) return null;
                  const c = colors[STATE_TOKEN[l.state]];
                  return (
                    <G key={l.value}>
                      <Line x1={0} x2={innerW} y1={ly} y2={ly} stroke={c} strokeOpacity={0.45} strokeDasharray="4 4" />
                      <SvgText x={innerW + 4} y={ly + 4} fontSize={10} fill={c} fontFamily={fontFamily[600]}>
                        {`${l.value}${unit === "°C" ? "°" : ""}`}
                      </SvgText>
                    </G>
                  );
                })}
                {areaPath && <Path d={areaPath} fill={`url(#fill-${props.series.key})`} />}
                {linePath && <Path d={linePath} stroke={color} strokeWidth={2.5} fill="none" strokeLinejoin="round" />}
                {xTicks.map((t, i) => (
                  <SvgText
                    key={t}
                    x={x(t)}
                    y={innerH + 18}
                    fontSize={11}
                    fill={colors.muted}
                    textAnchor={i === 0 ? "start" : i === 3 ? "end" : "middle"}
                    fontFamily={fontFamily[400]}
                  >
                    {hhmm(t)}
                  </SvgText>
                ))}
                {sel && (
                  <G>
                    <Line x1={selX} x2={selX} y1={0} y2={innerH} stroke={colors.muted} strokeWidth={1} />
                    <Circle cx={selX} cy={selY} r={6} fill={colors.surface} stroke={color} strokeWidth={3} />
                  </G>
                )}
              </G>
            </Svg>
            {sel && sel.v !== null && (
              <View
                pointerEvents="none"
                style={{
                  position: "absolute",
                  top: 0,
                  left: Math.min(Math.max(M.left + selX - 70, 0), width - 140),
                  width: 140,
                  alignItems: "center",
                  paddingVertical: 6,
                  borderRadius: 10,
                  backgroundColor: colors.surface,
                  borderWidth: 1,
                  borderColor: colors.border,
                }}
              >
                <Text variant="label" numeric>
                  {sel.v.toFixed(props.series.digits)} {unit}
                </Text>
                <Text variant="caption" tone="muted" numeric>
                  {clockTime(sel.t)}
                </Text>
              </View>
            )}
          </View>
        </GestureDetector>
      )}
    </View>
  );
}
