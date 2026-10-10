import { TextInput, View, type TextInputProps } from "react-native";
import { Text } from "@/components/text";
import { fontFamily } from "@/lib/theme/colors";
import { useTheme } from "@/lib/theme/theme";

export function Field(props: TextInputProps & { label: string; error?: string | null }) {
  const { colors } = useTheme();
  const { label, error, style, ...input } = props;
  return (
    <View style={{ gap: 6 }}>
      <Text variant="label" tone="muted">
        {label}
      </Text>
      <TextInput
        autoCapitalize="none"
        autoCorrect={false}
        placeholderTextColor={colors.muted}
        accessibilityLabel={label}
        {...input}
        style={[
          {
            minHeight: 48,
            paddingHorizontal: 14,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: error ? colors["state-danger"] : colors.border,
            backgroundColor: colors["surface-2"],
            color: colors.text,
            fontFamily: fontFamily[400],
            fontSize: 15,
          },
          style,
        ]}
      />
      {error ? (
        <Text variant="caption" tone="state-danger">
          {error}
        </Text>
      ) : null}
    </View>
  );
}
