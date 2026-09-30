import { randomUUID } from "node:crypto";
import type { DeviceEvent, EventRecord, ServerEventType, Severity } from "@srdt/contracts";
import type { Logger } from "../logger";
import type { Publisher } from "../realtime/hub";
import type { EventStore } from "../storage/types";

/** Events the backend raises itself (presence, command timeout). */
export interface ServerEventSink {
  server(
    deviceCode: string,
    type: ServerEventType,
    severity: Severity,
    message: string,
    data: Record<string, unknown>,
  ): Promise<void>;
}

export class EventService implements ServerEventSink {
  constructor(
    private readonly store: EventStore,
    private readonly hub: Publisher,
    private readonly log: Logger,
    private readonly now: () => number = Date.now,
  ) {}

  async device(deviceCode: string, event: DeviceEvent, measuredAt: Date): Promise<void> {
    await this.save({
      id: `${event.bootId}-${event.seq}`,
      deviceCode,
      source: "device",
      bootId: event.bootId,
      seq: event.seq,
      type: event.type,
      severity: event.severity,
      message: event.message,
      data: event.data,
      measuredAt: measuredAt.toISOString(),
      createdAt: new Date(this.now()).toISOString(),
    });
  }

  async server(
    deviceCode: string,
    type: ServerEventType,
    severity: Severity,
    message: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    const at = new Date(this.now()).toISOString();
    await this.save({
      id: randomUUID(),
      deviceCode,
      source: "server",
      bootId: null,
      seq: null,
      type,
      severity,
      message,
      data,
      measuredAt: at,
      createdAt: at,
    });
  }

  recent(deviceCode: string, limit: number): Promise<EventRecord[]> {
    return this.store.recent(deviceCode, limit);
  }

  private async save(record: EventRecord): Promise<void> {
    // Live first: the dashboard should see the event even if storage is down.
    this.hub.publish(record.deviceCode, { type: "event", data: record });
    try {
      await this.store.append(record);
    } catch (err) {
      this.log.error({ err, device: record.deviceCode, type: record.type }, "event not stored");
    }
  }
}
