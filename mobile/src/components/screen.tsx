import type { ReactNode } from "react";
import { RefreshControl, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSetAtom } from "jotai";
import { useState } from "react";
import { reconnectAtom } from "@/features/twin/_atoms/state";
import { ConnectionBanner } from "@/features/twin/components/connection-banner";
import { useTheme } from "@/lib/theme/theme";

/**
 * Scrollable page with the app's margins. Pull-to-refresh reconnects the live stream
 * (the snapshot that follows replaces everything).
 */
export function Screen(props: { header?: ReactNode; children: ReactNode; refreshable?: boolean; gap?: number }) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const reconnect = useSetAtom(reconnectAtom);
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = () => {
    setRefreshing(true);
    reconnect();
    // the stream reports its own state; the spinner is only an acknowledgement
    setTimeout(() => setRefreshing(false), 700);
  };
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + 12, paddingHorizontal: 20, paddingBottom: 32, gap: props.gap ?? 16 }}
        refreshControl={
          props.refreshable ? (
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              colors={[colors.accent]}
              progressBackgroundColor={colors.surface}
              progressViewOffset={insets.top}
            />
          ) : undefined
        }
      >
        {props.header}
        <ConnectionBanner />
        {props.children}
      </ScrollView>
    </View>
  );
}
