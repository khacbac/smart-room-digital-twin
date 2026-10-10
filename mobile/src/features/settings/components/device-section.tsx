import { useAtomValue } from "jotai";
import { View } from "react-native";
import { PRESENCE_LABEL, ago, toMs } from "@srdt/twin-core";
import { Card } from "@/components/card";
import { Hairline } from "@/components/hairline";
import { SectionHeader } from "@/components/section-header";
import { Text } from "@/components/text";
import { useNow } from "@/lib/hooks/use-now";
import { deviceMetaAtom } from "@/features/twin/_atoms/derived";

/** "2 h 14 min", "45 s". */
function uptime(sec: number | null): string {
  if (sec === null) return "—";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return `${h} h ${m} min`;
  return m > 0 ? `${m} min` : `${sec} s`;
}

export function DeviceSection() {
  const meta = useAtomValue(deviceMetaAtom);
  const now = useNow(5000);
  const rows: [string, string][] = [
    ["Name", meta.name ?? "—"],
    ["Code", meta.code ?? "—"],
    ["Presence", PRESENCE_LABEL[meta.presence]],
    ["Firmware", meta.fw ?? "—"],
    ["Boot id", meta.bootId ?? "—"],
    ["Uptime", uptime(meta.uptimeSec)],
    ["Signal", meta.rssi === null ? "—" : `${meta.rssi} dBm`],
    ["Last seen", ago(toMs(meta.lastSeenAt), now)],
  ];
  return (
    <Card>
      <SectionHeader title="Device" description="As last reported by the room." />
      {rows.map(([k, v], i) => (
        <View key={k}>
          {i > 0 && <Hairline />}
          <View style={{ flexDirection: "row", paddingVertical: 10 }}>
            <Text variant="body" tone="muted" style={{ flex: 1 }}>
              {k}
            </Text>
            <Text variant="body" numeric>
              {v}
            </Text>
          </View>
        </View>
      ))}
    </Card>
  );
}
