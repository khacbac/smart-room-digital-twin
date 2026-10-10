import { useAtomValue } from "jotai";
import { Hand, RotateCcw } from "lucide-react-native";
import { overrideText } from "@srdt/twin-core";
import { Card } from "@/components/card";
import { Text } from "@/components/text";
import { useNow } from "@/lib/hooks/use-now";
import { overrideAtom } from "@/features/twin/_atoms/derived";
import { CommandButton } from "./command-button";
import { ControlHeading } from "./control-heading";

export function AutoControlCard() {
  const override = useAtomValue(overrideAtom);
  const now = useNow(1000);
  const manual = !!override && (override.window || override.buzzer);
  return (
    <Card>
      <ControlHeading icon={Hand} title="Control mode" subtitle={overrideText(override, now)} />
      <CommandButton
        action="CLEAR_OVERRIDE"
        label={manual ? "Resume automatic control" : "Already automatic"}
        icon={RotateCcw}
        variant="quiet"
        disabledReason={!manual}
      />
      <Text variant="caption" tone="muted" style={{ marginTop: 10 }}>
        Manual changes last 2 minutes, then automatic control resumes.
      </Text>
    </Card>
  );
}
