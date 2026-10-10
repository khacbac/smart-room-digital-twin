import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Speech from "expo-speech";

// Text to speech with a queue of our own: the reply, then the report once the device has
// acted, each with an optional "then" (listen again after a question). With speaking turned
// off in Settings, "then" still runs, so the conversation flows the same way on screen.
//
// Voice: Google's default on-device voices ("…-seanet-embedded") often synthesise nothing on the
// emulator and some phones, and still report "done", so a failure can't be caught. A network
// voice of the language is picked instead when there is one: Google synthesises it on its
// server and falls back to the on-device voice by itself when offline.

interface Utterance {
  text: string;
  then?: () => void;
}

export interface VoiceOut {
  speaking: boolean;
  say(text: string, then?: () => void): void;
  /** Stops talking and forgets the queue (their "then" does not run). */
  stop(): void;
}

export function useVoiceOut(enabled: boolean, language: string): VoiceOut {
  const [speaking, setSpeaking] = useState(false);
  const queue = useRef<Utterance[]>([]);
  const busy = useRef(false);
  const generation = useRef(0);
  const opts = useRef({ enabled, language });
  opts.current = { enabled, language };
  /** Per language: the voice to use (undefined = system default), once looked up. */
  const voices = useRef(new Map<string, string | undefined>());

  const voiceFor = useCallback(async (language: string): Promise<string | undefined> => {
    if (voices.current.has(language)) return voices.current.get(language);
    const all = await Speech.getAvailableVoicesAsync().catch(() => []);
    const lang = language.toLowerCase();
    const voice = all.find((v) => v.language.toLowerCase().replace("_", "-") === lang && v.identifier.endsWith("-network"))?.identifier;
    voices.current.set(language, voice);
    return voice;
  }, []);

  const next = useCallback(() => {
    const item = queue.current.shift();
    if (!item) {
      busy.current = false;
      setSpeaking(false);
      return;
    }
    busy.current = true;
    if (!opts.current.enabled) {
      item.then?.();
      next();
      return;
    }
    setSpeaking(true);
    const gen = generation.current;
    const language = opts.current.language;
    const done = () => {
      if (gen !== generation.current) return; // stopped meanwhile
      item.then?.();
      next();
    };
    void voiceFor(language).then((voice) => {
      if (gen !== generation.current) return;
      Speech.speak(item.text, { language, voice, onDone: done, onError: done });
    });
  }, [voiceFor]);

  const say = useCallback(
    (text: string, then?: () => void) => {
      queue.current.push({ text, then });
      if (!busy.current) next();
    },
    [next],
  );

  const stop = useCallback(() => {
    generation.current++;
    queue.current = [];
    busy.current = false;
    setSpeaking(false);
    void Speech.stop();
  }, []);

  useEffect(() => stop, [stop]);

  return useMemo(() => ({ speaking, say, stop }), [speaking, say, stop]);
}
