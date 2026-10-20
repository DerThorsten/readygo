// Start by sound: fires when the microphone level goes above a threshold
// (a clap, a shout, slapping the table).

import { audioContext, setAudioSession } from "./audio";

export interface Listener {
  stop(): void;
}

export async function listenForNoise(opts: {
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
