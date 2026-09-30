import { pino, type Logger } from "pino";

export type { Logger };

export function createLogger(level: string): Logger {
  return pino({
    level,
    // Readable output in a terminal, JSON lines otherwise (e.g. `pnpm start > server.log`).
    transport: process.stdout.isTTY ? { target: "pino-pretty", options: { translateTime: "SYS:HH:MM:ss.l" } } : undefined,
  });
}

/** §16: payloads in logs are truncated to 256 chars. */
export function truncate(text: string, max = 256): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
