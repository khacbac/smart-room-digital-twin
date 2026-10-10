import { atom } from "jotai";
import { selectAtom } from "jotai/utils";
import type { EdgeState, ReportedState, TelemetryRecord } from "@srdt/contracts";
import { latest } from "@srdt/twin-core";
import { deviceAtom, telemetryAtom } from "./state";

// Values derived from the twin that do not depend on the clock. Time-based ones (stale,
// last seen, countdowns) are computed where they are shown, with useNow().

function shallowEqual<T extends object>(a: T, b: T): boolean {
  if (a === b) return true;
  const keys = Object.keys(a) as (keyof T)[];
  return keys.length === Object.keys(b).length && keys.every((k) => Object.is(a[k], b[k]));
}

export const latestTelemetryAtom = atom<TelemetryRecord | null>((get) => latest(get(telemetryAtom)));

export const onlineAtom = atom((get) => get(deviceAtom)?.presence === "online");

export const edgeStateAtom = atom<EdgeState | null>(
  (get) => get(latestTelemetryAtom)?.edgeState ?? get(deviceAtom)?.edgeState ?? null,
);

const actuatorsSource = atom((get) => {
  const reported = get(deviceAtom)?.reported;
  const live = get(latestTelemetryAtom);
  // The reported status is sent right after every change, telemetry every 2 s.
  return {
    windowAngle: reported?.actuators.windowAngle ?? live?.windowAngle ?? null,
    buzzer: reported?.actuators.buzzer ?? live?.buzzer ?? null,
  };
});
export const actuatorsAtom = selectAtom(actuatorsSource, (v) => v, shallowEqual);

export const overrideAtom = atom<ReportedState["override"] | undefined>((get) => get(deviceAtom)?.reported?.override);

const mlSource = atom((get) => {
  const live = get(latestTelemetryAtom);
  return { mlState: live ? live.mlState : undefined, aiControl: live?.aiControl ?? false };
});
export const mlAtom = selectAtom(mlSource, (v) => v, shallowEqual);

const metaSource = atom((get) => {
  const d = get(deviceAtom);
  return {
    code: d?.code ?? null,
    name: d?.name ?? null,
    presence: d?.presence ?? "unknown",
    fw: d?.reported?.fw ?? d?.fwVersion ?? null,
    bootId: d?.reported?.bootId ?? d?.bootId ?? null,
    rssi: d?.reported?.rssi ?? null,
    uptimeSec: d?.reported?.uptimeSec ?? null,
    dhtFault: d?.reported?.sensorFault.dht ?? false,
    lastSeenAt: d?.lastSeenAt ?? null,
  };
});
export const deviceMetaAtom = selectAtom(metaSource, (v) => v, shallowEqual);

/** "Your connected room" when the device has no friendly name yet. */
export const roomNameAtom = atom((get) => {
  const d = get(deviceAtom);
  return !d || d.name === d.code ? "Your connected room" : d.name;
});
