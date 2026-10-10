import "../../global.css";
import { useEffect } from "react";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import * as SystemUI from "expo-system-ui";
import { Provider as JotaiProvider, getDefaultStore } from "jotai";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import {
  NunitoSans_400Regular,
  NunitoSans_600SemiBold,
  NunitoSans_700Bold,
  useFonts,
} from "@expo-google-fonts/nunito-sans";
import { ThemeProvider, useTheme } from "@/lib/theme/theme";
import { TwinStream } from "@/features/twin/twin-stream";

void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({ NunitoSans_400Regular, NunitoSans_600SemiBold, NunitoSans_700Bold });
  const ready = fontsLoaded || !!fontError;

  useEffect(() => {
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);

  return (
    <JotaiProvider store={getDefaultStore()}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaProvider>
          <ThemeProvider>
            <TwinStream />
            {ready && <Navigator />}
          </ThemeProvider>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </JotaiProvider>
  );
}

function Navigator() {
  const { colors, scheme } = useTheme();
  useEffect(() => {
    // the window behind the app shows during transitions and the keyboard animation
    void SystemUI.setBackgroundColorAsync(colors.bg);
  }, [colors.bg]);
  return (
    <>
      <StatusBar style={scheme === "dark" ? "light" : "dark"} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg }, animation: "fade" }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="settings" options={{ animation: "slide_from_right" }} />
      </Stack>
    </>
  );
}
