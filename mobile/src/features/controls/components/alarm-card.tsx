import { useAtomValue } from "jotai";
import { Volume2, VolumeX } from "lucide-react-native";
import { View } from "react-native";
import { Card } from "@/components/card";
import { Tag } from "@/components/pill";
import { actuatorsAtom, overrideAtom } from "@/features/twin/_atoms/derived";
import { CommandButton } from "./command-button";
import { ControlHeading } from "./control-heading";

export function AlarmCard() {
  const { buzzer } = useAtomValue(actuatorsAtom);
  const override = useAtomValue(overrideAtom);
  return (
    <Card>
      <ControlHeading
        icon={Volume2}
        title="Room alarm"
        subtitle={buzzer == null ? "Awaiting device status" : buzzer ? "Alarm is sounding" : "Alarm is off"}
        right={<Tag label={override ? (override.buzzer ? "Manual" : "Auto") : "Unknown"} />}
      />
      <View style={{ flexDirection: "row", gap: 10 }}>
        <CommandButton
          flex
          action="BUZZER_ON"
          label="Turn on"
          icon={Volume2}
          variant="danger"
          confirm={{
            title: "Sound the room alarm?",
            message: "The buzzer in the room will sound until you silence it or automatic control resumes.",
            ok: "Turn on",
          }}
        />
        <CommandButton flex action="BUZZER_OFF" label="Silence" icon={VolumeX} variant="quiet" />
      </View>
    </Card>
  );
}
