import { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { useAtom } from "jotai";
import type { DeviceRecord } from "@srdt/contracts";
import { CircleCheck, CircleX, PlugZap, Save, Search } from "lucide-react-native";
import { PRESENCE_LABEL } from "@srdt/twin-core";
import { Button } from "@/components/button";
import { Card } from "@/components/card";
import { Hairline } from "@/components/hairline";
import { SectionHeader } from "@/components/section-header";
import { Text } from "@/components/text";
import { ApiError } from "@/lib/api/client";
import { getHealth, listDevices } from "@/lib/api/endpoints";
import { connectionHint, networkMode } from "@/lib/connection-hints";
import { haptics } from "@/lib/haptics";
import { pushToast } from "@/lib/toast";
import { useTheme } from "@/lib/theme/theme";
import {
  DEFAULT_API_BASE_URL,
  apiBaseUrlAtom,
  deviceCodeAtom,
  isValidDeviceCode,
  normaliseBaseUrl,
} from "../_atoms/settings";
import { Field } from "./field";
import { Touchable } from "@/components/touchable";

type Check = { state: "idle" } | { state: "running" } | { state: "ok"; text: string } | { state: "fail"; text: string };

export function ConnectionSection() {
  const { colors } = useTheme();
  const [savedUrl, setSavedUrl] = useAtom(apiBaseUrlAtom);
  const [savedCode, setSavedCode] = useAtom(deviceCodeAtom);
  const [url, setUrl] = useState(savedUrl);
  const [code, setCode] = useState(savedCode);
  const [check, setCheck] = useState<Check>({ state: "idle" });
  const [devices, setDevices] = useState<DeviceRecord[] | null>(null);
  const [loadingDevices, setLoadingDevices] = useState(false);

  useEffect(() => setUrl(savedUrl), [savedUrl]);
  useEffect(() => setCode(savedCode), [savedCode]);

  const normalised = normaliseBaseUrl(url);
  const urlError = url.trim() && !normalised ? "Use http://host:port, for example http://192.168.1.20:4000" : null;
  const codeError = code.trim() && !isValidDeviceCode(code) ? "3–32 lowercase letters, digits or dashes" : null;
  const changed = normalised !== savedUrl || code.trim() !== savedCode;
  const canSave = !!normalised && isValidDeviceCode(code) && changed;

  const save = () => {
    if (!normalised) return;
    setSavedUrl(normalised);
    setSavedCode(code.trim());
    haptics.success();
    pushToast("success", "Saved. Reconnecting to your room…");
  };

  const test = async () => {
    const base = normalised ?? savedUrl;
    setCheck({ state: "running" });
    try {
      const h = await getHealth(base);
      setCheck({
        state: h.mqtt === "connected" && h.storage.ok ? "ok" : "fail",
        text: `Backend ✓ · MQTT ${h.mqtt} · storage ${h.storage.driver} ${h.storage.ok ? "✓" : "✗"}`,
      });
    } catch (err) {
      setCheck({ state: "fail", text: `${err instanceof ApiError ? err.message : String(err)}\n${connectionHint(base)}` });
    }
  };

  const findDevices = async () => {
    setLoadingDevices(true);
    try {
      setDevices(await listDevices(normalised ?? savedUrl));
    } catch (err) {
      pushToast("error", err instanceof ApiError ? err.message : String(err));
    } finally {
      setLoadingDevices(false);
    }
  };

  return (
    <Card>
      <SectionHeader title="Connection" description="Where the app finds your room." />
      <View style={{ gap: 14 }}>
        <Field
          label="Backend URL"
          value={url}
          onChangeText={setUrl}
          keyboardType="url"
          placeholder={DEFAULT_API_BASE_URL}
          error={urlError}
        />
        <Text variant="caption" tone="muted" style={{ marginTop: -8 }}>
          {networkMode(normalised ?? savedUrl)}
        </Text>
        <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-end" }}>
          <View style={{ flex: 1 }}>
            <Field label="Device code" value={code} onChangeText={setCode} placeholder="room-01" error={codeError} />
          </View>
          <Button label="Choose" icon={Search} variant="quiet" loading={loadingDevices} onPress={findDevices} />
        </View>
        {devices && (
          <View style={{ borderRadius: 12, borderWidth: 1, borderColor: colors.border, overflow: "hidden" }}>
            {devices.length === 0 ? (
              <Text variant="caption" tone="muted" style={{ padding: 12 }}>
                No devices yet. Start the device (or `pnpm --filter @srdt/server fake-device`) and try again.
              </Text>
            ) : (
              devices.map((d, i) => (
                <View key={d.code}>
                  {i > 0 && <Hairline />}
                  <Touchable
                    accessibilityRole="button"
                    onPress={() => {
                      setCode(d.code);
                      setDevices(null);
                    }}
                    style={({ pressed }) => ({
                      flexDirection: "row",
                      alignItems: "center",
                      padding: 12,
                      gap: 8,
                      backgroundColor: pressed ? colors["surface-2"] : d.code === code ? colors["accent-tint"] : colors.surface,
                    })}
                  >
                    <View style={{ flex: 1 }}>
                      <Text variant="label">{d.name}</Text>
                      <Text variant="caption" tone="muted">
                        {d.code}
                      </Text>
                    </View>
                    <Text variant="caption" tone={d.presence === "online" ? "state-normal" : "muted"}>
                      {PRESENCE_LABEL[d.presence]}
                    </Text>
                  </Touchable>
                </View>
              ))
            )}
          </View>
        )}
        <View style={{ flexDirection: "row", gap: 10 }}>
          <Button flex label="Save" icon={Save} disabled={!canSave} onPress={save} />
          <Button flex label="Test connection" icon={PlugZap} variant="quiet" onPress={test} />
        </View>
        {check.state !== "idle" && (
          <View
            accessibilityLiveRegion="polite"
            style={{ flexDirection: "row", gap: 8, padding: 12, borderRadius: 12, backgroundColor: colors["surface-2"] }}
          >
            {check.state === "running" ? (
              <ActivityIndicator size="small" color={colors.accent} />
            ) : check.state === "ok" ? (
              <CircleCheck size={18} color={colors["state-normal"]} />
            ) : (
              <CircleX size={18} color={colors["state-danger"]} />
            )}
            <Text variant="caption" style={{ flex: 1 }}>
              {check.state === "running" ? "Checking…" : check.text}
            </Text>
          </View>
        )}
      </View>
    </Card>
  );
}
