# Phrase Mode — Implementation Contract

Read [the reviewed requirements](../PHRASE_MODE_PLAN.md) first. This document is
normative for the implementation handoff. It specifies behavior, not a mandate
to use exactly these filenames. Equivalent architecture is fine if the same
invariants and tests hold. Product scope changes must be recorded, not hidden.

## A. Verified baseline and hazards

Review baseline: `0d11570` (initial plan, before this review commit).
`npm run lint`, `npm run build`, and `npm test -- --run` all passed during review:
39 tests in three files. Vite already warns about a large bundle. Use the
non-watch test command for unattended execution.

Relevant current behavior:

- `App.tsx` calls `useGameLogic(pitchData)` unconditionally, owns single-note
  shortcuts, and always renders the old `Controls` outside Zen.
- `useGameLogic.ts` owns random-note selection, matching, autoplay, and the old
  metronome. Merely hiding its staff does not disable these effects.
- `MatchTracker.ts` returns true repeatedly under sustained matching, resetting
  itself after each success. Its threshold is an elapsed matching span tolerant
  of short dropouts, **not** 50 ms of strictly accumulated matching samples.
- `usePitchDetector.ts` preserves the last display pitch up to 200 ms during
  null detection. `audioLevel` is smoothed. Neither is a reliable release stream.
- `useMetronome.ts` calls `onTick` while scheduling future sounds; it also creates
  a separate AudioContext and emits an 880 Hz, 50 ms tone. Do not copy that callback
  behavior into the phrase clock or assume those clicks cannot be recognized as A5.
- `AudioEngine.ts` has immediate `playNote` and an audible-until gate. It currently
  has no cancellable group, phrase scheduling API, or public transport clock.
- `getNoteInKey` is stateless and uses a limited signature table. It cannot alone
  handle measure accidental carry, correct E#/B# spelling, or arbitrary modes.
- `SettingsProvider.tsx` stores settings in memory only. There is no existing
  localStorage migration/persistence mechanism to rely on.
- Guitar/bass notation normally adds 12 semitones to sounding MIDI. Voice range
  overrides and whistle's -12 display offset must continue to work.

## B. Score contract: separate music, presentation, and performance

Use a versioned normalized score. Both generators and import adapters must
produce it; VexFlow and the matcher must not consume raw ABC directly.

A suitable minimal shape (names may change):

```ts
const PPQ = 480; // ticks per quarter note; never floating beat accumulation

type SpelledPitch = {
  midi: number;                         // SOUNDING pitch, integer 0..127
  step: 'C'|'D'|'E'|'F'|'G'|'A'|'B';
  alter: -2|-1|0|1|2;
  octave: number;                       // spelling octave, not floor(midi/12)
};
type ScoreEvent = {
  id: string;                           // stable through rendering/retries
  startTick: number;
  durationTicks: number;
  pitch: SpelledPitch | null;           // null = rest
};
type Measure = { number: number; startTick: number; durationTicks: number };
type Score = {
  version: 1;
  id: string;
  title: string;
  meter: { numerator: 3|4; denominator: 4 };
  key: { tonic: string; mode: string; signature: string }; // signature = parent major name, e.g. 'Bb'
  measures: Measure[];
  voices: [{ id: 'melody'; events: ScoreEvent[] }]; // exactly one in v1
  source?: {
    composer?: string;
    work?: string;
    locator?: string;                    // exercise/page/measure identification
    url?: string;
    rights: string;                      // source AND transcription status
    adaptation?: string;
    writtenToSoundingSemitones: number;  // explicit import normalization
  };
};
```

Invariants:

1. Ticks are finite nonnegative integers; durations are positive. A full measure
   is `numerator * PPQ` for supported meters. Explicit pickup/closing measures
   may be short; other measures must be full.
2. Events are ordered, nonoverlapping, and contiguous (silence is an explicit
   rest). The final event ends at the score's final tick. Reject empty/all-rest
   scores for practice. No chords or second voice are silently discarded.
