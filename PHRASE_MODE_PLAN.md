# Phrase Mode — Requirements & Implementation Plan

**Status: DRAFT — awaiting approval ("Go") before implementation.**

This document describes a proposed third game mode ("Phrase Mode") for the Sheet
Music Trainer. It is written as stakeholder requirements: what the mode does,
what it deliberately does **not** do, how it will be built, and which decisions
need the owner's sign-off. Section 8 lists the open decisions together with the
defaults I will assume if no feedback arrives in time — so an autonomous
overnight run can proceed without blocking on any of them.

---

## 1. Vision

Today the app trains **single notes**: one note appears, you play it, the app
confirms, repeat. This is great for building note-lookup reflexes, but real
sight-reading is about reading **sequences** — a bar or a few bars of connected
music, played in order, ideally in time.

Phrase Mode adds exactly that, without disturbing the minimal feel of the
existing modes:

- The staff shows **1–8 bars of single-voice music** (notes with real durations,
  bar lines, key/time signature).
- You **play the notes one by one**; the app tracks your position and gives the
  same kind of quiet, unobtrusive feedback as today.
- Two paces: **Step mode** (beginner — play each note correctly, no clock) and
  **Tempo mode** (metronome — the phrase moves on the beat, hit or miss).
- Material comes from two sources: **rule-based generated melodies** (in a key,
  scale or fretboard position of your choosing) and a **bundled library of fixed
  exercises** (e.g. Giuliani studies, folk tunes) parsed at runtime from a
  simple text file format.

Zen mode, mic handling, virtual instruments, themes and all existing modes stay
as they are. Phrase Mode is *additive*: a third toggle next to "Sight Reading"
and "Ear Training".

## 2. User stories

| # | Story |
|---|--------|
| U1 | As a guitar student, I want the app to generate short melodies within a key and a fretboard position, so I practice reading connected lines instead of isolated notes. |
| U2 | As a beginner, I want a mode where the phrase waits for me: the next note is only "armed" after I played the current one, so I can go at my own pace. |
| U3 | As a more advanced student, I want the phrase to advance on the metronome, marking notes I hit in time vs. missed, so I practice real sight-reading under tempo. |
| U4 | As a classical player, I want to practice fixed material (e.g. Giuliani right-hand studies) from a library, so I rehearse real repertoire. |
| U5 | As a future contributor, I want exercises stored in a simple text format in the repo, so more pieces can be added later — found somewhere else, converted, or generated. |
| U6 | As a user of the existing modes, I expect Zen mode, hints, virtual instruments and themes to keep working unchanged in the new mode. |

## 3. Requirements

### 3.1 Core (MUST)

- **R1 — Third game mode.** `gameMode: 'phrase'` alongside the existing two.
  Header shows three toggles. Switching modes must not regress existing modes.
- **R2 — Multi-bar rendering.** The staff renders a phrase of 1–8 bars with
  correct notation: key signature (reusing existing key machinery), time
  signature, note durations (whole/half/quarter/eighth, dots if the library
  needs them), bar lines. Reuses the per-instrument clef + guitar transpose
  logic, incl. grand staff for piano. Notes fit the width; narrow screens show
  fewer bars per system (wrapping into multiple systems).
- **R3 — Cursor & feedback.** The note you currently have to play is visually
  marked (e.g. colored). Played notes get subtle pass/fail coloring. No big
  popups per note — the "minimal feeling" of the existing modes must be kept.
- **R4 — Step mode (beginner).** The next note is armed only after the current
  one was matched (same flicker-tolerant matching as today: `MatchTracker`,
  50 ms hold). Wrong notes simply don't advance (plus the existing "skip"
  affordance to bail out of a note).
- **R5 — Tempo mode.** Metronome at the existing BPM setting; 1-bar count-in;
  the cursor advances at each note's notated duration regardless of hit/miss.
  A note counts as *hit* if the correct pitch is detected and held for the
  match threshold at any point within its window. Missed notes are marked but
  never stop the run. At the end: a compact summary (X/Y notes) with
  *Retry* / *Next phrase*.
- **R6 — Generated melodies.** Rule-based generator producing short
  single-voice melodies: all pitches within the chosen key/scale **and** the
  instrument's playable note set (existing difficulty ranges — incl. custom
  fret windows, i.e. "position playing" comes for free via the existing
  custom_fret difficulty), durations summing exactly to full bars, sane
  musical rules (see 4.1), deterministic under a seed → fully unit-testable.
