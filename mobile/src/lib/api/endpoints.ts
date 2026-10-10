import type { AssistantRequest, AssistantResponse, CommandAction, CommandStatus, DeviceRecord } from "@srdt/contracts";
import { request } from "./client";

export interface CommandBody {
  action: CommandAction;
  value?: number;
  /** The contracts accept only "dashboard" (manual) and "ai" (voice) from clients. */
  source: "dashboard" | "ai";
}

export function sendCommand(deviceCode: string, body: CommandBody) {
  return request<{ commandId: string; status: CommandStatus }>(
    "POST",
    `/api/devices/${encodeURIComponent(deviceCode)}/commands`,
    body,
  );
}

/** `GET /health` (server/src/api/routes.ts). */
export interface Health {
  mqtt: "connected" | "disconnected";
  storage: { driver: string; ok: boolean };
  streamClients: number;
}

export function getHealth(baseUrl: string) {
  return request<Health>("GET", "/health", undefined, { baseUrl, timeoutMs: 5000 });
}

export function listDevices(baseUrl: string) {
  return request<DeviceRecord[]>("GET", "/api/devices", undefined, { baseUrl });
}

export function askAssistant(deviceCode: string, body: AssistantRequest) {
  // the server gives the model 10 s; leave room for the round trip
  return request<AssistantResponse>("POST", `/api/devices/${encodeURIComponent(deviceCode)}/assistant`, body, {
    timeoutMs: 15_000,
  });
}
