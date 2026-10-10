// What to try when the app cannot reach the backend, based on the URL in use
// (mobile/specs/02-data-layer.md §5).

export function connectionHint(baseUrl: string): string {
  let host = "";
  try {
    host = new URL(baseUrl).hostname;
  } catch {
    return "The backend URL is not valid. It should look like http://192.168.1.20:4000.";
  }
  if (host === "127.0.0.1" || host === "localhost")
    return "On a phone, 127.0.0.1 is the phone itself. Use 10.0.2.2 on the emulator, your computer's LAN IP on a phone, or run `adb reverse tcp:4000 tcp:4000` first.";
  if (host === "10.0.2.2") return "10.0.2.2 only works on the Android emulator. Is `pnpm dev:server` running?";
  return "Is the server running with HOST=0.0.0.0, and is the phone on the same Wi-Fi?";
}

/** One line for Settings: how the current URL reaches the backend. */
export function networkMode(baseUrl: string): string {
  try {
    const host = new URL(baseUrl).hostname;
    if (host === "10.0.2.2") return "Emulator → host machine (10.0.2.2)";
    if (host === "127.0.0.1" || host === "localhost") return "This device (needs adb reverse)";
    return `Network → ${host}`;
  } catch {
    return "Invalid URL";
  }
}
