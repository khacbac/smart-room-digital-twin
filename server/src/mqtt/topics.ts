// §6.2 topics: `{prefix}/{deviceId}/{kind}`.

export type InboundKind = "telemetry" | "status" | "event" | "command/ack";

const INBOUND: readonly InboundKind[] = ["telemetry", "status", "event", "command/ack"];

/** §6.3: what the backend subscribes to. */
export function subscriptions(prefix: string): string[] {
  return INBOUND.map((kind) => `${prefix}/+/${kind}`);
}

export function commandTopic(prefix: string, deviceCode: string): string {
  return `${prefix}/${deviceCode}/command`;
}

/** `null` for another prefix or an unknown kind (dropped by the pipeline). */
export function parseTopic(prefix: string, topic: string): { deviceId: string; kind: InboundKind } | null {
  if (!topic.startsWith(`${prefix}/`)) return null;
  const rest = topic.slice(prefix.length + 1);
  const slash = rest.indexOf("/");
  if (slash <= 0) return null;
  const kind = rest.slice(slash + 1);
  if (!(INBOUND as readonly string[]).includes(kind)) return null;
  return { deviceId: rest.slice(0, slash), kind: kind as InboundKind };
}
