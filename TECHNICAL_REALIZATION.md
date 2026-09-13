# Technical Realization

## Architecture Overview

The **Sheet Music Trainer** is a client-side Single Page Application (SPA) built with **React** and **TypeScript**, powered by **Vite**. It is designed to run entirely in the browser without a backend server, allowing for low-latency audio processing and interactivity.

### Key Architectural Choices

1.  **Component-Based UI**:
    - The application is structured into reusable components (e.g., `SheetMusic`, `Fretboard`, `PianoKeys`, `Controls`) to maintain separation of concerns.
    - State management is primarily handled via React's `useState` and `useReducer` at the `App` component level, with props drilling for simpler hierarchies.

2.  **Audio Processing**:
    - **Pitch Detection** (`src/audio/PitchAnalyzer.ts`): Uses the `pitchfinder` library with a detector chosen per instrument range — ACF2PLUS for normal instruments (robust down to ~40 Hz; pitchfinder's YIN returns ~20 kHz garbage below ~100 Hz and on quiet input), YIN only for high registers (whistle). The analysis window adapts to the instrument's lowest note (~2 periods, power of two): roughly half the latency and a quarter of the CPU of the previous fixed 4096-sample window for guitar/piano/voice, while bass keeps the full window for E1. Readings implausibly below the instrument's floor (e.g. mains hum) are rejected. Detection runs on the requestAnimationFrame loop inside `usePitchDetector`, with display-only damping (EMA for cents/level, short note-name hysteresis) applied in the producer.
    - **Note Matching** (`src/game/MatchTracker.ts`): A note counts as matched when held for `NOTE_MATCH_THRESHOLD_MS` (50 ms), tolerated across brief detection dropouts up to `NOTE_MATCH_GRACE_MS` (150 ms). Pitch detectors flicker during note attacks and decays; a naive consecutive-frame timer resets on every flicker.
    - **Audio Synthesis** (`src/audio/AudioEngine.ts`): All speaker output goes through a single shared AudioContext (triangle waves). The engine tracks when output may still be audible so the app can ignore its own speaker: while a reference note is sounding (plus a 0.4 s decay tail), microphone-based matching and live feedback are gated — otherwise ear training would score the reference note it just played through the speaker. A suspended AudioContext (autoplay policy) is treated as inaudible so the gate can never deadlock.
    - **Ear training auto-play**: The next reference note can optionally wait for the microphone to detect silence ("Wait for Silence" setting, 8 s safety cap), and its duration is configurable ("Reference Note Duration", 0.5–4 s).

3.  **Music Rendering**:
    - **VexFlow**: The standard library for rendering music notation on the web. It is used in the `SheetMusic` component to draw the staff, notes, clefs, and key signatures dynamically based on the current state.

4.  **Responsiveness**:
    - The application uses CSS variables and media queries to adapt to different screen sizes, with specific optimizations for mobile landscape mode to support instrument practice on tablets and phones.

## Frameworks and Libraries

### Core
*   **[React](https://react.dev/)**: The library for web and native user interfaces.
*   **[TypeScript](https://www.typescriptlang.org/)**: Strongly typed JavaScript for safer development.
*   **[Vite](https://vitejs.dev/)**: Next Generation Frontend Tooling for fast development and building.

### Audio & Music
*   **[VexFlow](https://www.vexflow.com/)**: A JavaScript library for rendering music notation and guitar tablature.
*   **[Pitchfinder](https://github.com/peterkhayes/pitchfinder)**: A collection of pitch detection algorithms for Javascript. used for detecting the note played by the user.

### UI & Icons
*   **[Lucide React](https://lucide.dev/)**: A clean and consistent icon library for the interface.

### Phrase Mode (sequential practice)

The third game mode renders and scores multi-bar single-voice phrases from a versioned normalized score (`src/score/model.ts`, PPQ ticks, ties pre-merged into "logical notes"). Generators (`src/music/melodyGenerator.ts`, `scaleDrills.ts`) and the ABC subset adapter (`src/exercises/abcParser.ts`) both produce it; `PhraseSheetMusic` renders it with measure-aware accidental display and a current-note caret. Matching (`src/game/PhraseMatcher.ts`) latches per-note results and blocks a sustained pitch from re-crediting a later note on the same pitch (release evidence, stable-pitch frames, at-your-pace timeout re-arm). Tempo transport uses audio-clock boundaries (schedule in `src/game/PhraseTransport.ts`) — cursor state follows the clock, never the click scheduler. Raw detection frames flow through `src/hooks/rawFrameBus.ts` (one per analysis tick, silence included); display smoothing is untouched. Metronome clicks are short noise bursts that blank the mic for 30 ms instead of entering the 400 ms pitched-audio gate. See `docs/PHRASE_MODE_IMPLEMENTATION.md` (contracts) and `docs/PHRASE_DELIVERY.md` (verified behavior + limitations).

## Testing

*   **Unit/integration** ([Vitest](https://vitest.dev/)): `src/game/MatchTracker.test.ts` covers the flicker-tolerance matching logic; `src/audio/pitchDetection.test.ts` feeds synthetic instrument-like signals (guitar/bass/piano/whistle, quiet plucks, mains hum) through the exact pipeline helpers used by `PitchAnalyzer`; `src/music/NoteUtils.test.ts` covers note math and key signatures.
*   **End-to-end**: the microphone can be stubbed in a real browser by replacing `navigator.mediaDevices.getUserMedia` with a `MediaStreamDestination` fed by a scripted oscillator — frequency ramps simulate tuning, envelopes simulate plucks. This setup (puppeteer-core + system Chrome, headless) reproduced and verified several real bugs: YIN's low-frequency garbage mode, noise-floor amplification freezing the tuner on a "note nobody played", and WebKit/Safari leaving constantly-interrupted CSS transitions visually stuck.

## Directory Structure

```
src/
├── audio/            # PitchAnalyzer (detection pipeline), AudioEngine (shared playback + mic gating)
├── components/        # Reusable UI components (SheetMusic, Fretboard, TuningMeter, etc.)
├── context/           # Settings context (split into context/Provider/hook files for fast-refresh)
├── game/              # MatchTracker: flicker-tolerant note-hold matching (unit-tested)
├── hooks/             # Custom React hooks (usePitchDetector, useGameLogic, useAudioPlayer, etc.)
├── music/             # Music logic, tuning definitions, and note utilities
├── styles/            # Global styles and component-specific CSS
├── types/              # Shared TypeScript types + pitchfinder module declarations
├── assets/            # Static assets
├── App.tsx           # Main application logic and layout
└── main.tsx          # Entry point
```
