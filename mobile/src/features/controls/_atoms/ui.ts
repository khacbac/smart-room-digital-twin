import { atom } from "jotai";
import { atomFamily } from "jotai-family";
import type { CommandAction } from "@srdt/contracts";
import { isBusy } from "@srdt/twin-core";
import { commandsAtom } from "@/features/twin/_atoms/state";

/** Actions whose HTTP request is in flight (one entry per request). */
export const requestingAtom = atom<CommandAction[]>([]);

/** Commands posted from this app that still wait for a final status, to toast it. */
export const awaitedCommandsAtom = atom<string[]>([]);

/**
 * True while a conflicting request is in flight or a conflicting command is still open
 * (twin-core rules: window / buzzer / both for CLEAR_OVERRIDE).
 */
export const busyFamily = atomFamily((action: CommandAction) =>
  atom((get) => isBusy(action, get(requestingAtom), get(commandsAtom))),
);
