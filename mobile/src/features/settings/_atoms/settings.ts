import Constants from "expo-constants";
import { DeviceId } from "@srdt/contracts";
import { persistedAtom } from "@/lib/storage/mmkv";

const extra = (Constants.expoConfig?.extra ?? {}) as { apiBaseUrl?: string; deviceCode?: string };

export const DEFAULT_API_BASE_URL = extra.apiBaseUrl ?? "http://10.0.2.2:4000";
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
