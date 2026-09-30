import { z } from "zod";
import { BootId, DeviceId } from "@srdt/contracts";

// Link-only JSON bodies (docs/link-protocol.md §4.2), twin of link_messages.*. Key order
// matches the firmware so both sides produce identical bytes.

export const Hello = z.object({ deviceId: DeviceId, bootId: BootId, fw: z.string().min(1).max(32) });
export type Hello = z.infer<typeof Hello>;

export const TimeSync = z.object({ ts: z.number().int().positive() });
export type TimeSync = z.infer<typeof TimeSync>;

/** Also the gateway heartbeat. `bootId` = the node registered from HELLO, absent before. */
export const LinkState = z.object({ mqtt: z.boolean(), rssi: z.number().int().optional(), bootId: BootId.optional() });
export type LinkState = z.infer<typeof LinkState>;

export const buildHello = (h: Hello) => Buffer.from(JSON.stringify({ deviceId: h.deviceId, bootId: h.bootId, fw: h.fw }));
export const buildTime = (ts: number) => Buffer.from(JSON.stringify({ ts }));
// JSON.stringify drops undefined fields, and keeps this key order.
export const buildLinkState = (s: LinkState) => Buffer.from(JSON.stringify({ mqtt: s.mqtt, rssi: s.rssi, bootId: s.bootId }));

/** Parses JSON and validates it; `null` on any failure. */
export function parseJson<T>(schema: z.ZodType<T>, payload: Buffer): T | null {
  try {
    const r = schema.safeParse(JSON.parse(payload.toString("utf8")));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}
