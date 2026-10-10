import { useMemo, useState } from "react";
import { useAtomValue } from "jotai";
import { useRouter } from "expo-router";
import type { EdgeState, TelemetryRecord } from "@srdt/contracts";
import type { LucideIcon } from "lucide-react-native";
import { Droplets, Sun, Thermometer, UserRound, Wind } from "lucide-react-native";
import { View } from "react-native";
import { AQ_LINES, HUMIDITY_LINES, STATE_LABEL, TEMP_LINES, fmt, levelFor } from "@srdt/twin-core";
import { Text } from "@/components/text";
import type { MetricTone } from "@/lib/theme/colors";
import { STATE_TOKEN } from "@/lib/theme/state-color";
import { useTheme } from "@/lib/theme/theme";
import type { Series } from "@/features/settings/_atoms/settings";
import { deviceMetaAtom, latestTelemetryAtom, onlineAtom } from "../_atoms/derived";
import { telemetryAtom } from "../_atoms/state";
import { Sparkline } from "./sparkline";
import { Touchable } from "@/components/touchable";

/** Last ~80 points of one series, enough for a sparkline (receive time on x). */
function useSeries(key: Series) {
  const telemetry = useAtomValue(telemetryAtom);
  return useMemo(() => {
    const step = Math.max(1, Math.floor(telemetry.length / 80));
    const out: { t: number; v: number | null }[] = [];
    for (let i = 0; i < telemetry.length; i += step) {
      const r = telemetry[i] as TelemetryRecord;
      out.push({ t: Date.parse(r.receivedAt), v: r[key] });
    }
    return out;
  }, [telemetry, key]);
}

export function MetricGrid() {
  const live = useAtomValue(latestTelemetryAtom);
  const online = useAtomValue(onlineAtom);
  const { dhtFault } = useAtomValue(deviceMetaAtom);
  const missing = dhtFault ? "Sensor fault" : "Waiting for reading";
  return (
    <View
      accessibilityLabel="Current sensor readings"
      style={{ flexDirection: "row", flexWrap: "wrap", gap: 12, opacity: online ? 1 : 0.55 }}
    >
      <MetricCard
        label="Temperature"
        spoken="degrees"
        value={fmt(live?.temperature)}
        unit="°C"
        icon={Thermometer}
        tone="peach"
        series="temperature"
        level={levelFor(live?.temperature ?? null, TEMP_LINES)}
        note={live?.temperature == null ? missing : "Below heat threshold"}
      />
      <MetricCard
        label="Humidity"
        spoken="percent"
        value={fmt(live?.humidity, 0)}
        unit="%"
        icon={Droplets}
        tone="blue"
        series="humidity"
        level={levelFor(live?.humidity ?? null, HUMIDITY_LINES)}
        note={live?.humidity == null ? missing : "Below high threshold"}
      />
      <MetricCard
        label="Light level"
        spoken="lux"
        value={fmt(live?.light, 0)}
        unit="lx"
        icon={Sun}
        tone="sand"
        note={live?.light == null ? "Waiting for reading" : "Ambient light"}
      />
      <MetricCard
        label="Air quality"
        spoken="air quality index"
        value={fmt(live?.airQuality, 0)}
        unit="AQ"
        icon={Wind}
        tone="sage"
        series="airQuality"
        level={levelFor(live?.airQuality ?? null, AQ_LINES)}
        note={live?.airQuality == null ? "Waiting for reading" : "Below alert threshold"}
      />
      <MetricCard
        wide
        label="Occupancy"
        value={!live ? "—" : live.presence ? "Detected" : "Quiet"}
        icon={UserRound}
        tone="lilac"
        note={!live ? "Waiting for reading" : live.presence ? "Motion detected" : "No motion detected"}
      />
    </View>
  );
}

function MetricCard(props: {
  label: string;
  spoken?: string;
  value: string;
  unit?: string;
  icon: LucideIcon;
  tone: MetricTone;
  series?: Series;
  level?: EdgeState | null;
  note: string;
  wide?: boolean;
}) {
  const { colors, tones } = useTheme();
  const router = useRouter();
  const [width, setWidth] = useState(0);
  const tone = tones[props.tone];
  const levelColor = props.level ? colors[STATE_TOKEN[props.level]] : undefined;
  const Icon = props.icon;
  const noteText = props.level ? STATE_LABEL[props.level] : props.note;
  const spoken = `${props.label} ${props.value === "—" ? "no reading" : `${props.value} ${props.spoken ?? ""}`}, ${noteText}`;

  const body = (
    <View
      onLayout={(e) => setWidth(e.nativeEvent.layout.width - 32)}
      style={{
        padding: 16,
        borderRadius: 18,
        borderWidth: 1,
        borderColor: tone.line,
        backgroundColor: tone.card,
        gap: 6,
        minHeight: props.wide ? undefined : 150,
        flexDirection: props.wide ? "row" : "column",
        alignItems: props.wide ? "center" : undefined,
      }}
    >
      {props.wide ? (
        <>
          <Disc icon={Icon} color={tone.icon} bg={tone.disc} />
          <View style={{ flex: 1, marginLeft: 8 }}>
            <Text variant="label" tone="muted">
              {props.label}
            </Text>
            <Note color={levelColor} text={noteText} />
          </View>
          <Text variant="title" color={levelColor}>
            {props.value}
          </Text>
        </>
      ) : (
        <>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <Text variant="label" tone="muted" numberOfLines={1} style={{ flex: 1 }}>
              {props.label}
            </Text>
            <Disc icon={Icon} color={tone.icon} bg={tone.disc} />
          </View>
          <View style={{ flexDirection: "row", alignItems: "baseline", gap: 3 }}>
            <Text variant="metric" numeric color={levelColor}>
              {props.value}
            </Text>
            {props.unit && props.value !== "—" && (
              <Text variant="metric-unit" tone="muted">
                {props.unit}
              </Text>
            )}
          </View>
          {props.series ? <SeriesSpark series={props.series} width={width} /> : <View style={{ height: 28 }} />}
          <Note color={levelColor} text={noteText} />
        </>
      )}
    </View>
  );

  return (
    <View style={{ width: props.wide ? "100%" : "48.2%", flexGrow: props.wide ? 0 : 1 }}>
      {props.series ? (
        <Touchable
          accessibilityRole="button"
          accessibilityLabel={spoken}
          accessibilityHint="Shows the trend"
          onPress={() => router.navigate({ pathname: "/trends", params: { series: props.series } })}
          style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
        >
          {body}
        </Touchable>
      ) : (
        <View accessible accessibilityLabel={spoken}>
          {body}
        </View>
      )}
    </View>
  );
}

function SeriesSpark({ series, width }: { series: Series; width: number }) {
  const { colors } = useTheme();
  const points = useSeries(series);
  const color = colors[series === "temperature" ? "series-temp" : series === "humidity" ? "series-hum" : "series-aq"];
  return <Sparkline points={points} color={color} width={Math.max(0, width)} />;
}

function Disc({ icon: Icon, color, bg }: { icon: LucideIcon; color: string; bg: string }) {
  return (
    <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: bg, alignItems: "center", justifyContent: "center" }}>
      <Icon size={18} color={color} />
    </View>
  );
}

function Note({ color, text }: { color?: string; text: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color ?? colors.muted, opacity: color ? 1 : 0.6 }} />
      <Text variant="caption" color={color} tone="muted" numberOfLines={1}>
        {text}
      </Text>
    </View>
  );
}
