import type { Logger } from "../logger";

// §9.4 server-side rules. The backend never drives actuators (edge-first).

export const OFFLINE_SWEEP_MS = 10_000;
export const TIMEOUT_SWEEP_MS = 2_000;

export interface Sweepers {
  devices: { sweep(): Promise<void> };
  commands: { sweepTimeouts(): Promise<void> };
}

/** Starts the offline and command-timeout sweepers; returns a stop function. */
export function startServerRules({ devices, commands }: Sweepers, log: Logger): () => void {
  const run = (name: string, task: () => Promise<void>) => () => {
    task().catch((err: unknown) => log.error({ err, rule: name }, "server rule failed"));
  };
  const timers = [
    setInterval(run("offline", () => devices.sweep()), OFFLINE_SWEEP_MS),
    setInterval(run("command-timeout", () => commands.sweepTimeouts()), TIMEOUT_SWEEP_MS),
  ];
  return () => timers.forEach(clearInterval);
}
