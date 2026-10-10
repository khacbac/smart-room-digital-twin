import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, BackHandler, KeyboardAvoidingView, Linking, Pressable, ScrollView, StyleSheet, TextInput, useWindowDimensions, View } from "react-native";
import * as Speech from "expo-speech";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { Keyboard, Mic, Send, Sparkles, Volume2, X } from "lucide-react-native";
import Animated, { FadeIn, FadeInDown, SlideInDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button } from "@/components/button";
import { Text } from "@/components/text";
import { fontFamily } from "@/lib/theme/colors";
import { useTheme } from "@/lib/theme/theme";
import { voiceLocaleAtom, voiceSpeakRepliesAtom } from "@/features/settings/_atoms/settings";
import { sendCommandAtom } from "@/features/controls/_atoms/mutations";
import { askAssistantAtom, clearVoiceSessionAtom, voiceTurnsAtom, type VoiceTurn } from "@/features/voice/_atoms/session";
import { CommandResult } from "@/features/voice/components/command-result";
import { Waveform } from "@/features/voice/components/waveform";
import { useSpeech, type SpeechError } from "@/features/voice/use-speech";
import { Touchable } from "@/components/touchable";

const SUGGESTIONS = {
  "vi-VN": ["Mở cửa sổ một nửa", "Phòng đang thế nào?", "Tắt còi đi"],
  "en-US": ["Open the window halfway", "How is the room?", "Silence the alarm"],
};

const SPEECH_ERROR: Record<SpeechError, string> = {
  permission: "Microphone access is off. Allow it in Settings, or type instead.",
  "no-speech": "I didn't catch that. Try again?",
  network: "Speech recognition needs the internet for this language. Check the connection or type instead.",
  unavailable: "Speech recognition isn't available on this phone for this language. Try English, or type instead.",
  other: "Something went wrong with the microphone. Try again, or type instead.",
};

/**
 * Ask the room by voice (or text): the server's assistant answers and sends commands.
 * Rendered by the tabs layout over everything, tab bar included (see voiceOpenAtom).
 */
