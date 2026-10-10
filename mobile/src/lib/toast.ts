import { atom, getDefaultStore } from "jotai";

export type ToastTone = "success" | "error" | "info";

export interface Toast {
  id: number;
  tone: ToastTone;
  text: string;
}

const MAX = 3;
let nextId = 1;

export const toastsAtom = atom<Toast[]>([]);

export const dismissToastAtom = atom(null, (get, set, id: number) => {
  set(
    toastsAtom,
    get(toastsAtom).filter((t) => t.id !== id),
  );
});

/** Shows a toast; errors stay longer so they can be read (same timings as the dashboard). */
export function pushToast(tone: ToastTone, text: string) {
  const store = getDefaultStore();
  const id = nextId++;
  store.set(toastsAtom, [...store.get(toastsAtom), { id, tone, text }].slice(-MAX));
  setTimeout(() => store.set(dismissToastAtom, id), tone === "error" ? 7000 : 4000);
}
