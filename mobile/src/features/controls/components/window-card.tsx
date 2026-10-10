import { useState } from "react";
import { useAtomValue } from "jotai";
import { ArrowUpRight, PanelsTopLeft } from "lucide-react-native";
import { Pressable, View } from "react-native";
import { windowLabel } from "@srdt/twin-core";
import { Card } from "@/components/card";
import { Tag } from "@/components/pill";
import { Text } from "@/components/text";
import { haptics } from "@/lib/haptics";
import { useTheme } from "@/lib/theme/theme";
import { actuatorsAtom, onlineAtom, overrideAtom } from "@/features/twin/_atoms/derived";
import { AngleDial } from "./angle-dial";
import { CommandButton } from "./command-button";
import { ControlHeading } from "./control-heading";

const PRESETS = [25, 45, 90];

export function WindowCard() {
  const { colors } = useTheme();
  const online = useAtomValue(onlineAtom);
  const { windowAngle } = useAtomValue(actuatorsAtom);
  const override = useAtomValue(overrideAtom);
  const [target, setTarget] = useState(90);
  return (
    <Card>
      <ControlHeading
        icon={PanelsTopLeft}
        title="Window"
        subtitle={windowLabel(windowAngle)}
        right={<Tag label={override ? (override.window ? "Manual" : "Auto") : "Unknown"} />}
      />
      <AngleDial target={target} actual={windowAngle} onChange={setTarget} disabled={!online} />
      <View style={{ flexDirection: "row", gap: 8, justifyContent: "center", marginVertical: 12 }}>
        {PRESETS.map((deg) => {
          const active = deg === target;
          return (
            <Pressable
              key={deg}
              accessibilityRole="button"
              accessibilityState={{ selected: active, disabled: !online }}
              disabled={!online}
              onPress={() => {
                haptics.tick();
                setTarget(deg);
              }}
              style={{
                paddingHorizontal: 16,
                paddingVertical: 8,
                borderRadius: 999,
                borderWidth: 1,
                borderColor: active ? colors.accent : colors.border,
                backgroundColor: active ? colors["accent-tint"] : colors.surface,
                opacity: online ? 1 : 0.5,
              }}
            >
              <Text variant="label" tone={active ? "accent" : "muted"}>
                {deg}°
              </Text>
            </Pressable>
          );
        })}
      </View>
      <View style={{ flexDirection: "row", gap: 10 }}>
        <CommandButton flex action="OPEN_WINDOW" value={target} label={`Open ${target}°`} icon={ArrowUpRight} />
        <CommandButton flex action="CLOSE_WINDOW" label="Close" icon={PanelsTopLeft} variant="quiet" />
      </View>
    </Card>
  );
}
