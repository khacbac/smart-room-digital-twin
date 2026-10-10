import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, BackHandler, KeyboardAvoidingView, Linking, Pressable, ScrollView, StyleSheet, TextInput, useWindowDimensions, View } from "react-native";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { CircleCheck, Keyboard, Mic, Send, Sparkles, Volume2, X } from "lucide-react-native";
import { isOpenStatus } from "@srdt/twin-core";
import Animated, { FadeIn, FadeInDown, SlideInDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button } from "@/components/button";
import { Text } from "@/components/text";
import { fontFamily } from "@/lib/theme/colors";
import { useTheme } from "@/lib/theme/theme";
import { voiceLocaleAtom, voiceSpeakRepliesAtom } from "@/features/settings/_atoms/settings";
import { sendCommandAtom } from "@/features/controls/_atoms/mutations";
import {
  addLocalTurnAtom,
  addTurnCommandAtom,
  askAssistantAtom,
  clearVoiceSessionAtom,
  patchTurnAtom,
  voiceTurnsAtom,
  type VoiceTurn,
} from "@/features/voice/_atoms/session";
import { commandsAtom } from "@/features/twin/_atoms/state";
import { BUZZER_CANCELLED, BUZZER_CONFIRMED, reportText, speechErrorText, yesNo, type FinishedCommand } from "@/features/voice/phrases";
import { useVoiceOut } from "@/features/voice/use-voice-out";
import { CommandResult } from "@/features/voice/components/command-result";
import { Waveform } from "@/features/voice/components/waveform";
import { useSpeech, type SpeechError } from "@/features/voice/use-speech";
import { Touchable } from "@/components/touchable";

const SUGGESTIONS = {
  "vi-VN": ["Mở cửa sổ một nửa", "Phòng đang thế nào?", "Tắt còi đi"],
  "en-US": ["Open the window halfway", "How is the room?", "Silence the alarm"],
};

