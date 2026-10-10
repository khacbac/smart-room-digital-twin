import { createMMKV } from "react-native-mmkv";
import { atomWithStorage, createJSONStorage } from "jotai/utils";

// Settings and small UI preferences that survive restarts. MMKV is synchronous, so atoms
// read their stored value on the first render (no flash of the default).

export const storage = createMMKV({ id: "smart-room" });

const mmkvStringStorage = {
  getItem: (key: string) => storage.getString(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
  removeItem: (key: string) => {
    storage.remove(key);
  },
};

/** A persisted atom; `key` is namespaced so a future migration can find every setting. */
export function persistedAtom<T>(key: string, initial: T) {
  return atomWithStorage<T>(`v1.${key}`, initial, createJSONStorage<T>(() => mmkvStringStorage), { getOnInit: true });
}
