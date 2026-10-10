import { useAtomValue, useSetAtom } from "jotai";
import { BedDouble, Sparkles, RotateCcw, Wind, type LucideIcon } from "lucide-react-native";
import { ActivityIndicator, View } from "react-native";
import { SCENES, type Scene, type SceneId } from "@srdt/twin-core";
import { Card } from "@/components/card";
import { SectionHeader } from "@/components/section-header";
import { Text } from "@/components/text";
import { Touchable } from "@/components/touchable";
import { useTheme } from "@/lib/theme/theme";
import { onlineAtom } from "@/features/twin/_atoms/derived";
import { runSceneAtom } from "../_atoms/mutations";
import { runningSceneAtom } from "../_atoms/ui";

const ICON: Record<SceneId, LucideIcon> = {
  welcome: Sparkles,
  ventilate: Wind,
  sleep: BedDouble,
  auto: RotateCcw,
};

function SceneTile({ scene, disabled, running }: { scene: Scene; disabled: boolean; running: boolean }) {
  const { colors } = useTheme();
  const run = useSetAtom(runSceneAtom);
  const Icon = ICON[scene.id];
  return (
    <Touchable
      accessibilityRole="button"
      accessibilityLabel={scene.label}
      accessibilityHint={scene.description}
      accessibilityState={{ disabled, busy: running }}
      disabled={disabled}
      android_ripple={{ color: colors.border, foreground: true }}
      onPress={() => void run(scene)}
      style={({ pressed }) => ({
        flexBasis: "47%",
        flexGrow: 1,
        minHeight: 76,
        padding: 12,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: running ? colors.accent : colors.border,
        backgroundColor: colors["surface-2"],
        gap: 6,
        overflow: "hidden",
        opacity: disabled && !running ? 0.45 : pressed ? 0.85 : 1,
        transform: [{ scale: pressed ? 0.98 : 1 }],
      })}
    >
      <View style={{ height: 20, justifyContent: "center" }}>
        {running ? <ActivityIndicator size="small" color={colors.accent} /> : <Icon size={20} color={colors.accent} />}
      </View>
      <Text variant="label" numberOfLines={1}>
        {scene.label}
      </Text>
      <Text variant="caption" tone="muted" numberOfLines={1}>
        {scene.description}
      </Text>
    </Touchable>
  );
}

/** One-tap scenes (twin-core SCENES): each sends its commands in order. */
export function ScenesCard() {
  const online = useAtomValue(onlineAtom);
  const running = useAtomValue(runningSceneAtom);
  return (
    <Card>
      <SectionHeader title="Scenes" description="One tap, several commands." />
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
        {SCENES.map((s) => (
          <SceneTile key={s.id} scene={s} disabled={!online || running !== null} running={running === s.id} />
        ))}
      </View>
    </Card>
  );
}
