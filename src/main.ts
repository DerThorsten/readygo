import "./style.css";
import { audioContext, loadCues, scheduleCue, unlockAudio, type SoundStyle } from "./audio";
import { listenForNoise, type Listener } from "./noise";

// ---------------------------------------------------------------- settings

interface Settings {
  preWait: number;
  minDelay: number;
  maxDelay: number;
  sound: SoundStyle;
  soundStart: boolean;
  threshold: number;
}

const DEFAULTS: Settings = {
  preWait: 3,
  minDelay: 1,
  maxDelay: 3,
  sound: "voice",
  soundStart: true,
  threshold: 0.7,
};

const STORAGE_KEY = "readygo.settings.v3";

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
const settingsPanel = $("settings");
const preWait = $<HTMLInputElement>("pre-wait");
const minDelay = $<HTMLInputElement>("min-delay");
const maxDelay = $<HTMLInputElement>("max-delay");
const pauseRange = $("pause-range");
const soundStart = $<HTMLInputElement>("sound-start");
const soundOptions = $("sound-options");
const threshold = $<HTMLInputElement>("threshold");
const soundButtons = document.querySelectorAll<HTMLButtonElement>("[data-sound]");

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
    big.textContent = String(Math.ceil(round.readyAt - now));
  }
  rafId = requestAnimationFrame(tick);
}

function enterGo(): void {
  lastDelay = round?.delay ?? null;
  round = null;
  setPhase("go");
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

// ---------------------------------------------------------------- start by sound

async function startListening(): Promise<void> {
  try {
    await unlockAudio(); // we are inside the button's click handler – unlock now
    listener = await listenForNoise({
      threshold: () => settings.threshold,
      onLevel: (l) => (meterFill.style.width = `${l * 100}%`),
      onTrigger: () => void startRound(),
    });
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
  meter.hidden = phase !== "listening";
  settingsPanel.hidden = phase === "countdown" || phase === "ready" || phase === "go";

  switch (phase) {
    case "idle":
      big.textContent = "READY?";
      sub.textContent =
        lastDelay !== null
          ? `Last pause ${lastDelay.toFixed(2)} s`
          : settings.soundStart
            ? "Press listen, then make some noise"
            : "Press start";
      mainBtn.textContent = settings.soundStart ? "Listen" : "Start";
      break;
    case "listening":
      big.textContent = "👏";
      sub.textContent = "Make some noise!";
      mainBtn.textContent = "Cancel";
      break;
    case "countdown":
      sub.textContent = "Get set";
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
      mainBtn.textContent = "Done";
      break;
  }
}

mainBtn.addEventListener("click", () => {
  switch (phase) {
    case "idle":
      if (settings.soundStart) void startListening();
      else void startRound();
      break;
    case "listening":
      stopListening();
      setPhase("idle");
      break;
    default:
      cancelRound();
  }
});

// Space / Enter also work as the button on a keyboard.
document.addEventListener("keydown", (e) => {
  if ((e.code === "Space" || e.code === "Enter") && !(e.target instanceof HTMLInputElement)) {
    e.preventDefault();
    mainBtn.click();
  }
});

const seconds = (v: number) => `${v.toFixed(1)} s`;

/** Push all settings into the controls and value labels. */
function writeInputs(): void {
  preWait.value = String(settings.preWait);
  minDelay.value = String(settings.minDelay);
  maxDelay.value = String(settings.maxDelay);
  threshold.value = String(settings.threshold);
  soundStart.checked = settings.soundStart;

  $("pre-wait-out").textContent = settings.preWait === 0 ? "none" : seconds(settings.preWait);
  $("pause-out").textContent =
    settings.minDelay === settings.maxDelay
      ? `exactly ${seconds(settings.minDelay)}`
      : `${settings.minDelay.toFixed(1)} – ${seconds(settings.maxDelay)}`;
  $("threshold-out").textContent = `${Math.round(settings.threshold * 100)}%`;

  const max = parseFloat(minDelay.max);
  pauseRange.style.setProperty("--lo", `${(settings.minDelay / max) * 100}%`);
  pauseRange.style.setProperty("--hi", `${(settings.maxDelay / max) * 100}%`);
  for (const el of [preWait, threshold]) {
    const pct = ((parseFloat(el.value) - parseFloat(el.min)) / (parseFloat(el.max) - parseFloat(el.min))) * 100;
    el.style.setProperty("--fill", `${pct}%`);
  }
  meterThreshold.style.left = `${settings.threshold * 100}%`;

  for (const b of soundButtons) b.setAttribute("aria-checked", String(b.dataset.sound === settings.sound));
  soundOptions.hidden = !settings.soundStart;
}

function update(): void {
  saveSettings();
  writeInputs();
  if (phase === "idle") render();
}

preWait.addEventListener("input", () => {
  settings.preWait = parseFloat(preWait.value);
  update();
});

// Two overlapping range inputs form the min/max slider; neither handle may pass the other.
minDelay.addEventListener("input", () => {
  settings.minDelay = Math.min(parseFloat(minDelay.value), settings.maxDelay);
  update();
});
maxDelay.addEventListener("input", () => {
  settings.maxDelay = Math.max(parseFloat(maxDelay.value), settings.minDelay);
  update();
});
// When both handles sit on top of each other, keep the one that can still move on top.
for (const el of [minDelay, maxDelay]) {
  el.addEventListener("pointerdown", () => {
    minDelay.style.zIndex = el === minDelay ? "3" : "2";
    maxDelay.style.zIndex = el === maxDelay ? "3" : "2";
  });
}

threshold.addEventListener("input", () => {
  settings.threshold = parseFloat(threshold.value);
  update();
});

soundStart.addEventListener("change", () => {
  settings.soundStart = soundStart.checked;
  if (!soundStart.checked && phase === "listening") {
    stopListening();
    setPhase("idle");
  }
  update();
});

for (const b of soundButtons) {
  b.addEventListener("click", () => {
    settings.sound = b.dataset.sound as SoundStyle;
    update();
    // Let the user hear the choice.
    void unlockAudio()
      .then(() => loadCues(settings.sound))
      .then((c) => scheduleCue(c.go, audioContext().currentTime + 0.02));
  });
}

writeInputs();
render();

// Preload sounds so the first round has no decoding delay (decoding works before unlock).
void loadCues("voice").catch(() => {});

if ("serviceWorker" in navigator && location.protocol === "https:") {
  void navigator.serviceWorker.register("./sw.js").catch(() => {});
}
