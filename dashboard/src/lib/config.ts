// NEXT_PUBLIC_* values are inlined at build time, so each one is read by its full name.
export const config = {
  apiBaseUrl: (process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:4000").replace(/\/+$/, ""),
  deviceCode: process.env.NEXT_PUBLIC_DEVICE_CODE || "room-01",
  dataSource: (process.env.NEXT_PUBLIC_DATA_SOURCE || "backend") as "backend" | "firestore",
};
