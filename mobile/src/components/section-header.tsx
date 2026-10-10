import type { ReactNode } from "react";
import { View } from "react-native";
import { Text } from "./text";

/** Card title + one-line description, with an optional slot on the right (dashboard `card-head`). */
export function SectionHeader(props: { title: string; description?: string; right?: ReactNode }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 16 }}>
      <View style={{ flex: 1 }}>
        <Text variant="heading" accessibilityRole="header">
          {props.title}
        </Text>
        {props.description ? (
          <Text variant="caption" tone="muted" style={{ marginTop: 2 }}>
            {props.description}
          </Text>
        ) : null}
      </View>
      {props.right}
    </View>
  );
}
