import { useCallback } from "react";
import { Tabs } from "expo-router";
import { useAtom, useAtomValue } from "jotai";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { TAB_BAR_HEIGHT, TabBar } from "@/components/tab-bar";
import { ToastHost } from "@/components/toast-host";
import { useTheme } from "@/lib/theme/theme";
import { unseenAlertAtom } from "@/features/activity/_atoms/unseen";
import { ConnectionGate } from "@/features/twin/components/connection-gate";
import { voiceOpenAtom } from "@/features/voice/_atoms/session";
import { VoiceSheet } from "@/features/voice/components/voice-sheet";

export default function TabsLayout() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const unseen = useAtomValue(unseenAlertAtom);
  const [voiceOpen, setVoiceOpen] = useAtom(voiceOpenAtom);
  const closeVoice = useCallback(() => setVoiceOpen(false), [setVoiceOpen]);
  return (
    <ConnectionGate>
      <View style={{ flex: 1 }}>
        <Tabs
          tabBar={(props) => <TabBar {...props} badges={{ activity: unseen }} />}
          screenOptions={{ headerShown: false, animation: "fade", sceneStyle: { backgroundColor: colors.bg } }}
        >
          <Tabs.Screen name="index" options={{ title: "Home" }} />
          <Tabs.Screen name="trends" options={{ title: "Trends" }} />
          <Tabs.Screen name="controls" options={{ title: "Controls" }} />
          <Tabs.Screen name="activity" options={{ title: "Activity" }} />
        </Tabs>
        <ToastHost bottom={TAB_BAR_HEIGHT + insets.bottom + 12} />
        {voiceOpen && <VoiceSheet onClose={closeVoice} />}
      </View>
    </ConnectionGate>
  );
}
