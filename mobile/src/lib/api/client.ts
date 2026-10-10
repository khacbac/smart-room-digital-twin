import { getDefaultStore } from "jotai";
import { apiBaseUrlAtom } from "@/features/settings/_atoms/settings";

// REST calls to the backend. Commands always go through it: the backend is the only MQTT
// client allowed to publish to the device.

const TIMEOUT_MS = 8000;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function request<T>(
  method: "GET" | "POST",
  path: string,
  body?: unknown,
  opts: { baseUrl?: string; timeoutMs?: number } = {},
): Promise<T> {
  // Read at call time: the URL can change in Settings while the app runs.
  const baseUrl = opts.baseUrl ?? getDefaultStore().get(apiBaseUrlAtom);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch {
    throw new ApiError(0, "BACKEND_UNREACHABLE", `Can't reach the backend at ${baseUrl}. Check Settings`);
  } finally {
    clearTimeout(timer);
  }
  const json: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const err = (json as { error?: { code?: string; message?: string } } | null)?.error;
    throw new ApiError(res.status, err?.code ?? `HTTP_${res.status}`, err?.message ?? `HTTP ${res.status}`);
  }
  return json as T;
}
