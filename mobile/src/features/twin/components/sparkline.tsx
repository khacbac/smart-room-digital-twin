import { memo, useMemo } from "react";
import { line, curveMonotoneX } from "d3-shape";
import { scaleLinear } from "d3-scale";
import Svg, { Path } from "react-native-svg";

/** Tiny 15-minute trend with no axes, under a metric value. Gaps (null) break the line. */
export const Sparkline = memo(function Sparkline(props: {
  points: { t: number; v: number | null }[];
  color: string;
  width: number;
  height?: number;
}) {
  const height = props.height ?? 28;
  const d = useMemo(() => {
    const vals = props.points.filter((p) => p.v !== null) as { t: number; v: number }[];
    if (vals.length < 2 || props.width <= 0) return null;
    const ts = vals.map((p) => p.t);
    const vs = vals.map((p) => p.v);
    let lo = Math.min(...vs);
    let hi = Math.max(...vs);
    if (hi - lo < 1) {
      lo -= 0.5;
      hi += 0.5;
    }
    const x = scaleLinear().domain([Math.min(...ts), Math.max(...ts)]).range([1, props.width - 1]);
    const y = scaleLinear().domain([lo, hi]).range([height - 2, 2]);
    return line<{ t: number; v: number | null }>()
      .defined((p) => p.v !== null)
      .x((p) => x(p.t))
      .y((p) => y(p.v ?? 0))
      .curve(curveMonotoneX)(props.points);
  }, [props.points, props.width, height]);
  return (
    <Svg width={props.width} height={height}>
      {d ? <Path d={d} stroke={props.color} strokeWidth={2} fill="none" strokeLinecap="round" /> : null}
    </Svg>
  );
});
