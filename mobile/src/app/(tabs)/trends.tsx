import { useEffect, useMemo } from "react";
import { useLocalSearchParams } from "expo-router";
import { useAtom, useAtomValue } from "jotai";
import { Clock3, LineChart } from "lucide-react-native";
import { View } from "react-native";
import { Badge } from "@/components/badge";
import { Card } from "@/components/card";
import { EmptyState } from "@/components/empty-state";
import { Screen } from "@/components/screen";
import { SegmentedControl } from "@/components/segmented-control";
import { TabHeader } from "@/components/tab-header";
import { Text } from "@/components/text";
import { useNow } from "@/lib/hooks/use-now";
import { useTheme } from "@/lib/theme/theme";
import { trendSeriesAtom, type Series } from "@/features/settings/_atoms/settings";
import { SERIES, toPoints } from "@/features/trends/_lib/series";
import { TrendChart } from "@/features/trends/components/trend-chart";
import { TrendSummary } from "@/features/trends/components/trend-summary";
import { telemetryAtom } from "@/features/twin/_atoms/state";

export default function TrendsScreen() {
  const { colors } = useTheme();
  const params = useLocalSearchParams<{ series?: string }>();
  const [seriesKey, setSeries] = useAtom(trendSeriesAtom);
  const telemetry = useAtomValue(telemetryAtom);
  // moving the window every second would redraw for nothing (same as the dashboard)
  const now = useNow(5000);

  useEffect(() => {
    if (params.series && params.series in SERIES) setSeries(params.series as Series);
  }, [params.series, setSeries]);

  const series = SERIES[seriesKey] ?? SERIES.temperature;
  const points = useMemo(() => toPoints(telemetry, series.key), [telemetry, series.key]);

  return (
    <Screen header={<TabHeader title="Room trends" description="Small changes, a clearer picture." />}>
      <SegmentedControl
        label="Series"
        value={series.key}
        onChange={setSeries}
        segments={(Object.keys(SERIES) as Series[]).map((k) => ({
          value: k,
          label: SERIES[k].short,
          dot: colors[SERIES[k].color],
        }))}
      />
      <Card>
        <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 12 }}>
          <Text variant="heading" style={{ flex: 1 }}>
            {series.title}{" "}
            <Text variant="body" tone="muted">
              ({series.unit})
            </Text>
          </Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <Clock3 size={13} color={colors.muted} />
            <Badge label="Last 15 min" color={colors.muted} background={colors["surface-2"]} dot={false} />
          </View>
        </View>
        {points.length === 0 ? (
          <EmptyState icon={LineChart} title="Your room's story starts here" description="Trends will appear as sensor readings arrive." />
        ) : (
          <>
            <TrendChart series={series} points={points} now={now} />
            <View style={{ marginTop: 12 }}>
              <TrendSummary series={series} points={points} />
            </View>
          </>
        )}
        <Text variant="caption" tone="muted" style={{ marginTop: 12 }}>
          Dashed lines mark alert thresholds · Drag across the chart to read a value · Updates automatically
        </Text>
      </Card>
      <Text variant="caption" tone="muted" style={{ textAlign: "center" }}>
        Longer history needs the cloud storage (docs/cloud.md).
      </Text>
    </Screen>
  );
}
