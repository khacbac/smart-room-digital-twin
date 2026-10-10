import { useCallback, useEffect, useRef, useState } from "react";
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from "expo-speech-recognition";
import { haptics } from "@/lib/haptics";

// Speech to text with Android's recognition service (Google). The app never records or
// sends audio itself; for Vietnamese the service usually recognises online.

const HARD_LIMIT_MS = 15_000;

export type SpeechError = "permission" | "no-speech" | "network" | "unavailable" | "other";

export interface Speech {
  listening: boolean;
  /** Final text so far + the part still being recognised. */
  transcript: string;
  interim: string;
  /** 0–1, for the waveform. */
  volume: number;
  error: SpeechError | null;
  start(lang: string): Promise<void>;
  stop(): void;
  abort(): void;
}

export function useSpeech(onFinal: (text: string) => void): Speech {
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [interim, setInterim] = useState("");
  const [volume, setVolume] = useState(0);
  const [error, setError] = useState<SpeechError | null>(null);
  const finalText = useRef("");
  const limit = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const onFinalRef = useRef(onFinal);
  onFinalRef.current = onFinal;

  useSpeechRecognitionEvent("start", () => {
    setListening(true);
    haptics.listenStart();
  });
  useSpeechRecognitionEvent("end", () => {
    clearTimeout(limit.current);
    setListening(false);
    setVolume(0);
    setInterim("");
    const text = finalText.current.trim();
    finalText.current = "";
    if (text) onFinalRef.current(text);
  });
  useSpeechRecognitionEvent("result", (e) => {
    const best = e.results[0]?.transcript ?? "";
    if (e.isFinal) {
      finalText.current = `${finalText.current} ${best}`.trim();
      setTranscript(finalText.current);
      setInterim("");
    } else {
      setInterim(best);
    }
  });
  useSpeechRecognitionEvent("volumechange", (e) => {
    // Android reports roughly -2…10 dB
    setVolume(Math.max(0, Math.min(1, (e.value + 2) / 12)));
  });
  useSpeechRecognitionEvent("error", (e) => {
    clearTimeout(limit.current);
    setListening(false);
    setVolume(0);
    if (e.error === "aborted") return;
    haptics.error();
    setError(
      e.error === "not-allowed"
        ? "permission"
        : e.error === "no-speech" || e.error === "speech-timeout"
          ? "no-speech"
          : e.error === "network"
            ? "network"
            : e.error === "service-not-allowed" || e.error === "language-not-supported"
              ? "unavailable"
              : "other",
    );
  });

  useEffect(() => () => clearTimeout(limit.current), []);

  const start = useCallback(async (lang: string) => {
    setError(null);
    setTranscript("");
    setInterim("");
    finalText.current = "";
    const perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!perm.granted) {
      setError("permission");
      return;
    }
    if (!ExpoSpeechRecognitionModule.isRecognitionAvailable()) {
      setError("unavailable");
      return;
    }
    ExpoSpeechRecognitionModule.start({
      lang,
      interimResults: true,
      continuous: false,
      addsPunctuation: true,
      volumeChangeEventOptions: { enabled: true, intervalMillis: 100 },
    });
    clearTimeout(limit.current);
    limit.current = setTimeout(() => ExpoSpeechRecognitionModule.stop(), HARD_LIMIT_MS);
  }, []);

  const stop = useCallback(() => {
    haptics.listenStop();
    ExpoSpeechRecognitionModule.stop();
  }, []);

  const abort = useCallback(() => {
    finalText.current = "";
    ExpoSpeechRecognitionModule.abort();
  }, []);

  return { listening, transcript, interim, volume, error, start, stop, abort };
}
