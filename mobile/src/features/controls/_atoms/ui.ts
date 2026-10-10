import { atom } from "jotai";
import { atomFamily } from "jotai-family";
import type { CommandAction } from "@srdt/contracts";
import { isBusy, type SceneId } from "@srdt/twin-core";
import { commandsAtom } from "@/features/twin/_atoms/state";

/** Actions whose HTTP request is in flight (one entry per request). */
export const requestingAtom = atom<CommandAction[]>([]);

/** The scene whose steps are being posted, if any (one scene at a time). */
export const runningSceneAtom = atom<SceneId | null>(null);

/** Commands posted from this app that still wait for a final status, to toast it. */
export const awaitedCommandsAtom = atom<string[]>([]);

/**
 * True while a conflicting request is in flight or a conflicting command is still open
 * (twin-core rules: window / buzzer / both for CLEAR_OVERRIDE).
 */
export const busyFamily = atomFamily((action: CommandAction) =>
  atom((get) => isBusy(action, get(requestingAtom), get(commandsAtom))),
);