3. A **logical note** is one required attack. Explicit ties between equal
   sounding pitches merge into one event. The renderer splits that event into
   tied glyphs at measure boundaries; matcher/summary count it once. Adjacent
   equal pitches without a tie stay distinct events.
4. Keep runtime state separate: selected bar range, source-event mapping,
   seed, cursor, status, matched/missed/skipped results, and scheduled audio are
   not mutable fields on the score.
5. A selected range clips events to the range and rebases ticks. A tie entering
   the selection becomes a new attack at its beginning; internal ties remain
   one logical note. This makes starting at any bar well-defined.
6. Match and synthesize SOUNDING MIDI. Preserve enharmonic spelling. Apply the
   active instrument/range display transpose **once**, only when rendering.
   Example: guitar-source ABC `E,` means written E3 (MIDI 52); an explicitly
   configured -12 source conversion normalizes it to sounding E2 (40). Guitar
   rendering then shows E3 (52), while the mic must match 40, not 52 or 64.
7. Imported ABC defaults to concert pitch. An import option explicitly selects
   “written guitar/bass (sounds octave lower)” if needed. Do not infer this
   merely because the user's current instrument is guitar. Bundled metadata
   supplies the appropriate convention. An optional practice octave shift is
   separate and visible; never silently shift individual notes to fit a range.

## C. Theory, playable range, and generation

### C1. Shared range resolution

Extract the existing playable-note calculation into a pure helper with tests.
Preserve its old single-note behavior. Phrase mode uses that set by default.
When an explicit phrase-local fret window is enabled, derive pitches directly
from the tuning and that window instead of intersecting with the old note-set
bounds (which would incorrectly exclude high positions, especially on bass).
Make this override visible and disable the competing note-set control; retain
a selected single-string restriction if applicable. Generated material then
intersects the resolved playable set with the scale; fixed scores do not.

- Deduplicate and numerically sort pitches. Validate instrument, tuning, range,
  and `0 <= minFret <= maxFret <= 24`; prevent NaN/empty values from reaching
  generation. A stored guitar tuning must not constrain piano/voice/whistle.
  The microphone's instrument-floor calculation must likewise ignore irrelevant
  tunings; test whistle/voice/piano after switching from guitar.
- Fret constraints apply to guitar **and bass**. Do not depend on bass having a
  `custom_fret` range in `InstrumentConfigs` (currently it does not).
- Each allowed guitar/bass pitch must have at least one actual allowed
  `{stringIndex, fret}`. Restrict hints to those positions, including a selected
  single string. Ensure the board can display the selected frets (it currently
  hardcodes 15 in `App`). Do not show off-position hints.
- This is pitch availability, not an optimized fingering path or a guarantee
  about what string the microphone heard. State that limitation in setup/help.
- Empty pools produce an actionable error (“Widen the range or change key”),
  never a fallback chromatic/out-of-range note. Generated melodies require at
  least two distinct eligible pitches; generation loops must be bounded.
- Fixed scores keep their pitches, including chromatic notes outside the key's
  scale. Key signature is a notation context, not a pitch filter for repertoire.
  Show range conflicts and offer an explicit octave shift or range change; do
  not remove notes. Require a playable selected
  range before starting. Virtual keys must also cover that selected range.

### C2. Scales and spelling

Support 12 tonic pitch classes, not just the limited existing dropdown. Modes:

| Mode | Semitone offsets from tonic |
|---|---|
| Major / Ionian | 0, 2, 4, 5, 7, 9, 11 |
| Dorian | 0, 2, 3, 5, 7, 9, 10 |
| Phrygian | 0, 1, 3, 5, 7, 8, 10 |
| Lydian | 0, 2, 4, 6, 7, 9, 11 |
| Mixolydian | 0, 2, 4, 5, 7, 9, 10 |
| Natural minor / Aeolian | 0, 2, 3, 5, 7, 8, 10 |
| Locrian | 0, 1, 3, 5, 6, 8, 10 |
| Major pentatonic | 0, 2, 4, 7, 9 |
| Minor pentatonic | 0, 3, 5, 7, 10 |

