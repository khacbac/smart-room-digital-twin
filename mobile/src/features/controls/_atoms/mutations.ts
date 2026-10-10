import { atom, type createStore } from "jotai";
import type { CommandAction } from "@srdt/contracts";
import { ACTION_LABEL, apiErrorText, isOpenStatus, resultText, type Scene, type SceneId } from "@srdt/twin-core";
import { ApiError } from "@/lib/api/client";
import { sendCommand, type CommandBody } from "@/lib/api/endpoints";
import { haptics } from "@/lib/haptics";
import { pushToast } from "@/lib/toast";
import { deviceCodeAtom } from "@/features/settings/_atoms/settings";
import { commandsAtom } from "@/features/twin/_atoms/state";
import { awaitedCommandsAtom, requestingAtom, runningSceneAtom } from "./ui";

// Manual control: POST → the button stays busy until the command is final → toast.
// The actuator state itself comes from the device's reported state, never assumed here.

function toastFinal(status: string, text: string) {
  if (status === "executed") {
    pushToast("success", text);
    haptics.success();
  } else {
    pushToast("error", text);
    haptics.error();
  }
}

/** Sends a command; resolves to its id, or null when the backend refused it. Never throws. */
export const sendCommandAtom = atom(
  null,
  async (get, set, input: { action: CommandAction; value?: number; text?: string; source?: CommandBody["source"] }) => {
    const { action, value, text } = input;
    haptics.press();
    set(requestingAtom, (r) => [...r, action]);
    try {
      const res = await sendCommand(get(deviceCodeAtom), { action, value, text, source: input.source ?? "dashboard" });
      // The ack can arrive over SSE before the HTTP response.
      const known = get(commandsAtom).find((c) => c.id === res.commandId);
      if (known && !isOpenStatus(known.status)) toastFinal(known.status, resultText(known));
      else if (isOpenStatus(res.status)) set(awaitedCommandsAtom, (ids) => [...ids, res.commandId]);
      else toastFinal(res.status, `${ACTION_LABEL[action]} ${res.status}`);
      return res.commandId;
    } catch (err) {
      const text = err instanceof ApiError ? apiErrorText(err.code, err.message) : String(err);
      pushToast("error", `${ACTION_LABEL[action]}: ${text}`);
      haptics.error();
      return null;
    } finally {
      set(requestingAtom, (r) => {
        const i = r.indexOf(action);
        return i < 0 ? r : [...r.slice(0, i), ...r.slice(i + 1)];
      });
    }
  },
);

/** Sends a scene's steps one after the other; stops at the first one the backend refuses. */
export const runSceneAtom = atom(null, async (get, set, scene: Scene) => {
  if (get(runningSceneAtom)) return;
  set(runningSceneAtom, scene.id as SceneId);
  try {
    for (const step of scene.steps) {
      if ((await set(sendCommandAtom, step)) === null) break;
    }
  } finally {
    set(runningSceneAtom, null);
  }
});

/** Toasts each awaited command once it reaches a final status. Returns the unsubscribe. */
export function watchAwaitedCommands(store: ReturnType<typeof createStore>): () => void {
  return store.sub(commandsAtom, () => {
    const awaited = store.get(awaitedCommandsAtom);
    if (awaited.length === 0) return;
    const done = store.get(commandsAtom).filter((c) => awaited.includes(c.id) && !isOpenStatus(c.status));
    if (done.length === 0) return;
    for (const c of done) toastFinal(c.status, resultText(c));
    store.set(
      awaitedCommandsAtom,
      awaited.filter((id) => !done.some((c) => c.id === id)),
    );
  });
}
