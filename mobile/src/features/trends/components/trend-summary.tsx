import { View } from "react-native";
import { Text } from "@/components/text";
import { useTheme } from "@/lib/theme/theme";
import { summary, type Point, type SeriesDef } from "../_lib/series";

export function TrendSummary({ series, points }: { series: SeriesDef; points: Point[] }) {
  const { colors } = useTheme();
  const s = summary(points);
  const cells: [string, number | undefined][] = [
    ["Now", s?.now],
    ["Min", s?.min],
    ["Avg", s?.avg],
    ["Max", s?.max],
  ];
  return (
    <View style={{ flexDirection: "row", gap: 8 }}>
      {cells.map(([label, v]) => (
        <View key={label} style={{ flex: 1, padding: 10, borderRadius: 12, backgroundColor: colors["surface-2"], gap: 2 }}>
          <Text variant="caption" tone="muted">
            {label}
          </Text>
          <Text variant="label" numeric numberOfLines={1}>
            {v === undefined ? "—" : v.toFixed(series.digits)}
            <Text variant="caption" tone="muted">
              {" "}
              {series.unit}
            </Text>
          </Text>
        </View>
      ))}
    </View>
  );
}
