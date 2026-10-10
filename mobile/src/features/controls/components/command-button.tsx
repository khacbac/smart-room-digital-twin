import { useAtomValue, useSetAtom } from "jotai";
import type { CommandAction } from "@srdt/contracts";
import { Alert } from "react-native";
import { Button, type ButtonProps } from "@/components/button";
import { onlineAtom } from "@/features/twin/_atoms/derived";
import { sendCommandAtom } from "../_atoms/mutations";
import { busyFamily } from "../_atoms/ui";

/**
 * A button that sends one command. Disabled while the device is offline; shows a spinner
 * while it, or a command on the same actuator, is still pending.
 */
export function CommandButton(
  props: Omit<ButtonProps, "onPress" | "loading"> & {
    action: CommandAction;
    value?: number;
    /** Ask first (the alarm makes a real sound in the room). */
    confirm?: { title: string; message: string; ok: string };
    disabledReason?: boolean;
  },
) {
  const { action, value, confirm, disabledReason, ...button } = props;
  const online = useAtomValue(onlineAtom);
  const busy = useAtomValue(busyFamily(action));
  const send = useSetAtom(sendCommandAtom);
  const go = () => void send({ action, value });
  return (
    <Button
      {...button}
      disabled={!online || !!disabledReason}
      loading={online && busy}
      onPress={() =>
        confirm
          ? Alert.alert(confirm.title, confirm.message, [
              { text: "Cancel", style: "cancel" },
              { text: confirm.ok, style: "destructive", onPress: go },
            ])
          : go()
      }
    />
  );
}
