import "./style.css";
import { audioContext, loadCues, scheduleCue, unlockAudio, type SoundStyle } from "./audio";
import { listenForSound, listenForWord, wordRecognitionSupported, type Listener, type VoiceMode } from "./voice";

// ---------------------------------------------------------------- settings

interface Settings {
  preWait: number;
  minDelay: number;
  maxDelay: number;
  sound: SoundStyle;
  vibrate: boolean;
  voiceMode: VoiceMode;
  threshold: number;
  keyword: string;
}

const DEFAULTS: Settings = {
  preWait: 3,
  minDelay: 1,
  maxDelay: 3,
  sound: "voice",
  vibrate: true,
  voiceMode: "off",
  threshold: 0.7,
  keyword: "start",
};

const STORAGE_KEY = "readygo.settings.v1";

function loadSettings(): Settings {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") };
  } catch {
    return { ...DEFAULTS };
  }
}

function saveSettings(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    /* storage unavailable (private mode) – settings just won't persist */
  }
}

const settings = loadSettings();

// ---------------------------------------------------------------- dom

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const app = $("app");
const big = $("big");
const sub = $("sub");
const mainBtn = $<HTMLButtonElement>("main-btn");
const meter = $("meter");
const meterFill = $("meter-fill");
const meterThreshold = $("meter-threshold");
const settingsPanel = $<HTMLDetailsElement>("settings");
const inputs = {
  preWait: $<HTMLInputElement>("pre-wait"),
  minDelay: $<HTMLInputElement>("min-delay"),
  maxDelay: $<HTMLInputElement>("max-delay"),
  sound: $<HTMLSelectElement>("sound"),
  vibrate: $<HTMLInputElement>("vibrate"),
  voiceMode: $<HTMLSelectElement>("voice-mode"),
  threshold: $<HTMLInputElement>("threshold"),
  keyword: $<HTMLInputElement>("keyword"),
};
const voiceHint = $("voice-hint");

// ---------------------------------------------------------------- state

type Phase = "idle" | "listening" | "countdown" | "ready" | "go";

interface Round {
  readyAt: number; // AudioContext time the READY cue starts
  goAt: number; // AudioContext time the GO cue starts
  delay: number; // the random pause that was drawn
  sources: AudioBufferSourceNode[];
}

let phase: Phase = "idle";
let round: Round | null = null;
let listener: Listener | null = null;
let rafId = 0;
let goHoldTimer = 0;
let lastDelay: number | null = null;

function setPhase(p: Phase): void {
  phase = p;
  app.dataset.phase = p;
  render();
}

/** Uniform random number in [0, 1) from the crypto RNG. */
function random(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32;
}

// ---------------------------------------------------------------- round

async function startRound(): Promise<void> {
  stopListening();
  await unlockAudio();
  const cues = await loadCues(settings.sound);
  const ctx = audioContext();

  const delay = settings.minDelay + random() * (settings.maxDelay - settings.minDelay);
  const readyAt = ctx.currentTime + 0.05 + settings.preWait;
  // The random pause is measured from the end of the READY cue to the start of the GO cue.
  const goAt = readyAt + cues.ready.buffer.duration + delay;

  round = {
    readyAt,
    goAt,
    delay,
    sources: [scheduleCue(cues.ready, readyAt), scheduleCue(cues.go, goAt)],
  };
  setPhase("countdown");
  void requestWakeLock();
  cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(tick);
}

function tick(): void {
  if (!round) return;
  const ctx = audioContext();
  // Shift visuals by the output latency so the screen changes when the sound is actually heard.
  const now = ctx.currentTime - (ctx.outputLatency || 0) - ctx.baseLatency;

  if (now >= round.goAt) {
    if (phase !== "go") enterGo();
    return;
  }
  if (now >= round.readyAt) {
    if (phase !== "ready") setPhase("ready");
  } else {
    sub.textContent = `READY in ${Math.ceil(round.readyAt - now)}`;
  }
  rafId = requestAnimationFrame(tick);
}

function enterGo(): void {
  lastDelay = round?.delay ?? null;
  round = null;
  setPhase("go");
  if (settings.vibrate && "vibrate" in navigator) navigator.vibrate(400);
  goHoldTimer = window.setTimeout(() => setPhase("idle"), 3000);
}

function cancelRound(): void {
  cancelAnimationFrame(rafId);
  clearTimeout(goHoldTimer);
  if (round) {
    for (const s of round.sources) {
      try {
        s.stop();
      } catch {
        /* already finished */
      }
    }
  }
  round = null;
  setPhase("idle");
}

// ---------------------------------------------------------------- hands-free

async function startListening(): Promise<void> {
  try {
    await unlockAudio(); // we are inside the button's click handler – unlock now
    if (settings.voiceMode === "sound") {
      listener = await listenForSound({
        threshold: () => settings.threshold,
        onLevel: (l) => (meterFill.style.width = `${l * 100}%`),
        onTrigger: () => void startRound(),
      });
    } else {
      listener = listenForWord({
        keyword: settings.keyword,
        lang: navigator.language || "en-US",
        onHeard: (t) => (sub.textContent = `heard: “${t}”`),
        onTrigger: () => void startRound(),
        onError: (msg) => {
          listener = null;
          setPhase("idle");
          sub.textContent = `Speech recognition error: ${msg}`;
        },
      });
    }
    setPhase("listening");
  } catch (err) {
    listener = null;
    setPhase("idle");
    sub.textContent = `Microphone unavailable: ${(err as Error).message}`;
  }
}

function stopListening(): void {
  listener?.stop();
  listener = null;
}

