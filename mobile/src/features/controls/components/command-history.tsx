import { useAtomValue } from "jotai";
import { useRouter } from "expo-router";
import { History } from "lucide-react-native";
import { Pressable, View } from "react-native";
import { Card } from "@/components/card";
import { Hairline } from "@/components/hairline";
import { SectionHeader } from "@/components/section-header";
import { Text } from "@/components/text";
import { useTheme } from "@/lib/theme/theme";
import { commandsAtom } from "@/features/twin/_atoms/state";
import { CommandRow } from "./command-row";

export function CommandHistory() {
  const router = useRouter();
  const { colors } = useTheme();
  const recent = useAtomValue(commandsAtom).slice(0, 6);
  return (
    <Card>
      <SectionHeader
        title="Recent commands"
        description="What was asked of the room, and how it answered."
        right={
          <Pressable
            accessibilityRole="link"
            hitSlop={10}
            onPress={() => router.navigate({ pathname: "/activity", params: { view: "commands" } })}
          >
            <Text variant="label" tone="accent">
              See all
            </Text>
          </Pressable>
        }
      />
      {recent.length === 0 ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <History size={15} color={colors.muted} />
          <Text variant="body" tone="muted">
            No commands yet.
          </Text>
        </View>
      ) : (
        recent.map((c, i) => (
          <View key={c.id}>
            {i > 0 && <Hairline />}
            <CommandRow command={c} />
          </View>
        ))
      )}
    </Card>
  );
}
