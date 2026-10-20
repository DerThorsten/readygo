// Hands-free triggers.
//  - "sound": fires when the microphone level stays above a threshold for a short time
//    (a clap, a shout, slapping the table). Works everywhere getUserMedia works,
//    including the Capacitor and Tauri web views.
//  - "word": fires when a spoken keyword is recognised via the Web Speech API.
//    Only available in browsers that implement SpeechRecognition (Chrome, Edge, Safari).

import { audioContext, setAudioSession } from "./audio";

export type VoiceMode = "off" | "sound" | "word";

export interface Listener {
  stop(): void;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;
interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

function speechRecognitionCtor(): SpeechRecognitionCtor | undefined {
  const w = window as unknown as Record<string, SpeechRecognitionCtor | undefined>;
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

export const wordRecognitionSupported = (): boolean => speechRecognitionCtor() !== undefined;

export async function listenForSound(opts: {
  threshold: () => number; // 0..1, read live so the slider can be adjusted while armed
  holdMs?: number;
  onLevel: (level: number) => void;
  onTrigger: () => void;
}): Promise<Listener> {
  setAudioSession("play-and-record");
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  });
  const c = audioContext();
  if (c.state !== "running") await c.resume();
  const source = c.createMediaStreamSource(stream);
  const analyser = c.createAnalyser();
  analyser.fftSize = 1024;
  source.connect(analyser);
  const samples = new Float32Array(analyser.fftSize);

  const holdMs = opts.holdMs ?? 0; // a clap is only ~20 ms long, so fire on the first loud window by default
  let aboveSince: number | null = null;
  let stopped = false;
  let timer = 0;

  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    source.disconnect();
    stream.getTracks().forEach((t) => t.stop());
    setAudioSession("playback");
    opts.onLevel(0);
  };

  // setInterval rather than requestAnimationFrame so it keeps working with the screen dimmed.
  timer = window.setInterval(() => {
    analyser.getFloatTimeDomainData(samples);
    let sum = 0;
    for (const s of samples) sum += s * s;
    // Map RMS onto a roughly perceptual 0..1 scale (-60 dBFS .. 0 dBFS).
    const db = 20 * Math.log10(Math.sqrt(sum / samples.length) + 1e-9);
    const level = Math.min(1, Math.max(0, (db + 60) / 60));
    opts.onLevel(level);

    const now = performance.now();
    if (level >= opts.threshold()) {
      aboveSince ??= now;
      if (now - aboveSince >= holdMs) {
        stop();
        opts.onTrigger();
      }
    } else {
      aboveSince = null;
    }
  }, 20);

  return { stop };
}

export function listenForWord(opts: {
  keyword: string;
  lang: string;
  onHeard: (text: string) => void;
  onTrigger: () => void;
  onError: (msg: string) => void;
}): Listener {
  const Ctor = speechRecognitionCtor();
  if (!Ctor) throw new Error("Speech recognition is not supported here");
  const keyword = normalise(opts.keyword);
  let stopped = false;
  let rec: SpeechRecognitionLike;

  const start = () => {
    rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true; // react on partial results for lower latency
    rec.lang = opts.lang;
    rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const text = normalise(e.results[i][0].transcript);
        opts.onHeard(text);
        if (keyword && ` ${text} `.includes(` ${keyword} `)) {
          stopped = true;
          rec.abort();
          opts.onTrigger();
          return;
        }
      }
    };
    rec.onerror = (e) => {
      if (e.error === "no-speech" || e.error === "aborted") return;
      stopped = true;
      opts.onError(e.error);
    };
    // Recognisers end on their own after silence; restart until we are told to stop.
    rec.onend = () => {
      if (!stopped) start();
    };
    rec.start();
  };
  start();

  return {
    stop() {
      stopped = true;
      rec.abort();
    },
  };
}

function normalise(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