- **R7 — Exercise library.** A bundled set of fixed exercises parsed at
  runtime from the chosen file format (see 5), plus a picker in the mode's
  UI (title list, grouped by source/difficulty).
- **R8 — Play-phrase preview.** A "Play" button (and keyboard shortcut) plays
  the phrase through the existing `AudioEngine` so the user can hear it before
  reading it — the phrase analog of the existing "Play Note".
- **R9 — Zen mode compatibility.** Phrase Mode honors Zen mode (hide chrome,
  keep staff + minimal controls) and works in landscape/mobile layouts.
- **R10 — No regressions.** Existing tests pass; new logic is unit-tested;
  build and lint stay green; README and TECHNICAL_REALIZATION.md updated.

### 3.2 Nice to have in v1 (SHOULD — done only if time permits after the core)

- S1 — End-of-phrase auto-advance ("practice loop"): after the summary, the
  same phrase repeats (Retry) or the next one loads automatically.
- S2 — Scale drill material: runs/arpeggios in a selected key and position,
  as either generated material or tiny bundled exercises (this is the
  "scales in different positions" ask expressed in the simplest useful form).
- S3 — Repeat marks / looping a sub-range of a longer exercise.
- S4 — Ear-training variant of phrases ("listen to the phrase, then play it
  back") — deliberately deferred, see 3.3.

### 3.3 Explicitly out of scope for v1 (WON'T)

- **Chords / multiple simultaneous voices.** The matching pipeline is
  monophonic by design (single pitch per frame). The data model will keep a
  `voice`-shaped structure so a polyphonic future is not blocked, but v1
  renders and matches single voice only.
- **Polyphonic pitch detection** (fundamental research territory).
- **Scoring history / statistics persistence.**
- **Importing arbitrary user files via file picker** — the library lives in
  the repo; a user-facing importer (file picker → localStorage) is a small
  follow-up once the format is proven.
- **MIDI import.** See 5 for the reasoning; can be added later as a
  build-time/offline converter into the same internal model.

## 4. Functional specification

### 4.1 Melody generator (rule set for v1)

Configurable via settings: key/mode, number of bars, rhythm complexity level,
and the existing difficulty range (which constrains the playable pitch set,
including fretboard position via the custom fret window).

Rules (v1 — deliberately simple, testable invariants in parentheses):

1. Pitch pool = scale of the chosen key/mode ∩ playable notes of the
   instrument/difficulty. *(invariant: every generated pitch ∈ pool)*
2. Start on a stable degree (1, 3 or 5 of the scale); end on the tonic
   (or dominant), placed on a strong beat.
3. Mostly stepwise motion (≈70% steps of a 2nd); leaps mostly 3rd/4th,
   rare 5th/6th/octave; a leap is followed by a step in the opposite
   direction (classic counterpoint heuristic — produces melodic, not
   chaotic, lines). *(invariant: no two consecutive leaps > 4th without
   an intervening step in opposite direction)*
4. No immediate repetition of the same pitch more than twice in a row.
5. Rhythm: per-bar patterns drawn from a complexity-tiered pool
   (level 1: quarters; level 2: + paired eighths / half notes; level 3:
   + dotted quarters & mixed). No rests in v1. Final note ≥ half note.
   *(invariant: durations per bar sum to the bar exactly)*
6. Motivic shape: 4-bar phrases built as 2 bars of motif + 2 bars answering
   (transposed/varied motif) — cheap to implement, dramatically improves
   "sounds like a melody" impression. Optional at difficulty level 3 only.
7. v1 keys: all majors and minors from the existing key-signature list plus
   major/minor **pentatonic**; additional modes (Dorian, Mixolydian, …) are
   trivial follow-ups of the same scale machinery.

### 4.2 Playback state machine

```
IDLE → (start) → COUNT_IN (tempo mode only) → PLAYING → DONE → (retry|next) → …
In PLAYING: cursor at note i,
  step mode:  wait for match(i) → color green → cursor i+1
  tempo mode: window(i) = [t_i, t_i + dur_i); at window end evaluate
              MatchTracker state → green/red → cursor i+1
```

Matching reuses `MatchTracker` unchanged (hold 50 ms, 150 ms flicker grace).
The mic is gated during speaker output exactly as today (`audioEngine.
isAudible()`), so the preview button and virtual instruments can't self-match.

### 4.3 UI concept

- Header: third toggle **"Phrases"** (naming: see 8.1).
- Main stage (non-zen): phrase staff; below it a compact status line
  (step mode: "Play the highlighted note" / tempo mode: bar count-in
  indicator + running hit/miss count); controls: Play (preview),
  Restart, New phrase / Next exercise, plus the existing hint/virtual
  instrument buttons which keep working (hint marks the current note's
  fretboard position).
- End of phrase: one-line summary + Retry / Next. No modal, no confetti.
- Zen mode: staff + exit button only, as today.

## 5. Fixed-material file format — recommendation

The internal representation is a plain TypeScript model (notes with midi +
duration in beats, metadata) that both the generator and the library feed
into. The open question is the ** interchange format** for the library.

| Option | Pros | Cons |
|--------|------|------|
| **ABC notation** ✅ recommended | Text: easy to bundle in git, to author by hand, to LLM-generate, to review in diffs; huge public-domain corpus (folk tunes in ABC everywhere); encodes bars, durations, key, **and note spelling** directly — maps 1:1 onto VexFlow; a subset parser is ~300 lines, fully unit-testable | Little pre-existing classical-pedagogy material in ABC (Giuliani studies must be transcribed — but arpeggio studies are extremely regular and transcribe quickly) |
| MIDI | Abundant files; import of anything | Binary; durations need quantization (grid inference); no spelling — must be re-derived; repeats/structure opaque; parser + quantizer ≈ same size as ABC parser with worse output |
| MusicXML | Notation-perfect | Heavy, verbose, no light-weight parser; overkill for monophonic v1 |

**Recommendation:** bundle exercises as small `.abc` files in the repo
(`src/exercises/library/`), parsed at runtime by a small subset parser
(inline notes, durations, octaves, accidentals, bar lines, key/meter/time
headers, simple `|:` `:|` repeats expanded at parse time; no ties/grace
notes/tuplets in v1). Seed library (public domain — Giuliani died 1829):

- Giuliani Op. 1 right-hand arpeggio studies (selection, transcribed)
- 1–2 Sor/Carcassi-style étude excerpts if the arpeggios go fast
- A handful of well-known public-domain folk melodies
- Scale/run patterns as tiny generated "built-ins" if useful

MIDI stays possible later: an offline converter (Node script) MIDI → same
model can be added without touching the app.

## 6. Technical plan

New code, mirroring the existing layout:

```
src/
├── music/
│   ├── scales.ts            # scale/mode definitions, key→pitch-class sets
│   ├── melodyGenerator.ts   # rules → Phrase model (seeded RNG, pure)
│   └── NoteUtils.ts         # extended: duration→VexFlow glyph mapping (shared)
├── exercises/
│   ├── model.ts             # Phrase / PhraseNote / ExerciseInfo types
│   ├── abcParser.ts         # ABC subset → Phrase (pure, tested)
│   ├── library.ts           # bundled .abc index + metadata
│   └── library/*.abc        # the exercise files themselves
├── hooks/
│   ├── usePhraseTrainer.ts  # state machine from 4.2 (uses MatchTracker)
│   └── usePhraseClock.ts    # audio-clock lookahead scheduler (tempo mode),
│                            #   patterned after the existing useMetronome
├── components/
│   ├── PhraseSheetMusic.tsx # multi-bar VexFlow renderer w/ cursor+colors
│   ├── PhraseControls.tsx   # mode-local buttons/status line
│   └── ExercisePicker.tsx  # library picker (R7)
└── types/SettingsTypes.ts   # new phrase-related settings
```

Integration approach in `App.tsx`: pitch detection stays exactly as-is and
produces `pitchData` once. If `gameMode === 'phrase'`, App renders the
`PhraseTrainer` subtree (staff + controls) fed by the same `pitchData`, mic
gate and audio engine; the existing single-note subtree is untouched. This
keeps `useGameLogic` clean and guarantees the existing modes are unregressed
by construction.

Settings additions (all optional, with defaults — existing installs keep
working):

```ts
phrase?: {
    material: 'generated' | 'library';
    libraryId?: string;        // selected exercise
    key: string;              // generator key/mode (e.g. 'G', 'Am', 'C-penta-maj')
    bars: number;              // 1–8
    rhythmLevel: 1 | 2 | 3;
    pace: 'step' | 'tempo';
    bpm: number;               // tempo mode; defaults to existing rhythm.bpm
}
```

Tempo-mode scheduling follows the proven metronome pattern (lookahead timer
scheduling against `AudioContext.currentTime`) so cursor movement doesn't
drift; note windows are derived from the same schedule, not from `Date.now()`.

### Testing

- `melodyGenerator.test.ts` — invariants from 4.1 (pool membership, bar sums,
  leap rules, determinism under seed).
- `abcParser.test.ts` — golden strings for each syntax feature; error cases.
- `usePhraseTrainer` logic — extract pure reducer/clock math and test the
  state machine transitions with a fake clock (step & tempo mode, hit/miss).
- Renderer gets a thin smoke test; visual QA happens in the browser.
- Full `npm run lint && npm run build && npm test` must pass before finishing.

### Execution / cost control

- Core architecture, integration and the clock/trainer logic: implemented
  directly (these are the parts where mistakes are expensive).
- Delegate to cheaper subagents (pi supports spawning agents with a cheaper
  model, e.g. GLM-5.3-Flash): ABC transcriptions of the Giuliani studies,
  the parser/generator test corpora, the exercise picker UI and other
  template-like UI work — each with tight, verifiable specs, and their output
  re-checked by the main agent before merging.
- Each phase ends in a green build + commit, so the night produces usable
  checkpoints, not one big risky blob.

## 7. Implementation phases

| Phase | Contents | Exit criterion |
|-------|----------|-----------------|
| **P1** | Model + scales + generator (rules 1–5) + multi-bar renderer + Step mode end-to-end (R1–R4, R6 core) | Playable generated melodies in step mode, no clock |
| **P2** | Tempo mode: phrase clock, count-in, per-window hit/miss, summary (R5) | Full generated-melody experience |
| **P3** | ABC parser + bundled library + picker (R7), Play-preview (R8) | Fixed exercises playable in both paces |
| **P4** | Motifs/pentatonic (rule 6–7), S1/S2 if time, Zen-mode polish, keyboard shortcuts, help text, README/TECH docs, final lint/build/tests, push | Night done |

If time runs short, P1–P3 are the must-have spine; everything in P4 is
incremental and can be dropped mid-phase without leaving the app broken.

## 8. Open decisions — defaults if no feedback

| # | Decision | Default I'll assume |
|---|----------|---------------------|
| 8.1 | Mode name / labels | Third toggle labeled **"Phrases"**; existing two keep their current names ("Sight Reading", "Ear Training"). If you'd rather rename the pair (e.g. "Notes" / "Ear" / "Phrases"), say so — cosmetic change. |
| 8.2 | Library format | **ABC** (rationale in 5). MIDI deferred to a later offline converter. *If you feel strongly about MIDI as the primary format, this is the decision to veto.* |
| 8.3 | Tempo-mode strictness | Lenient: misses are marked, never abort. No per-note gating beyond the existing 50 ms hold. |
| 8.4 | Generator keys in v1 | Majors + relative minors from the existing key-signature list + major/minor pentatonic. Church modes: later. |
| 8.5 | Phrase length default | 4 bars, 4/4 only in v1 (3/4 comes free with the model; generator stays 4/4 unless trivial to add). |
| 8.6 | Hints in phrase mode | Reuse existing hint toggle: fretboard/piano hint marks the **current** note only. |
| 8.7 | Publishing | Repo `main` is currently 4 commits ahead of `origin`. Pushing `main` triggers the GitHub Pages deploy. Default: at the end of the night, push **everything** (your 4 commits + mine) after a green build, so the work isn't lost. Say "don't push" if you'd rather review first. |
| 8.8 | Seed library size | ~10–15 items (5–8 Giuliani arpeggio studies, 3–5 folk tunes, 1–2 technical patterns). Quality-checked, not bulk-dumped. |

**Approval:** reply "Go" (optionally with edits/vetoes on the table above) and
I'll implement autonomously overnight following P1→P4.
