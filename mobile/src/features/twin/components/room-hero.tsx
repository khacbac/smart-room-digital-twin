import { useAtom, useAtomValue } from "jotai";
import { useRouter } from "expo-router";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { Box, ImageIcon } from "lucide-react-native";
import { Pressable, View } from "react-native";
import { STATE_LABEL, fmt } from "@srdt/twin-core";
import { Card } from "@/components/card";
import { SegmentedControl } from "@/components/segmented-control";
import { Text } from "@/components/text";
import { STATE_TOKEN } from "@/lib/theme/state-color";
import { useTheme } from "@/lib/theme/theme";
import { heroModeAtom } from "@/features/settings/_atoms/settings";
import { actuatorsAtom, edgeStateAtom, latestTelemetryAtom, onlineAtom, roomNameAtom } from "../_atoms/derived";
import { RoomTwinSvg } from "./room-twin-svg";

const ROOM_PHOTO = require("../../../../assets/images/room-interior.jpg");

/** The room as a live drawing (default on the phone) or the illustrative photo. */
export function RoomHero() {
  const [mode, setMode] = useAtom(heroModeAtom);
  const { colors } = useTheme();
  const router = useRouter();
  const online = useAtomValue(onlineAtom);
  const edgeState = useAtomValue(edgeStateAtom);
  const live = useAtomValue(latestTelemetryAtom);
  const { windowAngle, buzzer } = useAtomValue(actuatorsAtom);
  const roomName = useAtomValue(roomNameAtom);
  const stateColor = !online ? colors.muted : edgeState ? colors[STATE_TOKEN[edgeState]] : colors.muted;

  return (
    <Card padded={false} style={{ overflow: "hidden" }}>
      <View style={{ padding: 16, paddingBottom: 12, flexDirection: "row", alignItems: "center", gap: 12 }}>
        <View style={{ flex: 1 }}>
          <Text variant="heading">Your space</Text>
          <Text variant="caption" tone="muted">
            A closer look at your connected room.
          </Text>
        </View>
        <View style={{ width: 170 }}>
          <SegmentedControl
            compact
            label="Room view"
            value={mode}
            onChange={setMode}
            segments={[
              { value: "photo", label: "Room" },
              { value: "twin", label: "Live twin" },
            ]}
          />
        </View>
      </View>
      <Pressable
        accessibilityRole={mode === "twin" ? "button" : undefined}
        accessibilityHint={mode === "twin" ? "Opens room controls" : undefined}
        disabled={mode !== "twin"}
        onPress={() => router.navigate("/controls")}
        style={{ aspectRatio: 680 / 350, backgroundColor: "#f4f1eb", opacity: online ? 1 : 0.7 }}
      >
        {mode === "twin" ? (
          <RoomTwinSvg
            view={{
              edgeState,
              windowAngle,
              buzzer,
              light: live?.light ?? null,
              airQuality: live?.airQuality ?? null,
              presence: live?.presence ?? null,
            }}
          />
        ) : (
          <Image
            source={ROOM_PHOTO}
            style={{ width: "100%", height: "100%" }}
            contentFit="cover"
            transition={200}
            accessibilityLabel="An illustrative bright living room with a neutral sofa, natural wood and greenery"
          />
        )}
        <LinearGradient
          colors={["rgba(20,30,24,0)", "rgba(20,30,24,0.55)"]}
          style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: "55%" }}
          pointerEvents="none"
        />
        {mode === "photo" && (
          <View style={{ position: "absolute", top: 10, left: 10, flexDirection: "row", gap: 4, alignItems: "center", backgroundColor: "rgba(255,255,255,0.85)", borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 }}>
            <ImageIcon size={11} color="#26382f" />
            <Text variant="caption" color="#26382f" style={{ fontSize: 11 }}>
              Illustrative room
            </Text>
          </View>
        )}
        {mode === "twin" && (
          <View style={{ position: "absolute", top: 10, left: 10, flexDirection: "row", gap: 4, alignItems: "center", backgroundColor: "rgba(255,255,255,0.85)", borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 }}>
            <Box size={11} color="#26382f" />
            <Text variant="caption" numeric color="#26382f" style={{ fontSize: 11 }}>
              {fmt(live?.temperature ?? null)} °C · {fmt(live?.humidity ?? null, 0)} % · {fmt(live?.light ?? null, 0)} lx ·{" "}
              {fmt(live?.airQuality ?? null, 0)} AQ
            </Text>
          </View>
        )}
        <View
          pointerEvents="none"
          style={{ position: "absolute", left: 14, right: 14, bottom: 12, flexDirection: "row", alignItems: "flex-end", gap: 8 }}
        >
          <View style={{ flex: 1 }}>
            <Text variant="eyebrow" color="rgba(255,255,255,0.85)">
              {mode === "twin" ? "Live digital twin" : "Your connected space"}
            </Text>
            <Text variant="heading" color="#ffffff" numberOfLines={1}>
              {roomName}
            </Text>
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(255,255,255,0.92)", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: stateColor }} />
            <Text variant="label" color="#26382f">
              {online ? (edgeState ? STATE_LABEL[edgeState] : "Awaiting data") : "Offline"}
            </Text>
          </View>
        </View>
      </Pressable>
      {mode === "photo" && (
        <Text variant="caption" tone="muted" style={{ paddingHorizontal: 16, paddingVertical: 8, fontSize: 11 }}>
          Photo: Spacejoy / Unsplash
        </Text>
      )}
    </Card>
  );
}
