import { StyleSheet, View } from "react-native";
import { useTheme } from "@/lib/theme/theme";

export function Hairline({ inset = 0 }: { inset?: number }) {
  const { colors } = useTheme();
  return <View style={{ height: StyleSheet.hairlineWidth * 2, backgroundColor: colors.border, marginHorizontal: inset }} />;
}
