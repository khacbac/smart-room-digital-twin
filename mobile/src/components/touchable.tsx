import { useState } from "react";
import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from "react-native";

export interface TouchableProps extends Omit<PressableProps, "style"> {
  style?: StyleProp<ViewStyle> | ((state: { pressed: boolean }) => StyleProp<ViewStyle>);
}

/**
 * Pressable whose style may depend on the pressed state. NativeWind's interop wrapper
 * drops function styles on Pressable, so the state is tracked here and a plain style passed.
 */
export function Touchable({ style, onPressIn, onPressOut, ...rest }: TouchableProps) {
  const [pressed, setPressed] = useState(false);
  return (
    <Pressable
      {...rest}
      onPressIn={(e) => {
        setPressed(true);
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        setPressed(false);
        onPressOut?.(e);
      }}
      style={typeof style === "function" ? style({ pressed }) : style}
    />
  );
}