Use a conventional enharmonic key spelling requiring at most seven signature
accidentals. The chosen **mode** affects the tonic spelling and parent signature;
do not force one spelling of every root across all modes. Present the resolved
name in the UI (e.g. C# minor, not a theoretical Db-minor signature).

Derive modal signatures from their parent major scale. Pentatonics use their
corresponding major/natural-minor signature and omit scale degrees. Preserve
E#, B#, Cb, and Fb where required; do not approximate using a sharp/flat chromatic
name array. Allow imported double accidentals in the spelling model.

### C3. Melody generator

API concept: `generateMelody(config, eligiblePitches, seed) -> Result<Score>`.
All randomness flows through the supplied seeded PRNG. Save the seed with the
session; Retry never calls generation. New melody explicitly changes the seed.

- Generated length: integer 1–8 bars, default 2; meter 4/4 default, 3/4 supported.
- Two rhythm levels for v1: **Simple** (quarter/half/dotted-half/whole notes as
  meter permits) and **Mixed** (also paired eighths and dotted quarters).
  Use validated per-bar rhythm templates, never an unbounded fill-and-retry loop.
  Simple may use quarters internally and a longer final note; do not promise
  both “quarters only” and “last note must be a half note”. Rests need not be
  generated in v1, but the score/importer/trainer must support them.
- Prefer movement to an adjacent degree of the full chosen scale, then thirds;
  larger moves are rarer. An “adjacent eligible pitch” is not necessarily an
  adjacent scale degree in a sparse fret/string pool. Weight by actual interval.
- Prefer start/end on tonic, otherwise another available stable degree. Land
  the final note on a beat and normally hold it for at least two quarter beats.
- Avoid more than two equal notes in a row where alternatives exist. Favor a
  step back after a leap of at least five semitones when such a step is playable.
- Hard invariants: scale/range membership, exact bar totals, valid spelling,
  determinism, and termination. Musical preferences are **soft** when sparse
  ranges make them impossible. Do not write unconditional “70% steps” or leap
  assertions that fail valid restricted ranges. Do test preferences over a
  large seeded sample with a normal diatonic range.
- Large disconnected pools should yield the best available in-range path or a
  clear “range too sparse for this exercise” result, not silent constraint escape.
- Motif/answer transformations are optional and must revalidate all constraints.

### C4. Scale drills (required, separate from random melodies)

- Options: direction up/down/up-and-down; coverage one octave, two octaves, or
  **within position**. Same tonic/mode/range controls as generated melodies.
- For octave drills, choose the lowest eligible tonic whose complete requested
  scale path fits the playable set. If none fits, explain and offer “within
  position” or a wider range; never output an incomplete “one-octave scale”.
- Within-position drills traverse the eligible scale notes in order and are
  labeled as such; they may start/end away from tonic. They are not a promise
  of a conventional named fingering pattern.
- Default quarter notes, no duplicate turning-point note in up-and-down runs.
  Derive bar count from the run, not the melody's bars setting; extend the final
  note to complete a bar, splitting with ties if needed. Cap score sizes.
- Hints apply the same position filter as generation. No finger numbers/tab
  are needed for v1. Step and tempo practice use the exact same score.

## D. Input, matching, and scoring

### D1. Fresh input contract

Add a separate raw-frame callback/subscription to the pitch-detection path:
`{ sequence, observedAtMs: performance.now(), midi: number|null, rms }`.
Emit it on **every** analysis tick, including null pitch. Preserve the existing
smoothed display outputs and instrument-specific detector algorithms.

Deliver frames directly to the phrase controller (or a small subscribed store),
not by pretending every React render is another audio sample. Ignore duplicate
sequence IDs; clear subscribers on unmount. Read raw RMS from the analyzer, not
the smoothed UI meter, if using it. Do not reconstruct releases from `pitchData`.

For timed practice, stamp a frame with the **phrase transport AudioContext's**
current time when its callback is delivered. This is detection-arrival time,
not a measured acoustic attack time. Do not compare timestamps from unrelated
AudioContexts or compare `Date.now()` to AudioContext seconds. Keep performance
time for freshness/gap checks. No latency calibration is claimed in v1.

Offer microphone or virtual input explicitly. Start in microphone mode waits
for capture to actually succeed; permission denial shows the existing error and
a virtual-input alternative. Virtual mode works without microphone permission.

### D2. Matching rules

Implement a phrase matcher/controller around or beside `MatchTracker`:

1. Match exact MIDI including octave. Require the existing 50 ms tolerant
   matching span on fresh mic frames; reset the candidate and accumulated
   release evidence on a sample gap over 100 ms or playback gating. A single old frame cannot become a held note.
2. Each logical event has a **latched**, one-way result. A second success for
   that event is ignored. Never inspect the reset tracker at a window's end
   and mistakenly conclude that an earlier success did not happen.
3. For consecutive untied equal pitches, a sustained signal must not satisfy
   the next event. Re-arm after at least **80 ms** of fresh null/different-pitch
   frames, then require a fresh match. Brief detector dropouts must not re-arm.
   Track this even across rests and tempo boundaries; one sounding episode
   cannot earn credit again when a later slot returns to the same pitch.
   Matching a genuinely different pitch establishes a new episode.
4. Baseline v1 cannot reliably detect a same-pitch repluck with no detected gap.
   Tell the user “For repeated notes, briefly release/mute between notes.”
   Fast repeated notes may require a slower BPM, particularly with long bass
   analysis windows. Do not invent a robust onset detector from smoothed volume.
   A tested raw-RMS reattack detector is optional later, not a release condition.
5. A virtual click/tap is an explicit attack and can immediately match once;
   repeated taps can match repeated equal pitches without a mic hold. Its
   synthesized sound must not contribute a second microphone result.
6. At-your-pace mode: match advances immediately to the next logical note;
   ties are one note; rests display but are automatically traversed, with no
   silence requirement or timing score. Wrong notes wait. Skip marks a separate
   skipped result and advances. Never label eventual completion “100% accuracy”.
7. With-tempo mode: event window is `[start, end)`. A confirmed pitch anywhere
   within the window latches matched; otherwise mark missed at its end.
   Confirmation must complete before `end`. There is no early/late allowance
   crossing into neighbors. Finish expired windows **before** applying a frame
   at a boundary; never credit one frame/event to multiple targets.
8. Timed rests consume their written duration, ignore playing, and are excluded
   from the score. A tied note has the combined-duration window and counts
   once. V1 does not score articulation, sustained duration, or silence at rests.
9. No scoring in ready, count-in, paused, preview, done, or error states.
   Keep a run/session generation token so stale callbacks cannot affect a new run.
10. Carry the consumed-pitch/re-arm protection across automatic repeats; looping
    a one-note exercise must not repeatedly score one held note.

Summary: tempo mode “Matched X of Y notes”; at-your-pace “Completed X notes,
skipped Y”. Count logical notes, not tied glyphs or rests. No live scoreboard in
Zen; small end-of-run feedback only.

## E. Transport, audio, and cancellation

Use a pure transition layer with an injected clock for tests, and a thin hook
for lifecycle/audio. States: `ready`, `countIn`, `playing`, `paused`, `preview`,
`done`, `error`. A score is generated/loaded once per explicit material change,
not whenever pitch, theme, BPM, or window size changes.

### E1. Timing and transitions

- Phrase BPM is independent of the single-note rhythm/timer controls: quarter
  note = 30–180 BPM, default 60. Validate finite numbers in the controller too.
- Invoke audio-context creation/resume directly in the Start gesture, before
  awaiting microphone permission (important for Safari autoplay policy). Await
  both successful capture, when needed, and context resume before running.
  Begin neither count-in nor timers on a suspended clock; show a recoverable
  Start action.
- Use one transport/output AudioContext for phrase clicks, preview, and cursor
  timing. A 25 ms scheduler with roughly 100 ms lookahead is appropriate for
  audio scheduling only. Update cursor/state when `currentTime` reaches the
  boundary, not when the future oscillator is queued.
- Derive each boundary from `runStart + tick / PPQ * 60 / bpm`, not repeated
  floating additions or `setInterval` increments. Visual animation may use rAF.
- Count-in is one complete measure (3 or 4 quarter beats), also for a pickup.
  At 60 BPM, a 4/4 count-in clicking at times 0, 1, 2, 3 starts the score at 4.
- At-your-pace Pause/Resume preserves the current logical target/results.
  With-tempo Resume re-counts and restarts the current bar, clearing results
  from that bar onward; a note tied into that bar becomes a fresh attack.
  This is simpler and less confusing than resuming midway through a note.
- Retry resets results and restarts the identical selected music (count-in if
  timed). New melody changes the seed. Library/import initially selects the
  first two measures (or all if shorter); let the user select start and count,
  capped at eight measures per practice range. Next advances to the next
  selected-length bar range; at the end offer “Back to beginning”,
  not an unrelated piece. Scale drills offer Repeat rather than random Next.
- A Repeat checkbox (off by default) retries the selected range automatically;
  timed repeats get a fresh count-in. The user can always pause/stop it.
- Applying structural setup changes (key, range, source, meter, instrument,
  tuning, pace) cancels the run and rebuilds to ready. Changing BPM while running
  pauses; the next Resume recomputes timing. Do not retime a partly played note.
- Pause on document hidden, mic disconnection in mic mode, audio suspension,
  opening a settings/help/import dialog, or an observed processing gap >250 ms.
  Do not fast-forward a backgrounded phrase and mark everything missed.

### E2. Output ownership and mic isolation

Extend `AudioEngine` or add a shared-context phrase transport with:
`resume`, `now`, scheduled-note playback, and cancellable playback groups.
Keep existing single-note behavior intact. Track oscillator/gain nodes, not
just timers; clearing a timer cannot stop audio already queued by lookahead.

- **Preview:** pause practice, play the selected range at its written durations,
  with no scoring. The button toggles Preview/Stop preview. On stop/end return
  to ready/paused, never automatically to playing. Gate mic input through the
  actual output plus the existing 400 ms tail. Cancel future sounds and remove
  their future gate reservations; a canceled long preview must not leave the
  mic gated until its former end time.
- **Virtual-note audio:** explicit taps count; their speaker sound does not.
  Preserve the existing mic gate for pitched reference/virtual audio.
- **Metronome:** do not feed every click through that 400 ms pitched-audio gate.
  Default click sound off (visual count-in/beat cue on). Audible clicks are an
  explicit option with a headphones recommendation. Use a short non-tonal
  click (e.g. <=10 ms noise burst), not the current 880 Hz tone. Exclude mic
  samples for 30 ms after a scheduled audible click; do not count that blanked
  interval as release evidence. Validate that normal notes still match with
  clicks enabled. This is a modest bleed safeguard, not acoustic echo cancellation;
  speakers/room reverb may still require headphones or silent clicks.
- Silent/zero-volume output must not create audible gates or tiny residual tones.
- Cancel all scheduled groups, rAFs, timers, and subscriptions on Stop, mode
  switch, score replacement, or unmount. A canceled callback also checks its
  run token. Do not create a new AudioContext for every render or note.

## F. Notation and view contract

Create a phrase renderer rather than forcing multi-note behavior into the
single-whole-note `SheetMusic` component. Share styling utilities if useful.

- Preserve source spelling; maintain accidental state by letter AND octave
  within each measure, initialized from the key signature and reset at barlines.
  Naturals cancel a signature accidental; reintroduced sharps/flats need a sign.
  Example, `K:G`, `L:1/4`, `=F F ^F F | F4 |`: first two Fs natural, next two
  sharp, next-bar F sharp by signature. The third note needs an explicit sharp.
- Use real note spacing, stems, dots, and beat-appropriate eighth-note beams.
  Split long logical notes with ties. Support 3/4 and 4/4 without abusing
  VexFlow soft voices to conceal malformed bar totals. Pickups are explicit.
- Use the active instrument/range clef/transpose. For piano grand staff, align
  both staves to the same timeline, using invisible rhythmic placeholders where
  needed; the score is still monophonic, not two simultaneously scored voices.
- Show a bounded window of measures: typically two, one on narrow screens,
  up to four when space permits. Advance at a bar/page boundary, not on every
  note; keep the current note and following material readable. Repeat clef/key
  at each new displayed system. Show source bar numbers/range for orientation.
- Re-layout on score/range/width/theme changes. Do not rebuild the entire VexFlow
  SVG at microphone frame rate. Memoize static notation; update current-note
  indicator and result styles at event transitions. No live detected-note
  “second measure” should push the phrase around.
- Current note uses a caret/underline or outline as well as color. Passed and
  missed coloring remains subtle and legible in both themes. Honor reduced
  motion; preserve the existing ledger-line and system-theme-change fixes.
- Small portraits may scroll a dense measure horizontally as a last resort,
  but no clipping/illegibly tiny global scaling. Validate actual browser output,
  not just a JSX smoke test. Give the score an accessible text description.

## G. ABC adapter, library, and local import

Keep the parser behind `parseAbc(text, options) -> Result<Score, Diagnostic[]>`.
A documented subset parser is acceptable; a maintained parser dependency is
also acceptable if its output is normalized/validated and the bundle impact
is justified. Do not implement full ABC from an optimistic line-count estimate.

Required subset:

- One tune/voice; headers `X`, `T`, `C`, `S`, `Z`, `M`, `L`, `Q`, `K`; blank
  lines and `%` comments. Keys: tonic letter plus optional `#`/`b`, followed
  by no suffix/`maj` (major), `m`/`min` (natural minor), or the modal suffixes
  `ion`, `dor`, `phr`, `lyd`, `mix`, `aeo`, `loc`; e.g. `K:F#`, `K:Am`,
  `K:Ddor`. Reject unrecognized key specifications, never fall back to C.
- `A`–`G`, `a`–`g`, comma/apostrophe octaves, `^`, `_`, `=`, and doubled
  accidentals; durations via integer/fraction suffixes; rests `z`.
- `L:1/4` and `L:1/8`; supported resulting durations: eighth, quarter,
  dotted quarter, half, dotted half, whole. Other values return a clear error.
  Dots are encoded using ABC length multipliers, not invented note-dot syntax.
- `|`, `||`, `|]`; simple nonnested `|: ... :|` repeats exactly twice, expanded
  before normalization. No alternate endings or implicit/nested repeats.
- Explicit `-` ties between equal pitches, including across barlines. Preserve
  spelling/accidental carry while parsing, merge ties into logical events after.
- 3/4 and 4/4; optional first short pickup. A short final measure is allowed
  if it complements that pickup; other short/overfull measures are errors.
  Source barlines are validated, not guessed from an arbitrary stream of notes.
- `Q` is metadata/default suggestion; the user's phrase BPM controls practice.
  No tempo/meter/key changes partway through a tune in v1.

Reject with line/column and a useful message: chords `[CEG]`, multiple tunes or
voices, tuplets, grace notes, unsupported decorations/directives, alternate
endings, malformed ties, unsupported lengths/meters, unknown syntax. An explicit
whitelist may ignore recognized nonmusical metadata; never silently strip
unknown notation. Single-voice extraction from a polyphonic file is not automatic.

Bounds: at most 256 KiB input, 256 expanded measures, and 4096 events. Apply
bounds during tokenization/repeat expansion, not only after allocating output.
No eval/HTML injection, fetched URLs, or external resource interpretation.
Render titles/errors as text. Invalid imports keep the previous score intact.
File loading is local/in-session and available via a setup-panel action.

Use this concert-pitch example as a parser/authoring fixture:

```abc
X:1
T:First steps
C:Original exercise
M:4/4
L:1/4
Q:1/4=60
K:C
C D E F | G2 E C |]
```

Expected MIDI: `60, 62, 64, 65, 67, 64, 60`; durations in ticks:
`480, 480, 480, 480, 960, 480, 480`; two complete bars. Also test
`C4- | C4 |` as one eight-quarter-note logical event, and a pickup such as
`G | C D E F | G3 |]` (with the same meter/unit/key).

Bundle files with a manifest giving title, composer, source URL/locator,
transcription rights, adaptation, and pitch convention. Use Vite `?raw` imports
or base-path-safe assets, not a dev-only filesystem fetch. Parse/validate every
bundled item in tests. Document the exact subset plus a copyable working file.

Content policy:

- Target 4–8 checked items, including original scale/interval/arpeggio exercises
  and verified public-domain melody excerpts. Strive for a verified Giuliani
  single-line adaptation, but do not fabricate provenance to satisfy a quota.
- Giuliani Op. 1 may require omitting simultaneous or sustained parts. Identify
  which exercise/measures and precisely what was changed. A composer's old
  work does not automatically clear a modern edition/arrangement/transcription.
- Original generic technical exercises are labeled “Original exercise”, not
  “Giuliani No. X” or a guessed Sor/Carcassi excerpt. Keep a small SOURCES/readme
  alongside the manifest. Quality and verifiability outweigh library size.

## H. App integration, settings, and shortcuts

Suggested responsibilities:

- Pure `music/` helpers: range resolution, scale/key spelling, seeded generators.
- `exercises/`: score model/validation, ABC adapter, library and source metadata.
- `game/`: phrase matcher and pure transport transitions.
- `audio/` plus a hook: cancellable scheduled audio and raw-frame/clock adapter.
- Components: phrase trainer, renderer, compact setup/transport.

Render **either** `SingleNoteTrainer` (owns `useGameLogic`) **or** `PhraseTrainer`.
Extracting the old UI/hook into a child is preferable to calling hooks
conditionally. Alternatively gate all old effects explicitly and test it.
App may continue to own shared microphone capture, theme, and global chrome.
Clean up pre-existing timers when extracting the old subtree.

Phrase configuration includes material (`melody|scale|library|import`), tonic
pitch class/mode, melody bars/meter/rhythm level, scale direction/coverage,
optional fret window, source/range/octave shift, pace, input, BPM, click sound,
and Repeat. Runtime status/seed/results are separate. Defaults: melody, C major,
2 bars, 4/4, Simple, at-your-pace, mic input, 60 BPM, click off, Repeat off.
Scale defaults: one octave/up-and-down, with an actionable error if it cannot fit.

Keep phrase controls independent from legacy `rhythm.active/autoAdvance/seconds`.
Hide/replace the legacy key/rhythm panels in phrase mode while keeping shared
instrument, tuning, range, tuner, and theme controls. Do not accidentally force
single-note autoplay for phrases. Settings changes must not regenerate scores
when merely toggling hints/theme or receiving a microphone frame.

Zen shows notation plus a discreet transport (Start/Pause, mic status/control,
Exit); at completion expose Retry/Next. Never require leaving Zen or using a
keyboard to recover from pause/completion/error. Setup/library UI stays hidden.

Keyboard policy: retain existing single-note shortcuts in those modes. In
Phrases: Space Start/Pause/Resume, P Preview/Stop preview, R Retry, N Next/New,
S Skip (at-your-pace only). M cycles all three modes; Z/H/V/L retain their roles.
Help reflects the active mode. Do not handle global shortcuts inside input,
textarea, select, button, contenteditable, or open dialog; ignore modifiers and
key auto-repeat for destructive/transport actions. Enter/Space on focused buttons
must trigger only their native action, not an additional global skip/start.

Optional persistence stores only validated versioned setup/selection; never
mic permission, autoplay/resume state, audio objects, raw frames, or live results.
Failure/unavailable storage must not prevent practice.

## I. Required verification and completion record

Run baseline and final commands:

```sh
npm run lint
npm run build
npm test -- --run
```

Minimum regression cases (automate pure logic/integration cases):

| Area | Required evidence |
|---|---|
| Theory | Every tonic × supported mode; valid spelling/signature, correct pitch classes, F# major E# and C# major B#, instrument octave conversions |
| Generation | At least 100 seeds per normal configuration; exact bar sums, allowed pitches, determinism; empty/single/sparse pools; alternate tunings and invalid fret ranges; zero unbounded retries |
| Scales | C major one octave gives C D E F G A B C in eligible register; down/both order; turning tonic once; full-octave refusal when a degree is unavailable; position-only hints |
| At your pace | C–D–E advances only in order; wrong pitches wait; C–C needs release/re-tap; 20 ms dropout does not re-arm; 80 ms release does; ties count once; rests don't stall; Skip is not a hit |
| Freshness | Duplicate/stale frames do not score; held display data on null raw frames cannot match; >100 ms sample gap resets candidate; mic-off/permission failure doesn't run a broken session |
| Tempo | Fake-clock count-in starts exactly at the notated boundary; queuing 100 ms ahead does not advance early; last-note hit latches; boundary samples belong only to new window; misses/rests advance on time; held C cannot score C–rest–C twice |
| Audio | Preview never scores; cancel removes future sounds/gates; repeated virtual taps work; zero-volume has no gate; synthetic metronome-only input does not score A5/other notes; clicks plus played notes remain usable |
| Lifecycle | Rapid Start/Stop/Retry and React StrictMode do not duplicate timers/notes; mode switch leaves exactly one trainer active; pause/resume/bar reset; tab hidden and audio/mic interruption pause rather than catch up |
| Import | Every bundled ABC validates; octave/accidental carry, naturals, dotted lengths, ties, pickups, bounded repeats; unsupported polyphony/tuplets, malicious title strings, malformed/oversized inputs fail safely |
| Range/repeat | Retry uses same seed/events; Next selects correct bars; clipped tie becomes attack; automatic Repeat cannot farm one sustained pitch; out-of-range material never silently changes pitch |
| Rendering/UX | Real browser: desktop, ~390px portrait, short landscape; light/dark/auto, treble/bass/grand, fret hints, mixed rhythm/ties; readable notation; no full SVG reconstruction at raw frame rate; keyboard and touch Zen completion |
| Legacy | Sight Reading and Ear Training, autoplay/quiet wait, tuner, microphone toggle, virtual instruments, theme, shortcuts, and old metronome continue to work |

Use synthetic microphone input in a real browser where feasible (a scripted
oscillator into `MediaStreamDestination`, substituting `getUserMedia`), not
only virtual clicks. Distinguish that from testing a physical guitar in a room.
Save reproducible tests/scripts rather than relying on one-off visual claims.
If a browser/device is unavailable, identify the missing coverage explicitly.

Delivery checklist must map R1–R14 to code/tests and state what was actually
verified, any content/parser/detection limitations, and remaining optional work.
Do not suppress lint/type errors, disable tests, silently reduce required scope,
or claim “no regressions by construction”.

Git: the reviewed baseline has local commits not on `origin/main`. Preserve
those; use `feature/phrase-mode` and ordinary checkpoint commits. Approved backup
means that branch to `origin` (git.0jm.de). GitHub Pages would be triggered by
updating GitHub `main`; deployment is not part of approval by default. Record
push failures; do not force-push or change remote configuration to bypass them.
