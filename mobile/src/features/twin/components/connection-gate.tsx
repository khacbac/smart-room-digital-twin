import { useEffect, useState, type ReactNode } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import { useRouter } from "expo-router";
import { useAtomValue, useSetAtom } from "jotai";
import { ChevronDown, House, RefreshCw, Settings2 } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button } from "@/components/button";
import { Card } from "@/components/card";
import { Text } from "@/components/text";
import { connectionHint } from "@/lib/connection-hints";
import { useTheme } from "@/lib/theme/theme";
import { apiBaseUrlAtom, deviceCodeAtom } from "@/features/settings/_atoms/settings";
import { reconnectAtom, twinErrorAtom, twinStatusAtom } from "../_atoms/state";

/** Full-screen "getting your room ready" until the first snapshot (mobile/specs/04-screens.md §2). */
export function ConnectionGate({ children }: { children: ReactNode }) {
  const status = useAtomValue(twinStatusAtom);
  if (status === "ready") return <>{children}</>;
  return <GateScreen status={status} />;
}

function GateScreen({ status }: { status: "loading" | "error" }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const error = useAtomValue(twinErrorAtom);
  const baseUrl = useAtomValue(apiBaseUrlAtom);
  const deviceCode = useAtomValue(deviceCodeAtom);
  const reconnect = useSetAtom(reconnectAtom);
  const [slow, setSlow] = useState(false);
  const [details, setDetails] = useState(false);

  useEffect(() => {
    const id = setTimeout(() => setSlow(true), 8000);
    return () => clearTimeout(id);
  }, []);

  const loading = status === "loading";
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: colors.bg,
        justifyContent: "center",
        paddingHorizontal: 20,
        paddingTop: insets.top,
        paddingBottom: insets.bottom,
      }}
    >
      <Card style={{ alignItems: "center", paddingVertical: 32, gap: 10 }} accessibilityRole="summary">
        <View
          style={{
            width: 72,
            height: 72,
            borderRadius: 22,
            backgroundColor: colors["accent-tint"],
            alignItems: "center",
            justifyContent: "center",
            marginBottom: 8,
          }}
        >
          <House size={34} color={colors.accent} />
        </View>
        <Text variant="eyebrow" tone="muted">
          Your connected space
        </Text>
        <Text variant="title" style={{ textAlign: "center" }}>
          {loading ? "Getting your room ready" : "Let’s reconnect your room"}
        </Text>
        <Text variant="body" tone="muted" style={{ textAlign: "center" }}>
          {loading
            ? `Connecting to ${deviceCode}. Your live readings will appear here.`
            : "We can’t reach your room right now. We’ll keep trying automatically."}
        </Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginVertical: 8 }}>
          <ActivityIndicator size="small" color={colors.accent} />
          <Text variant="label" tone="muted">
            {loading ? "Connecting to your room…" : "Trying to reconnect…"}
          </Text>
        </View>
        <View style={{ alignSelf: "stretch", gap: 10 }}>
          {!loading && <Button label="Try again" icon={RefreshCw} onPress={reconnect} />}
          {(!loading || slow) && (
            <Button label="Connection settings" icon={Settings2} variant="quiet" onPress={() => router.push("/settings")} />
          )}
        </View>
        {!loading && (
          <View style={{ alignSelf: "stretch", marginTop: 6 }}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: details }}
              onPress={() => setDetails((d) => !d)}
              style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 8 }}
            >
              <ChevronDown size={16} color={colors.muted} style={{ transform: [{ rotate: details ? "180deg" : "0deg" }] }} />
              <Text variant="label" tone="muted">
                Connection details
              </Text>
            </Pressable>
            {details && (
              <View style={{ gap: 6, padding: 12, borderRadius: 12, backgroundColor: colors["surface-2"] }}>
                <Detail label="Backend">{baseUrl}</Detail>
                <Detail label="Device">{deviceCode}</Detail>
                {error && <Detail label="Error">{error}</Detail>}
                <Detail label="Try">{connectionHint(baseUrl)}</Detail>
              </View>
            )}
          </View>
        )}
      </Card>
    </View>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Text variant="caption" tone="muted">
      <Text variant="caption" weight={700}>
        {label}:{" "}
      </Text>
      {children}
    </Text>
  );
}
