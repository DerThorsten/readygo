# ReadyGo

A random **"Ready? … Go!"** start signal for armwrestling.

1. Set the *wait before READY* and the *min / max pause* between READY and GO.
2. Press **Start** (or arm the microphone and clap/shout, or say a keyword).
3. The app waits the set time, says **"Ready?"**, waits a uniformly random pause in
   `[min, max]` (crypto RNG), then says **"Go!"**. The screen turns yellow/green and
   the phone vibrates on GO. The pause that was drawn is shown afterwards.

The pause is measured from the *end* of the "Ready?" sound to the *start* of "Go!".
Both cues are scheduled on the Web Audio clock, so timing does not depend on
`setTimeout` jitter, and the screen is shifted by the reported output latency to
match what you hear. **Stop** cancels a running round (e.g. on a foul).
Space/Enter work as the button on a keyboard.

## Architecture

One web app (Vite + TypeScript, no framework) used on every platform:

| Target | Shell | Folder |
| --- | --- | --- |
| Browser / installable PWA | – | `dist/` after build |
| Android | Capacitor | `android/` |
| iOS | Capacitor | `ios/` |
| macOS / Linux / Windows | Tauri 2 | `src-tauri/` |

```
src/main.ts    state machine (idle → listening → countdown → ready → go) + UI
src/audio.ts   AudioContext, cue loading/scheduling, iOS audio-session handling
src/voice.ts   hands-free triggers (mic level / speech keyword)
public/sounds  ready.wav / go.wav (generated with macOS `say`, see below)
```

## Hands-free start

* **Loud sound** – mic level (RMS over ~20 ms) above a threshold (clap, shout, table slap).
  A live meter shows the level; set the threshold just above room noise. Works in
  browsers, Capacitor and Tauri (macOS) web views.
* **Spoken word** – Web Speech API keyword match (default "start"). Only offered
  where the browser supports it (Chrome, Edge, Safari). Not available in the
  Android/iOS app web views or Firefox; may need an internet connection.

The mic is closed as soon as the round starts and not re-armed automatically
afterwards (the shouting during a match would immediately re-trigger it).

## Develop

```sh
npm install
npm run dev            # http://localhost:5173 (also on your LAN)
npm run build          # type-check + production build to dist/
```

Microphone access in a browser needs a secure context: `localhost` is fine,
for a phone on your LAN use HTTPS (or deploy `dist/` to any static host).

### Android

Requires Android Studio (JDK + SDK).

```sh
npm run android        # build, sync, open in Android Studio
```

### iOS

Requires Xcode (uses Swift Package Manager, no CocoaPods).

```sh
npm run ios            # build, sync, open in Xcode → pick a team, run
```

### Desktop (macOS / Linux / Windows)

Requires Rust. On Linux also the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)
(webkit2gtk etc.).

```sh
npm run desktop:dev
npm run desktop:build  # bundles into src-tauri/target/release/bundle/
```

Note: on Linux, WebKitGTK's microphone support is limited, so "Loud sound"
mode may not work there; the button and keyboard work everywhere.

## Regenerating the voice cues

```sh
say -v Daniel -r 200 -o /tmp/ready.aiff "Ready?"
say -v Daniel -r 200 -o /tmp/go.aiff "Go!"
afconvert -f WAVE -d LEI16@22050 -c 1 /tmp/ready.aiff public/sounds/ready.wav
afconvert -f WAVE -d LEI16@22050 -c 1 /tmp/go.aiff public/sounds/go.wav
```

Any short WAV works (leading silence is trimmed automatically) — e.g. record a
referee's voice.