/** No word from the device by then (the server times commands out after 10 s): say so anyway. */
const REPORT_GIVE_UP_MS = 20_000;

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
  const commands = useAtomValue(commandsAtom);
  const ask = useSetAtom(askAssistantAtom);
  const addLocalTurn = useSetAtom(addLocalTurnAtom);
  const addTurnCommand = useSetAtom(addTurnCommandAtom);
  const patchTurn = useSetAtom(patchTurnAtom);
  const send = useSetAtom(sendCommandAtom);
  const clear = useSetAtom(clearVoiceSessionAtom);
  const [typing, setTyping] = useState(false);
  const [draft, setDraft] = useState("");
  const scroll = useRef<ScrollView>(null);
  const busy = turns.some((t) => !t.response && !t.error);
  const voice = useVoiceOut(speak, locale);
  const turnsRef = useRef(turns);
  turnsRef.current = turns;
  const typingRef = useRef(typing);
  typingRef.current = typing;

  /** Sends the alarm the user agreed to; the report follows on `target`'s commands. */
  const confirmBuzzer = useCallback(
    async (pending: VoiceTurn, answer: "yes" | "no", target: VoiceTurn = pending) => {
      patchTurn(pending.id, { confirmation: answer });
      if (answer === "no") return;
      const commandId = await send({ action: "BUZZER_ON", source: "ai" });
      if (commandId) addTurnCommand(target.id, { action: "BUZZER_ON", value: null, commandId, status: "sent", error: null });
    },
    [patchTurn, send, addTurnCommand],
  );

  const submit = useCallback(
    async (text: string) => {
      voice.stop();
      // a spoken answer to "do you really want the alarm?" is handled here, not by the model
      const last = turnsRef.current.at(-1);
      if (last?.response?.pendingConfirmation.length && last.confirmation === null) {
        const answer = yesNo(text);
        if (answer) {
          const turn = addLocalTurn(text, (answer === "yes" ? BUZZER_CONFIRMED : BUZZER_CANCELLED)[locale]);
          voice.say(turn.response!.reply);
          await confirmBuzzer(last, answer, turn);
          return;
        }
      }
      const turn = await ask(text);
      if (turn.error) voice.say(turn.error);
      else if (turn.response)
        // a question gets an answer: listen again once it has been said (not while typing)
        voice.say(turn.response.reply, turn.response.expectsAnswer ? () => !typingRef.current && listenRef.current(true) : undefined);
    },
    [ask, addLocalTurn, confirmBuzzer, locale, voice],
  );

  const speech = useSpeech((text) => void submit(text));

  /** `auto`: after the assistant asked something; keeps anything still queued to say. */
  const listen = (auto = false) => {
    if (!auto) voice.stop();
    setTyping(false);
    void speech.start(locale);
  };
  const listenRef = useRef(listen);
  listenRef.current = listen;

  // say recognition errors too, so a failed attempt never ends in silence
  useEffect(() => {
    const text = speech.error && speechErrorText(locale, speech.error);
    if (text) voice.say(text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [speech.error]);

  // once every command of a turn has a final status, say how it went
  const [tick, setTick] = useState(0);
  const firstSeen = useRef(new Map<string, number>());
  useEffect(() => {
    let wake = Infinity;
    for (const t of turns) {
      const sent = t.response?.commands.filter((c) => c.commandId && !c.error) ?? [];
      if (!t.response || t.report !== null || sent.length === 0) continue;
      const key = `${t.id}:${sent.map((c) => c.commandId).join(",")}`;
      const since = firstSeen.current.get(key) ?? Date.now();
      firstSeen.current.set(key, since);
      const givenUp = Date.now() - since >= REPORT_GIVE_UP_MS;
      const finished: FinishedCommand[] = [];
      for (const c of sent) {
        const status = commands.find((r) => r.id === c.commandId)?.status ?? c.status ?? "pending";
        if (!isOpenStatus(status)) finished.push({ action: c.action, value: c.value, status });
        else if (givenUp) finished.push({ action: c.action, value: c.value, status: "lost" });
      }
      if (finished.length < sent.length) {
        wake = Math.min(wake, since + REPORT_GIVE_UP_MS - Date.now());
        continue;
      }
      const report = reportText(locale, finished);
      patchTurn(t.id, { report });
      voice.say(report);
    }
    if (wake === Infinity) return;
    const timer = setTimeout(() => setTick((n) => n + 1), Math.max(0, wake) + 50);
    return () => clearTimeout(timer);
  }, [turns, commands, tick, locale, patchTurn, voice]);

  // open → start listening right away; close → stop everything and forget the session
  useEffect(() => {
    listen();
    return () => {
      voice.stop();
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
              <Turn
                key={t.id}
                turn={t}
                last={i === turns.length - 1}
                speaking={voice.speaking}
                onStopSpeaking={voice.stop}
                onRetry={() => void submit(t.text)}
                onConfirm={(answer) => void confirmBuzzer(t, answer)}
              />
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
              <RoundButton label="Speak instead" quiet onPress={() => listen()}>
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
                {speech.listening ? "Listening… tap to stop" : busy ? "Thinking…" : voice.speaking ? "Speaking… tap to interrupt" : turns.length ? "Ask again" : "Tap to talk"}
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

function Turn(props: {
  turn: VoiceTurn;
  last: boolean;
  speaking: boolean;
  onStopSpeaking: () => void;
  onRetry: () => void;
  onConfirm: (answer: "yes" | "no") => void;
}) {
  const { colors } = useTheme();
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
          {turn.report && (
            <Animated.View
              entering={FadeInDown.duration(220)}
              style={{ alignSelf: "flex-start", maxWidth: "90%", flexDirection: "row", gap: 8, padding: 12, borderRadius: 18, borderBottomLeftRadius: 6, backgroundColor: colors["surface-2"] }}
            >
              <CircleCheck size={16} color={colors.accent} />
              <Text variant="body" style={{ flexShrink: 1 }}>
                {turn.report}
              </Text>
            </Animated.View>
          )}
          {res.pendingConfirmation.length > 0 && turn.confirmation === null && (
            <View style={{ padding: 12, borderRadius: 12, borderWidth: 1, borderColor: colors["danger-line"], backgroundColor: colors["danger-tint"], gap: 10 }}>
              <Text variant="label" tone="state-danger">
                The alarm will sound in the room. Say “yes” or “no”, or tap.
              </Text>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <Button
                  flex
                  compact
                  label="Turn on alarm"
                  variant="danger"
                  onPress={() => props.onConfirm("yes")}
                />
                <Button flex compact label="Cancel" variant="outline" onPress={() => props.onConfirm("no")} />
              </View>
            </View>
          )}
        </>
      )}
    </Animated.View>
  );
}
