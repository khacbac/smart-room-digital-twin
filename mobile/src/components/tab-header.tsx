import { useRouter } from "expo-router";
import { Settings2 } from "lucide-react-native";
import { useAtomValue } from "jotai";
import { View } from "react-native";
import { deviceMetaAtom } from "@/features/twin/_atoms/derived";
import { PresenceBadge } from "./badge";
import { IconButton } from "./icon-button";
import { Text } from "./text";

/** Title of a tab, with the device presence and the way to Settings. */
export function TabHeader({ title, description }: { title: string; description?: string }) {
  const router = useRouter();
  const meta = useAtomValue(deviceMetaAtom);
  return (
    <View style={{ gap: 4, marginBottom: 4 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <Text variant="title" style={{ flex: 1 }} accessibilityRole="header">
          {title}
          <Text variant="title" tone="accent">
            .
          </Text>
        </Text>
        <PresenceBadge presence={meta.presence} />
        <IconButton icon={Settings2} label="Settings" onPress={() => router.push("/settings")} />
      </View>
      {description ? (
        <Text variant="body" tone="muted">
          {description}
        </Text>
      ) : null}
    </View>
  );
}
