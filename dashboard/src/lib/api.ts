import type { CommandAction, CommandStatus } from "@srdt/contracts";
import { config } from "./config";

// Commands always go through the backend: it is the only MQTT client allowed to publish
// to the device, whatever storage/realtime the dashboard reads from.

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface CommandBody {
  action: CommandAction;
  value?: number;
  source: "dashboard";
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${config.apiBaseUrl}${path}`, {
      method: "POST",
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    // A CORS rejection looks exactly like a network error to fetch, so name both causes.
    throw new ApiError(
      0,
      "BACKEND_UNREACHABLE",
      `backend not reachable at ${config.apiBaseUrl} (is \`pnpm dev:server\` running, and is CORS_ORIGIN ${window.location.origin}?)`,
    );
  }
  const json: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const err = (json as { error?: { code?: string; message?: string } } | null)?.error;
    throw new ApiError(res.status, err?.code ?? `HTTP_${res.status}`, err?.message ?? res.statusText);
  }
  return json as T;
}

export function sendCommand(deviceCode: string, body: CommandBody): Promise<{ commandId: string; status: CommandStatus }> {
  return post(`/api/devices/${deviceCode}/commands`, body);
}
