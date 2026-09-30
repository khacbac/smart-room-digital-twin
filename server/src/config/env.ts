import { z } from "zod";

// Validated once at startup; the process exits on invalid config.

const bool = z.enum(["true", "false"]).transform((v) => v === "true");
const positive = z.coerce.number().positive();
const list = z.string().transform((v) => v.split(",").map((s) => s.trim()).filter(Boolean));

const Env = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  HOST: z.string().default("127.0.0.1"),
  /** Comma-separated dashboard origins (local dev + the Firebase Hosting domain later). */
  CORS_ORIGIN: list.default("http://localhost:3100"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),

  MQTT_URL: z.string().url().default("mqtt://127.0.0.1:1883"),
  MQTT_USERNAME: z.string().optional(),
  MQTT_PASSWORD: z.string().optional(),
  MQTT_TOPIC_PREFIX: z
    .string()
    .regex(/^[A-Za-z0-9_-]+$/, "letters, digits, '-' and '_' only")
    .default("srdt"),

  // Storage: `memory` works today, `firestore` is the stub for the cloud team.
  STORAGE_DRIVER: z.enum(["memory", "firestore"]).default("memory"),
  GCP_PROJECT_ID: z.string().optional(),

  SEED_DEVICES: list.default("room-01"),
  AUTO_REGISTER_DEVICES: bool.default("true"),
  TELEMETRY_PERSIST_INTERVAL_SEC: positive.default(5),
  DEVICE_OFFLINE_AFTER_SEC: positive.default(45),
  COMMAND_ACK_TIMEOUT_SEC: positive.default(10),
  /** How much history `GET /api/devices/:code` returns for the charts. */
  SNAPSHOT_TELEMETRY_MIN: positive.default(15),
});

export type Config = z.infer<typeof Env>;

export function loadConfig(): Config {
  try {
    process.loadEnvFile(); // ./.env, if present
  } catch {
    // no .env file: use the real environment only
  }
  // `KEY=` in .env means "not set", so the default applies.
  const raw = Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== ""));
  const parsed = Env.safeParse(raw);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      console.error(`invalid config ${issue.path.join(".")}: ${issue.message}`);
    }
    process.exit(1);
  }
  return parsed.data;
}
