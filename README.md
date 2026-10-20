# ReadyGo

A random **"Ready? … Go!"** start signal for armwrestling, as a mobile-friendly web app.

**Use it:** <https://derthorsten.github.io/readygo/> — on a phone, "Add to Home Screen"
to install it like an app.

1. Set the *wait before READY* and the *pause READY → GO* range with the sliders.
2. Press **Start** — or turn on **Clap to start**, press **Listen** and clap.
3. The app waits, says **"Ready?"**, waits a uniformly random pause within the range
   (crypto RNG), then says **"Go!"**. The screen turns yellow on READY and green on GO;
   the pause that was drawn is shown afterwards.

The pause is measured from the *end* of "Ready?" to the *start* of "Go!". Both cues
are scheduled on the Web Audio clock, so timing does not depend on `setTimeout`
jitter, and the screen is shifted by the reported output latency to match what you
hear. **Stop** cancels a running round (e.g. on a foul). Space/Enter work as the
button on a keyboard.

## Clap to start

Fires when the microphone level (RMS over ~20 ms) goes above the *clap loudness*
slider — a clap, a shout or a slap on the table. A live meter shows the level while
listening. The mic is closed as soon as the round starts and is not re-armed
automatically (the shouting during a match would immediately re-trigger it).
Microphone access needs HTTPS (or `localhost`).

## Code

Vite + TypeScript, no framework.

```
src/main.ts    state machine (idle → listening → countdown → ready → go) + UI
src/audio.ts   AudioContext, cue loading/scheduling, iOS audio-session handling
src/clap.ts    clap / loud-sound detection
src/style.css  referee-shirt look, sliders
public/sounds  ready.wav / go.wav (generated with macOS `say`, see below)
```

```sh
npm install
npm run dev            # http://localhost:5173 (also on your LAN)
npm run build          # type-check + production build to dist/
```

Every push to `main` deploys to GitHub Pages via `.github/workflows/pages.yml`
(repo Settings → Pages → Source must be "GitHub Actions").

## Regenerating the voice cues

```sh
say -v Daniel -r 200 -o /tmp/ready.aiff "Ready?"
say -v Daniel -r 400 -o /tmp/go.aiff "[[emph +]]Go!"
afconvert -f WAVE -d LEI16@22050 -c 1 /tmp/ready.aiff public/sounds/ready.wav
afconvert -f WAVE -d LEI16@22050 -c 1 /tmp/go.aiff public/sounds/go.wav
```

Any short WAV works — leading/trailing silence is trimmed and the volume normalised
on load — e.g. record a referee's voice.