// ---------------------------------------------------------------- wake lock

let wakeLock: { release(): Promise<void> } | null = null;

async function requestWakeLock(): Promise<void> {
  try {
    const wl = (navigator as unknown as { wakeLock?: { request(t: "screen"): Promise<{ release(): Promise<void> }> } })
      .wakeLock;
    if (wl && !wakeLock) {
      wakeLock = await wl.request("screen");
      (wakeLock as unknown as EventTarget).addEventListener?.("release", () => (wakeLock = null));
    }
  } catch {
    /* not supported or denied */
  }
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && phase !== "idle") void requestWakeLock();
});

// ---------------------------------------------------------------- ui

function render(): void {
  const hands = settings.voiceMode !== "off";
  meter.hidden = settings.voiceMode !== "sound" || phase !== "listening";
  settingsPanel.hidden = phase === "countdown" || phase === "ready" || phase === "go";

  switch (phase) {
    case "idle":
      big.textContent = "READY?";
      sub.textContent =
        lastDelay !== null ? `Last pause: ${lastDelay.toFixed(2)} s` : hands ? "Arm the microphone" : "Press start";
      mainBtn.textContent = hands ? "Listen" : "Start";
      break;
    case "listening":
      big.textContent = "…";
      sub.textContent = settings.voiceMode === "sound" ? "Clap or shout to start" : `Say “${settings.keyword}” to start`;
      mainBtn.textContent = "Cancel";
      break;
    case "countdown":
      big.textContent = "";
      mainBtn.textContent = "Stop";
      break;
    case "ready":
      big.textContent = "READY";
      sub.textContent = "";
      mainBtn.textContent = "Stop";
      break;
    case "go":
      big.textContent = "GO!";
      sub.textContent = lastDelay !== null ? `pause ${lastDelay.toFixed(2)} s` : "";
      mainBtn.textContent = "Reset";
      break;
  }
}

mainBtn.addEventListener("click", () => {
  switch (phase) {
    case "idle":
      if (settings.voiceMode === "off") void startRound();
      else void startListening();
      break;
    case "listening":
      stopListening();
      setPhase("idle");
      break;
    default:
      cancelRound();
  }
});

// Space / Enter also work as the button on desktop.
document.addEventListener("keydown", (e) => {
  if ((e.code === "Space" || e.code === "Enter") && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement)) {
    e.preventDefault();
    mainBtn.click();
  }
});

function num(input: HTMLInputElement, fallback: number, max: number): number {
  const v = parseFloat(input.value.replace(",", "."));
  return Number.isFinite(v) ? Math.min(max, Math.max(0, v)) : fallback;
}

function readInputs(source?: EventTarget | null): void {
  settings.preWait = num(inputs.preWait, settings.preWait, 60);
  settings.minDelay = num(inputs.minDelay, settings.minDelay, 30);
  settings.maxDelay = num(inputs.maxDelay, settings.maxDelay, 30);
  // Keep min <= max, adjusting whichever field the user did not just edit.
  if (settings.minDelay > settings.maxDelay) {
    if (source === inputs.maxDelay) settings.minDelay = settings.maxDelay;
    else settings.maxDelay = settings.minDelay;
  }
  settings.sound = inputs.sound.value as SoundStyle;
  settings.vibrate = inputs.vibrate.checked;
  settings.voiceMode = inputs.voiceMode.value as VoiceMode;
  settings.threshold = parseFloat(inputs.threshold.value);
  settings.keyword = inputs.keyword.value.trim() || DEFAULTS.keyword;
  saveSettings();
}

function writeInputs(): void {
  inputs.preWait.value = String(settings.preWait);
  inputs.minDelay.value = String(settings.minDelay);
  inputs.maxDelay.value = String(settings.maxDelay);
  inputs.sound.value = settings.sound;
  inputs.vibrate.checked = settings.vibrate;
  inputs.voiceMode.value = settings.voiceMode;
  inputs.threshold.value = String(settings.threshold);
  inputs.keyword.value = settings.keyword;
  meterThreshold.style.left = `${settings.threshold * 100}%`;

  for (const el of document.querySelectorAll<HTMLElement>("[data-for]")) {
    el.hidden = el.dataset.for !== settings.voiceMode;
  }
  voiceHint.textContent =
    settings.voiceMode === "sound"
      ? "Press Listen, then clap or shout. Watch the meter and move the threshold just above the room noise."
      : settings.voiceMode === "word"
        ? wordRecognitionSupported()
          ? "Uses the browser's speech recognition (may need an internet connection)."
          : "Speech recognition isn't available in this browser/app – use “Loud sound” instead."
        : "";
}

const wordOption = inputs.voiceMode.querySelector<HTMLOptionElement>('option[value="word"]')!;
wordOption.disabled = !wordRecognitionSupported();
if (settings.voiceMode === "word" && !wordRecognitionSupported()) settings.voiceMode = "off";

for (const el of Object.values(inputs)) {
  el.addEventListener("change", (e) => {
    if (phase === "listening" && el !== inputs.threshold) {
      stopListening();
      setPhase("idle");
    }
    readInputs(e.target);
    writeInputs();
    render();
  });
}
inputs.threshold.addEventListener("input", () => {
  settings.threshold = parseFloat(inputs.threshold.value);
  meterThreshold.style.left = `${settings.threshold * 100}%`;
});

writeInputs();
render();

// Preload sounds so the first round has no decoding delay (decoding works before unlock).
void loadCues("voice").catch(() => {});

if ("serviceWorker" in navigator && location.protocol === "https:") {
  void navigator.serviceWorker.register("./sw.js").catch(() => {});
}
