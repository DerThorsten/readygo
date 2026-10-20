// Sound output. Everything is played through one AudioContext so READY and GO can be
// scheduled sample-accurately on the audio clock instead of relying on setTimeout.

export type SoundStyle = "voice" | "beep";

export interface Cue {
  buffer: AudioBuffer;
}

let ctx: AudioContext | null = null;
const cache = new Map<string, AudioBuffer>();

export function audioContext(): AudioContext {
  if (!ctx) ctx = new AudioContext({ latencyHint: "interactive" });
  return ctx;
}

/** Must be called from a user gesture at least once (iOS / Chrome autoplay rules). */
export async function unlockAudio(): Promise<void> {
  setAudioSession("playback");
  const c = audioContext();
  if (c.state !== "running") await c.resume();
  // Play one silent sample; required on older iOS versions to really unlock output.
  const src = c.createBufferSource();
  src.buffer = c.createBuffer(1, 1, c.sampleRate);
  src.connect(c.destination);
  src.start();
}

/**
 * Safari 16.4+ exposes navigator.audioSession. "playback" makes sound ignore the iOS
 * silent switch; "play-and-record" is needed while the microphone is open.
 */
export function setAudioSession(type: "playback" | "play-and-record"): void {
  const session = (navigator as unknown as { audioSession?: { type: string } }).audioSession;
  if (session) {
    try {
      session.type = type;
    } catch {
      /* not supported */
    }
  }
}

async function loadVoice(name: "ready" | "go"): Promise<AudioBuffer> {
  const key = `voice:${name}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const res = await fetch(`./sounds/${name}.wav`);
  const decoded = await audioContext().decodeAudioData(await res.arrayBuffer());
  const trimmed = trimLeadingSilence(decoded);
  cache.set(key, trimmed);
  return trimmed;
}

/** Text-to-speech output has some leading silence; cut it so the cue starts exactly on time. */
function trimLeadingSilence(buf: AudioBuffer, threshold = 0.02): AudioBuffer {
  const data = buf.getChannelData(0);
  let start = 0;
  while (start < data.length && Math.abs(data[start]) < threshold) start++;
  start = Math.max(0, start - Math.floor(buf.sampleRate * 0.005));
  if (start === 0) return buf;
  const out = audioContext().createBuffer(buf.numberOfChannels, buf.length - start, buf.sampleRate);
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    out.copyToChannel(buf.getChannelData(ch).subarray(start), ch);
  }
  return out;
}

function beep(freq: number, seconds: number): AudioBuffer {
  const key = `beep:${freq}:${seconds}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const c = audioContext();
  const n = Math.floor(c.sampleRate * seconds);
  const buf = c.createBuffer(1, n, c.sampleRate);
  const data = buf.getChannelData(0);
  const fade = Math.floor(c.sampleRate * 0.005);
  for (let i = 0; i < n; i++) {
    const env = Math.min(1, i / fade, (n - i) / fade);
    data[i] = 0.8 * env * Math.sin((2 * Math.PI * freq * i) / c.sampleRate);
  }
  cache.set(key, buf);
  return buf;
}

export async function loadCues(style: SoundStyle): Promise<{ ready: Cue; go: Cue }> {
  if (style === "beep") {
    return { ready: { buffer: beep(660, 0.25) }, go: { buffer: beep(1100, 0.5) } };
  }
  const [ready, go] = await Promise.all([loadVoice("ready"), loadVoice("go")]);
  return { ready: { buffer: ready }, go: { buffer: go } };
}

/** Schedule a cue at an absolute AudioContext time. Returns the source so it can be cancelled. */
export function scheduleCue(cue: Cue, when: number): AudioBufferSourceNode {
  const c = audioContext();
  const src = c.createBufferSource();
  src.buffer = cue.buffer;
  src.connect(c.destination);
  src.start(when);
  return src;
}
