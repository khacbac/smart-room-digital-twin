import Constants from "expo-constants";
import { Platform } from "react-native";
import { DeviceId } from "@srdt/contracts";
import { persistedAtom } from "@/lib/storage/mmkv";

const extra = (Constants.expoConfig?.extra ?? {}) as { apiBaseUrl?: string; deviceCode?: string };

const API_PORT = 4000;
const EMULATOR_HOST = "10.0.2.2";

// Android emulator images report a "generic"/"sdk_gphone"/"emulator" build fingerprint.
function isAndroidEmulator(): boolean {
  if (Platform.OS !== "android") return false;
  const { Fingerprint = "", Model = "" } = Platform.constants as { Fingerprint?: string; Model?: string };
  return /generic|emulator|sdk_gphone/i.test(Fingerprint) || /emulator|sdk_gphone|Android SDK built/i.test(Model);
}

// The host Metro serves the bundle from ("192.168.1.10:8081" → "192.168.1.10"). In dev the server runs on the
// same machine, so this follows the laptop's current LAN IP on both the emulator and a real phone.
function metroHost(): string | undefined {
  const uri =
    Constants.expoConfig?.hostUri ??
    (Constants as { expoGoConfig?: { debuggerHost?: string } }).expoGoConfig?.debuggerHost;
  return uri?.split(":")[0] || undefined;
}

/**
 * Default backend URL until the user saves one in Settings:
 *  - `EXPO_PUBLIC_API_BASE_URL` when set (a release build, or a shared backend);
 *  - in dev, the Metro host on the server port. Loopback (Metro reached through `adb reverse`) becomes 10.0.2.2
 *    on the emulator and stays 127.0.0.1 on a phone, which then needs `adb reverse tcp:4000 tcp:4000`;
 *  - otherwise 10.0.2.2, the host machine seen from the emulator.
 */
function resolveDefaultApiBaseUrl(): string {
  if (extra.apiBaseUrl) return extra.apiBaseUrl;
  const host = __DEV__ ? metroHost() : undefined;
  if (!host) return `http://${EMULATOR_HOST}:${API_PORT}`;
  const loopback = host === "localhost" || host === "127.0.0.1";
  return `http://${loopback && isAndroidEmulator() ? EMULATOR_HOST : host}:${API_PORT}`;
}

export const DEFAULT_API_BASE_URL = resolveDefaultApiBaseUrl();
export const DEFAULT_DEVICE_CODE = extra.deviceCode ?? "room-01";

export const apiBaseUrlAtom = persistedAtom("apiBaseUrl", DEFAULT_API_BASE_URL);
export const deviceCodeAtom = persistedAtom("deviceCode", DEFAULT_DEVICE_CODE);

export type ThemePreference = "system" | "light" | "dark";
export const themePreferenceAtom = persistedAtom<ThemePreference>("theme", "system");

export type HeroMode = "twin" | "photo";
export const heroModeAtom = persistedAtom<HeroMode>("heroMode", "twin");

export type Series = "temperature" | "humidity" | "airQuality";
export const trendSeriesAtom = persistedAtom<Series>("trendSeries", "temperature");

/** createdAt of the newest warning/critical event the user has seen on the Activity tab. */
export const lastSeenAlertAtom = persistedAtom<string | null>("lastSeenAlert", null);

/** "http://host[:port]" without a trailing slash, or null when it is not one. */
export function normaliseBaseUrl(input: string): string | null {
  const trimmed = input.trim().replace(/\/+$/, "");
  return /^https?:\/\/[^\s/?#]+$/i.test(trimmed) ? trimmed : null;
}

export function isValidDeviceCode(code: string): boolean {
  return DeviceId.safeParse(code.trim()).success;
}

export type VoiceLocale = "vi-VN" | "en-US";
export const voiceLocaleAtom = persistedAtom<VoiceLocale>("voiceLocale", "vi-VN");
export const voiceSpeakRepliesAtom = persistedAtom<boolean>("voiceSpeakReplies", true);
