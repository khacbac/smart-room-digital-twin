import { useState } from "react";
import { MESSAGE_MAX, toDisplayText } from "@srdt/contracts";
import { Cpu, Lightbulb, Send } from "lucide-react-native";
import { TextInput, View } from "react-native";
import { Card } from "@/components/card";
import { Text } from "@/components/text";
import { fontFamily } from "@/lib/theme/colors";
import { useTheme } from "@/lib/theme/theme";
import { CommandButton } from "./command-button";
import { ControlHeading } from "./control-heading";

/** The board itself: a message on its screen, and IDENTIFY to spot it in the room. */
export function BoardCard() {
  const { colors } = useTheme();
  const [message, setMessage] = useState("");
  const shown = toDisplayText(message);
  const tooLong = shown.length > MESSAGE_MAX;
  return (
    <Card>
      <ControlHeading icon={Cpu} title="Board" subtitle="Message on the screen, or blink to find it" />
      <TextInput
        value={message}
        onChangeText={setMessage}
        placeholder="Xin chào hội đồng!"
        placeholderTextColor={colors.muted}
        accessibilityLabel="Message for the board screen"
        maxLength={MESSAGE_MAX + 8}
        returnKeyType="send"
        style={{
          minHeight: 48,
          paddingHorizontal: 14,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: tooLong ? colors["state-danger"] : colors.border,
          backgroundColor: colors["surface-2"],
          color: colors.text,
          fontFamily: fontFamily[400],
          fontSize: 15,
        }}
      />
      <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 6, marginBottom: 12, gap: 8 }}>
        <Text variant="caption" tone="muted" numberOfLines={1} style={{ flex: 1 }}>
          {shown ? `Shows: ${shown}` : "Accents are removed on the board."}
        </Text>
        <Text variant="caption" tone={tooLong ? "state-danger" : "muted"}>
          {shown.length}/{MESSAGE_MAX}
        </Text>
      </View>
      <View style={{ flexDirection: "row", gap: 10 }}>
        <CommandButton
          flex
          action="SHOW_MESSAGE"
          text={message}
          label="Show"
          icon={Send}
          disabledReason={!shown || tooLong}
        />
        <CommandButton flex action="IDENTIFY" label="Identify" icon={Lightbulb} variant="quiet" />
      </View>
    </Card>
  );
}