export function VoiceSheet({ onClose: close }: { onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const window = useWindowDimensions();
  const { colors } = useTheme();
  const [locale, setLocale] = useAtom(voiceLocaleAtom);
  const speak = useAtomValue(voiceSpeakRepliesAtom);
  const turns = useAtomValue(voiceTurnsAtom);
  const ask = useSetAtom(askAssistantAtom);
  const clear = useSetAtom(clearVoiceSessionAtom);
  const [typing, setTyping] = useState(false);
  const [draft, setDraft] = useState("");
  const [speaking, setSpeaking] = useState(false);
  const scroll = useRef<ScrollView>(null);
  const busy = turns.some((t) => !t.response && !t.error);

  const submit = useCallback(
    async (text: string) => {
      Speech.stop();
      const turn = await ask(text);
      if (speak && turn.response) {
        setSpeaking(true);
        Speech.speak(turn.response.reply, {
          language: locale,
          onDone: () => setSpeaking(false),
          onStopped: () => setSpeaking(false),
          onError: () => setSpeaking(false),
        });
      }
    },
    [ask, speak, locale],
  );

  const speech = useSpeech((text) => void submit(text));

  const listen = () => {
    Speech.stop();
    setTyping(false);
    void speech.start(locale);
  };

  // open → start listening right away; close → stop everything and forget the session
  useEffect(() => {
    listen();
    return () => {
      Speech.stop();
      speech.abort();
      clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => (close(), true));
    return () => sub.remove();
  }, [close]);

  return (
    <View style={[StyleSheet.absoluteFill, { justifyContent: "flex-end" }]}>
      <Animated.View entering={FadeIn.duration(200)} style={{ position: "absolute", inset: 0, backgroundColor: "rgba(10,16,12,0.45)" }}>
        <Pressable accessibilityLabel="Close" style={{ flex: 1 }} onPress={close} />
      </Animated.View>
      <KeyboardAvoidingView behavior="padding" enabled={typing}>
        <Animated.View
          entering={SlideInDown.duration(280)}
          style={{
            // a number, not "78%": the KeyboardAvoidingView around it has no height to take a percentage of
            height: Math.max(460, Math.round(window.height * 0.78)),
            backgroundColor: colors.surface,
            borderTopLeftRadius: 28,
            borderTopRightRadius: 28,
            paddingTop: 10,
            paddingBottom: insets.bottom + 12,
          }}
        >
          <View style={{ alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border }} />
          <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 20, paddingVertical: 12, gap: 10 }}>
            <Sparkles size={20} color={colors.accent} />
            <Text variant="heading" style={{ flex: 1 }}>
              Ask your room
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Language ${locale === "vi-VN" ? "Vietnamese" : "English"}, tap to switch`}
              onPress={() => setLocale(locale === "vi-VN" ? "en-US" : "vi-VN")}
              style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: colors["surface-2"] }}
            >
              <Text variant="label">{locale === "vi-VN" ? "Tiếng Việt" : "English"}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Close" hitSlop={10} onPress={close}>
              <X size={22} color={colors.muted} />
            </Pressable>
          </View>

          <ScrollView
            ref={scroll}
            onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })}
            contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 12, gap: 12, flexGrow: 1 }}
          >
            {turns.length === 0 && !speech.listening && (
              <View style={{ flex: 1, justifyContent: "center", gap: 10 }}>
                <Text variant="body" tone="muted" style={{ textAlign: "center" }}>
                  Try one of these, or tap the microphone and speak.
                </Text>
                {SUGGESTIONS[locale].map((s) => (
                  <Touchable
                    key={s}
                    accessibilityRole="button"
                    onPress={() => void submit(s)}
                    style={({ pressed }) => ({
                      alignSelf: "center",
                      paddingHorizontal: 16,
                      paddingVertical: 10,
                      borderRadius: 999,
                      borderWidth: 1,
                      borderColor: colors.border,
                      backgroundColor: pressed ? colors["surface-2"] : colors.surface,
                    })}
                  >
                    <Text variant="label">“{s}”</Text>
                  </Touchable>
                ))}
              </View>
            )}
            {turns.map((t, i) => (
              <Turn key={t.id} turn={t} last={i === turns.length - 1} speaking={speaking} onStopSpeaking={() => Speech.stop()} onRetry={() => void submit(t.text)} />
            ))}
            {speech.listening && (speech.transcript || speech.interim) ? (
              <Animated.View entering={FadeIn} style={{ alignSelf: "flex-end", maxWidth: "85%" }}>
                <Text variant="title" style={{ textAlign: "right" }}>
                  {speech.transcript}{" "}
                  <Text variant="title" tone="muted">
                    {speech.interim}
                  </Text>
                </Text>
              </Animated.View>
            ) : null}
            {speech.error && !speech.listening && (
              <View style={{ padding: 12, borderRadius: 12, backgroundColor: colors["uncomfortable-tint"], gap: 8 }}>
                <Text variant="label" color={colors["state-uncomfortable"]}>
                  {SPEECH_ERROR[speech.error]}
                </Text>
                {speech.error === "permission" && (
                  <Button compact label="Open settings" variant="outline" onPress={() => void Linking.openSettings()} />
                )}
              </View>
            )}
          </ScrollView>

          {typing ? (
            <View style={{ flexDirection: "row", gap: 8, paddingHorizontal: 20, alignItems: "center" }}>
              <TextInput
                autoFocus
                value={draft}
                onChangeText={setDraft}
                placeholder={locale === "vi-VN" ? "Nhập câu hỏi…" : "Type a request…"}
                placeholderTextColor={colors.muted}
                returnKeyType="send"
                onSubmitEditing={() => {
                  if (draft.trim()) void submit(draft.trim());
                  setDraft("");
                }}
                style={{
                  flex: 1,
                  minHeight: 48,
                  paddingHorizontal: 14,
                  borderRadius: 24,
                  backgroundColor: colors["surface-2"],
                  color: colors.text,
                  fontFamily: fontFamily[400],
                  fontSize: 15,
                }}
              />
              <RoundButton
                label="Send"
                disabled={!draft.trim() || busy}
                onPress={() => {
                  void submit(draft.trim());
                  setDraft("");
                }}
              >
                <Send size={20} color={colors["accent-text"]} />
              </RoundButton>
              <RoundButton label="Speak instead" quiet onPress={listen}>
                <Mic size={20} color={colors.text} />
              </RoundButton>
            </View>
          ) : (
            <View style={{ alignItems: "center", gap: 6 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 24 }}>
                <View style={{ width: 44 }} />
                <Touchable
                  accessibilityRole="button"
                  accessibilityLabel={speech.listening ? "Stop listening" : "Tap to talk"}
                  disabled={busy}
                  onPress={() => (speech.listening ? speech.stop() : listen())}
                  style={({ pressed }) => ({
                    width: 72,
                    height: 72,
                    borderRadius: 36,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: speech.listening ? colors["accent-tint"] : colors.accent,
                    borderWidth: speech.listening ? 2 : 0,
                    borderColor: colors.accent,
                    opacity: busy ? 0.5 : pressed ? 0.85 : 1,
                  })}
                >
                  {speech.listening ? (
                    <Waveform level={speech.volume} color={colors.accent} />
                  ) : busy ? (
                    <ActivityIndicator color={colors["accent-text"]} />
                  ) : (
                    <Mic size={30} color={colors["accent-text"]} />
                  )}
                </Touchable>
                <RoundButton label="Type instead" quiet onPress={() => (speech.abort(), setTyping(true))}>
                  <Keyboard size={20} color={colors.text} />
                </RoundButton>
              </View>
              {/* fixed width: Android keeps the first measured width when the label changes */}
              <Text variant="caption" tone="muted" style={{ width: 240, textAlign: "center" }}>
                {speech.listening ? "Listening… tap to stop" : busy ? "Thinking…" : turns.length ? "Ask again" : "Tap to talk"}
              </Text>
            </View>
          )}
        </Animated.View>
      </KeyboardAvoidingView>
    </View>
  );
}

function RoundButton(props: { label: string; onPress: () => void; disabled?: boolean; quiet?: boolean; children: React.ReactNode }) {
  const { colors } = useTheme();
  return (
    <Touchable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      disabled={props.disabled}
      onPress={props.onPress}
      style={({ pressed }) => ({
        width: 44,
        height: 44,
        borderRadius: 22,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: props.quiet ? colors["surface-2"] : colors.accent,
        opacity: props.disabled ? 0.4 : pressed ? 0.8 : 1,
      })}
    >
      {props.children}
    </Touchable>
  );
}

function Turn(props: { turn: VoiceTurn; last: boolean; speaking: boolean; onStopSpeaking: () => void; onRetry: () => void }) {
  const { colors } = useTheme();
  const send = useSetAtom(sendCommandAtom);
  const [confirmed, setConfirmed] = useState<"yes" | "no" | null>(null);
  const { turn } = props;
  const res = turn.response;
  return (
    <Animated.View entering={FadeInDown.duration(220)} style={{ gap: 8 }}>
      <View style={{ alignSelf: "flex-end", maxWidth: "85%", padding: 12, borderRadius: 18, borderBottomRightRadius: 6, backgroundColor: colors["accent-tint"] }}>
        <Text variant="body">{turn.text}</Text>
      </View>
      {!res && !turn.error && (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <ActivityIndicator size="small" color={colors.accent} />
          <Text variant="caption" tone="muted">
            Thinking…
          </Text>
        </View>
      )}
      {turn.error && (
        <View style={{ padding: 12, borderRadius: 12, backgroundColor: colors["danger-tint"], gap: 8 }}>
          <Text variant="label" tone="state-danger">
            {turn.error}
          </Text>
          <Button compact label="Retry" variant="outline" onPress={props.onRetry} />
        </View>
      )}
      {res && (
        <>
          <Pressable
            accessibilityRole={props.last && props.speaking ? "button" : undefined}
            accessibilityHint={props.last && props.speaking ? "Stops reading aloud" : undefined}
            onPress={props.last && props.speaking ? props.onStopSpeaking : undefined}
            style={{ alignSelf: "flex-start", maxWidth: "90%", flexDirection: "row", gap: 8, padding: 12, borderRadius: 18, borderBottomLeftRadius: 6, backgroundColor: colors["surface-2"] }}
          >
            {props.last && props.speaking ? <Volume2 size={16} color={colors.accent} /> : <Sparkles size={16} color={colors.accent} />}
            <Text variant="body" style={{ flexShrink: 1 }}>
              {res.reply}
            </Text>
          </Pressable>
          {res.commands.map((c, i) => (
            <CommandResult key={c.commandId ?? `${c.action}-${i}`} result={c} />
          ))}
          {res.pendingConfirmation.length > 0 && confirmed === null && (
            <View style={{ padding: 12, borderRadius: 12, borderWidth: 1, borderColor: colors["danger-line"], backgroundColor: colors["danger-tint"], gap: 10 }}>
              <Text variant="label" tone="state-danger">
                The alarm will sound in the room.
              </Text>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <Button
                  flex
                  compact
                  label="Turn on alarm"
                  variant="danger"
                  onPress={() => {
                    setConfirmed("yes");
                    void send({ action: "BUZZER_ON", source: "ai" });
                  }}
                />
                <Button flex compact label="Cancel" variant="outline" onPress={() => setConfirmed("no")} />
              </View>
            </View>
          )}
        </>
      )}
    </Animated.View>
  );
}
