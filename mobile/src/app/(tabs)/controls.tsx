import { useAtomValue } from "jotai";
import { WifiOff } from "lucide-react-native";
import { View } from "react-native";
import { Card } from "@/components/card";
import { Screen } from "@/components/screen";
import { TabHeader } from "@/components/tab-header";
import { Text } from "@/components/text";
import { useTheme } from "@/lib/theme/theme";
import { AlarmCard } from "@/features/controls/components/alarm-card";
import { AutoControlCard } from "@/features/controls/components/auto-control-card";
import { CommandHistory } from "@/features/controls/components/command-history";
import { WindowCard } from "@/features/controls/components/window-card";
import { onlineAtom } from "@/features/twin/_atoms/derived";

export default function ControlsScreen() {
  const online = useAtomValue(onlineAtom);
  const { colors } = useTheme();
  return (
    <Screen header={<TabHeader title="Room controls" description="Make your space feel just right." />}>
      {!online && (
        <Card background={colors["surface-2"]}>
          <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
            <WifiOff size={18} color={colors.muted} />
            <Text variant="body" tone="muted" style={{ flex: 1 }}>
              Your device is offline. Controls will be available when it reconnects.
            </Text>
          </View>
        </Card>
      )}
      <WindowCard />
      <AlarmCard />
      <AutoControlCard />
      <CommandHistory />
    </Screen>
  );
}
