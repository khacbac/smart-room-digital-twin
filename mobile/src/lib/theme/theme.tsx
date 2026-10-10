import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useColorScheme, View } from "react-native";
import { vars } from "nativewind";
import { useAtomValue } from "jotai";
import { themePreferenceAtom } from "@/features/settings/_atoms/settings";
import { metricTones, palette, type ThemeColors } from "./colors";

// Light/dark follows the system unless forced in Settings. Colours reach Tailwind classes
// as CSS variables on this root view, and raw hex through useTheme().

interface Theme {
  scheme: "light" | "dark";
  colors: ThemeColors;
  tones: typeof metricTones.light;
}

const ThemeContext = createContext<Theme>({ scheme: "light", colors: palette.light, tones: metricTones.light });

const cssVars = {
  light: vars(Object.fromEntries(Object.entries(palette.light).map(([k, v]) => [`--${k}`, v]))),
  dark: vars(Object.fromEntries(Object.entries(palette.dark).map(([k, v]) => [`--${k}`, v]))),
};

export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const preference = useAtomValue(themePreferenceAtom);
  const scheme = preference === "system" ? (system === "dark" ? "dark" : "light") : preference;
  const theme = useMemo(() => ({ scheme, colors: palette[scheme], tones: metricTones[scheme] }), [scheme]);
  return (
    <ThemeContext.Provider value={theme}>
      <View style={[{ flex: 1, backgroundColor: theme.colors.bg }, cssVars[scheme]]}>{children}</View>
    </ThemeContext.Provider>
  );
}

export function useTheme(): Theme {
  return useContext(ThemeContext);
}
