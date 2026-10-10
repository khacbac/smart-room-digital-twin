import { useAtomValue } from "jotai";
import type { LucideIcon } from "lucide-react-native";
import { Hand, Info, PanelsTopLeft, ShieldAlert, ShieldCheck, Sparkles, Volume2 } from "lucide-react-native";
import { Alert, Pressable, View } from "react-native";
import { STATE_LABEL, mlText, overrideText, windowLabel } from "@srdt/twin-core";
import { Card } from "@/components/card";
import { Text } from "@/components/text";
import { useNow } from "@/lib/hooks/use-now";
import { STATE_TOKEN } from "@/lib/theme/state-color";
import { useTheme } from "@/lib/theme/theme";
import { actuatorsAtom, deviceMetaAtom, edgeStateAtom, mlAtom, onlineAtom, overrideAtom } from "../_atoms/derived";

/** Port of the dashboard's StatusStrip: condition, actuators, control mode, on-device AI. */
export function StatusCard() {
  const { colors } = useTheme();
  const online = useAtomValue(onlineAtom);
  const edgeState = useAtomValue(edgeStateAtom);
  const { windowAngle, buzzer } = useAtomValue(actuatorsAtom);
  const ml = useAtomValue(mlAtom);
  const meta = useAtomValue(deviceMetaAtom);
  const stateColor = edgeState ? colors[STATE_TOKEN[edgeState]] : colors.muted;
  const ShieldIcon = edgeState === "NORMAL" ? ShieldCheck : ShieldAlert;
  const ai = mlText(ml.mlState, ml.aiControl);

  return (
    <Card dimmed={!online} accessibilityLabel="Device state">
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <View
          style={{
            width: 44,
            height: 44,
            borderRadius: 14,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: colors["surface-2"],
          }}
        >
          <ShieldIcon size={24} color={stateColor} />
        </View>
        <View>
          <Text variant="eyebrow" tone="muted">
            Room condition
          </Text>
          <Text variant="title" color={stateColor}>
            {edgeState ? STATE_LABEL[edgeState] : "Awaiting data"}
          </Text>
        </View>
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", rowGap: 14 }}>
        <Item icon={PanelsTopLeft} label="Window" value={windowLabel(windowAngle)} />
        <Item icon={Volume2} label="Alarm" value={buzzer == null ? "—" : buzzer ? "Sounding" : "Off"} />
        <ControlMode />
        {ai !== null && (
          <Item
            icon={Sparkles}
            label="Room intelligence"
            value={ai}
            color={ml.mlState ? colors[STATE_TOKEN[ml.mlState]] : undefined}
            info="On-device AI: active means it controls the window and alarm; safety rules remain in effect."
          />
        )}
      </View>
      {meta.fw !== null && meta.rssi !== null && (
        <Text variant="caption" tone="muted" style={{ marginTop: 16 }}>
          fw {meta.fw} · RSSI {meta.rssi} dBm
        </Text>
      )}
    </Card>
  );
}

/** The other per-second ticker on Home (the override countdown). */
function ControlMode() {
  const override = useAtomValue(overrideAtom);
  const now = useNow(1000);
  return <Item icon={Hand} label="Control mode" value={overrideText(override, now)} />;
}

function Item(props: { icon: LucideIcon; label: string; value: string; color?: string; info?: string }) {
  const { colors } = useTheme();
  const Icon = props.icon;
  return (
    <View style={{ width: "50%", paddingRight: 8, gap: 2 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
        <Icon size={13} color={colors.muted} />
        <Text variant="caption" tone="muted">
          {props.label}
        </Text>
        {props.info && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`About ${props.label}`}
            hitSlop={10}
            onPress={() => Alert.alert(props.label, props.info)}
          >
            <Info size={13} color={colors.muted} />
          </Pressable>
        )}
      </View>
      <Text variant="label" color={props.color} numeric>
        {props.value}
      </Text>
    </View>
  );
}
