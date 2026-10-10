import { useRouter } from "expo-router";
import Constants from "expo-constants";
import { useAtom } from "jotai";
import { ChevronLeft } from "lucide-react-native";
import { View } from "react-native";
import { Card } from "@/components/card";
import { IconButton } from "@/components/icon-button";
import { Screen } from "@/components/screen";
import { SectionHeader } from "@/components/section-header";
import { SegmentedControl } from "@/components/segmented-control";
import { Text } from "@/components/text";
import { themePreferenceAtom } from "@/features/settings/_atoms/settings";
import { ConnectionSection } from "@/features/settings/components/connection-section";
import { DeviceSection } from "@/features/settings/components/device-section";
import { VoiceSection } from "@/features/settings/components/voice-section";

export default function SettingsScreen() {
  const router = useRouter();
  const [theme, setTheme] = useAtom(themePreferenceAtom);
  return (
    <Screen
      standalone
      header={
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <IconButton icon={ChevronLeft} label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))} />
          <Text variant="title" accessibilityRole="header">
            Settings
            <Text variant="title" tone="accent">
              .
            </Text>
          </Text>
        </View>
      }
    >
      <ConnectionSection />
      <Card>
        <SectionHeader title="Appearance" description="Follows your phone unless you choose." />
        <SegmentedControl
          label="Theme"
          value={theme}
          onChange={setTheme}
          segments={[
            { value: "system", label: "System" },
            { value: "light", label: "Light" },
            { value: "dark", label: "Dark" },
          ]}
        />
      </Card>
      <VoiceSection />
      <DeviceSection />
      <Card>
        <SectionHeader title="About" />
        <Text variant="body">Smart Room Digital Twin</Text>
        <Text variant="caption" tone="muted">
          Version {Constants.expoConfig?.version ?? "—"} · Connected spaces. Considered living.
        </Text>
        <Text variant="caption" tone="muted" style={{ marginTop: 8 }}>
          Room photo: Spacejoy / Unsplash
        </Text>
      </Card>
    </Screen>
  );
}
