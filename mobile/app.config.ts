import type { ConfigContext, ExpoConfig } from "expo/config";

// Dev-client builds install next to the preview APK, so they get their own id and name.
const IS_DEV = (process.env.EAS_BUILD_PROFILE ?? "development") === "development";

const LIGHT_BG = "#f6f7f4";
const DARK_BG = "#19211d";
const ACCENT = "#527562";

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: IS_DEV ? "Smart Room (Dev)" : "Smart Room",
  slug: "smart-room",
  scheme: "smartroom",
  version: "0.1.0",
  orientation: "portrait",
  icon: "./assets/images/icon.png",
  userInterfaceStyle: "automatic",
  platforms: ["android"],
  android: {
    package: IS_DEV ? "dev.srdt.smartroom.dev" : "dev.srdt.smartroom",
    adaptiveIcon: {
      foregroundImage: "./assets/images/adaptive-icon.png",
      backgroundColor: ACCENT,
    },
    permissions: ["android.permission.INTERNET", "android.permission.RECORD_AUDIO"],
  },
  plugins: [
    "expo-router",
    "expo-font",
    "expo-image",
    [
      "expo-splash-screen",
      {
        image: "./assets/images/splash-icon.png",
        imageWidth: 120,
        resizeMode: "contain",
        backgroundColor: LIGHT_BG,
        dark: { image: "./assets/images/splash-icon.png", backgroundColor: DARK_BG },
      },
    ],
    [
      "expo-speech-recognition",
      {
        microphonePermission: "Smart Room listens when you tap the mic, to understand what you ask the room.",
        // Google's recognition service (Vietnamese and English)
        androidSpeechServicePackages: ["com.google.android.googlequicksearchbox", "com.google.android.as"],
      },
    ],
    [
      "expo-build-properties",
      {
        // The backend is plain HTTP on the LAN (docs/architecture.md §2): no TLS in this project.
        android: { usesCleartextTraffic: true },
      },
    ],
  ],
  experiments: { typedRoutes: true },
  extra: {
    apiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL || "http://10.0.2.2:4000",
    deviceCode: process.env.EXPO_PUBLIC_DEVICE_CODE || "room-01",
  },
});
