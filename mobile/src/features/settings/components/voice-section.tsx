import { useAtom } from "jotai";
import { Switch, View } from "react-native";
import { Card } from "@/components/card";
import { SectionHeader } from "@/components/section-header";
import { SegmentedControl } from "@/components/segmented-control";
import { Text } from "@/components/text";
import { useTheme } from "@/lib/theme/theme";
import { voiceLocaleAtom, voiceSpeakRepliesAtom } from "../_atoms/settings";

export function VoiceSection() {
  const { colors } = useTheme();
  const [locale, setLocale] = useAtom(voiceLocaleAtom);
  const [speak, setSpeak] = useAtom(voiceSpeakRepliesAtom);
  return (
    <Card>
      <SectionHeader title="Voice" description="Ask your room with the mic in the tab bar." />
      <View style={{ gap: 14 }}>
        <View style={{ gap: 6 }}>
          <Text variant="label" tone="muted">
            Listening language
          </Text>
          <SegmentedControl
            label="Listening language"
            value={locale}
            onChange={setLocale}
            segments={[
              { value: "vi-VN", label: "Tiếng Việt" },
              { value: "en-US", label: "English" },
            ]}
          />
        </View>
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <Text variant="body" style={{ flex: 1 }}>
            Read replies aloud
          </Text>
          <Switch
            accessibilityLabel="Read replies aloud"
            value={speak}
            onValueChange={setSpeak}
            trackColor={{ true: colors.accent, false: colors.border }}
            thumbColor={colors.surface}
          />
        </View>
        <Text variant="caption" tone="muted">
          Your voice is turned into text by the phone's speech service (Google; for Vietnamese this usually happens online).
          The text is sent to the server and to Google Gemini.
        </Text>
      </View>
    </Card>
  );
}
