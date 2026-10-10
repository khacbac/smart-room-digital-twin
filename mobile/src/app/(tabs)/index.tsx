import { View } from "react-native";
import { Screen } from "@/components/screen";
import { Text } from "@/components/text";
import { QuickActions } from "@/features/controls/components/quick-actions";
import { ScenesCard } from "@/features/controls/components/scenes-card";
import { HomeHeader } from "@/features/twin/components/home-header";
import { MetricGrid } from "@/features/twin/components/metric-grid";
import { RoomHero } from "@/features/twin/components/room-hero";
import { StatusCard } from "@/features/twin/components/status-card";

export default function HomeScreen() {
  return (
    <Screen refreshable header={<HomeHeader />}>
      <RoomHero />
      <QuickActions />
      <ScenesCard />
      <StatusCard />
      <MetricGrid />
      <View style={{ alignItems: "center", paddingTop: 8 }}>
        <Text variant="caption" tone="muted" style={{ textAlign: "center" }}>
          Smart Room Digital Twin · Connected spaces. Considered living.
        </Text>
      </View>
    </Screen>
  );
}
