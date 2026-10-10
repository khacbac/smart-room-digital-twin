import { useAtomValue } from "jotai";
import { ArrowUpRight, PanelsTopLeft, VolumeX } from "lucide-react-native";
import { View } from "react-native";
import { actuatorsAtom } from "@/features/twin/_atoms/derived";
import { CommandButton } from "./command-button";

/** Home's one-tap shortcuts; same busy/offline rules as the Controls tab. */
export function QuickActions() {
  const { buzzer } = useAtomValue(actuatorsAtom);
  return (
    <View style={{ flexDirection: "row", gap: 8 }}>
      <CommandButton flex compact action="OPEN_WINDOW" value={90} label="Open" icon={ArrowUpRight} variant="outline" />
      <CommandButton flex compact action="CLOSE_WINDOW" label="Close" icon={PanelsTopLeft} variant="outline" />
      <CommandButton
        flex
        compact
        action="BUZZER_OFF"
        label="Silence"
        icon={VolumeX}
        variant={buzzer ? "danger" : "outline"}
      />
    </View>
  );
}
