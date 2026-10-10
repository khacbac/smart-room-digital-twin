import { atom } from "jotai";
import { lastSeenAlertAtom } from "@/features/settings/_atoms/settings";
import { eventsAtom } from "@/features/twin/_atoms/state";

/** Newest warning/critical event, or null. */
export const newestAlertAtom = atom((get) => get(eventsAtom).find((e) => e.severity !== "info") ?? null);

/** A warning/critical event arrived after the user last opened the Activity tab. */
export const unseenAlertAtom = atom((get) => {
  const newest = get(newestAlertAtom);
  const seen = get(lastSeenAlertAtom);
  return newest !== null && (seen === null || newest.createdAt > seen);
});

export const markAlertsSeenAtom = atom(null, (get, set) => {
  const newest = get(newestAlertAtom);
  if (newest) set(lastSeenAlertAtom, newest.createdAt);
});
