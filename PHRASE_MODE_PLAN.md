# Phrase Mode — Reviewed Requirements & Plan

**Status: revised draft; implementation still requires the user's “Go”.**

This replaces the initial GLM draft. The product direction is good; the review
corrects several music, audio, scope, and deployment assumptions. Implementation
must follow this document **and** [the implementation contract](docs/PHRASE_MODE_IMPLEMENTATION.md).
The contract makes behavior and acceptance tests explicit for the next model.
If they appear inconsistent, resolve the inconsistency before implementing;
do not treat the original draft in Git history as an alternative specification.

## 1. Recommendation

Add **Phrases**, alongside **Sight Reading** and **Ear Training**. Keep the
existing modes and their defaults. In Phrases, display a few bars of one melodic
line and follow the player through them. No chords or simultaneous voices yet.

Three material choices, not three additional top-level modes:

- **Melodies:** reproducible, rule-based generation in a selected key/mode and range.
- **Scales:** ascending, descending, or up-and-down scales in any key, optionally
  constrained to a fretboard region. This is a core requirement, not spare-time polish.
- **Exercises:** a small, verified file-backed collection and basic local ABC import.

Two practice paces:

- **At your pace** (default): wait for each correct pitch; rhythm is displayed,
  not assessed. Wrong notes don't advance; an explicit Skip is available.
- **With tempo:** one-bar count-in, then advance according to written durations;
  mark pitches matched during their slots and continue past misses. This is
  deliberately forgiving **pitch-following with a metronome**, not a precise
  assessment of note attacks, release times, or rhythmic accuracy.

All generation, imports, and practice remain browser-local. No backend, runtime
LLM calls, accounts, analytics, or new network dependency for practicing.

## 2. Important corrections to the first draft

| Initial assumption | Reviewed requirement |
|---|---|
| Reusing `MatchTracker` unchanged solves sequence matching | It can repeatedly accept a held pitch. Add per-note result latching and repeated-note re-arming. A tied continuation is not a new attack. |
| `pitchData` is a fresh detection stream | Its pitch can remain displayed for 200 ms after detection stops. Add a separate timestamped raw frame stream, including null frames, for phrase matching. Keep existing display smoothing. |
| The metronome is an already-correct phrase clock | `useMetronome` calls `onTick` when scheduling audio, up to about 100 ms before it sounds. Schedule sounds ahead, but advance the cursor only when the clock reaches the event. |
| Speaker gating can simply cover every sound | Gating 400 ms after every metronome click would disable much of practice. Preview/virtual-note gating and metronome behavior need separate policies. |
| Fretboard positions come “for free” | Pitch ranges help generation, but hints must respect string/fret constraints. A microphone cannot identify which string/fret produced an equivalent pitch. Do not claim fingering verification. |
| Existing key-signature helpers suffice for phrases | They neither restrict current random-note generation nor track accidentals through a measure. Preserve pitch spelling and implement measure-aware accidentals. |
| Giuliani arpeggio studies are automatically single-voice and easy to transcribe | Many contain simultaneous bass/upper notes or sustained voices. Verify a source and explicitly label any single-line adaptation. Never invent an exercise and attribute it to Giuliani. |
| ABC is a roughly 300-line, notation-perfect shortcut | A documented subset is reasonable; full ABC is not. Validate supported syntax and reject unsupported music instead of silently changing it. MIDI is also viable, especially quantized MIDI; it is deferred for scope, not because it is inherently unsuitable. |
| Hiding the single-note UI prevents regressions | `useGameLogic` currently runs unconditionally in `App`. Its matching/metronome effects must actually be inactive in Phrases. |
| Pushing `origin/main` deploys GitHub Pages | `origin` is git.0jm.de; `github` is the GitHub remote. The checked-in workflow deploys on GitHub `main`. Do not conflate backup and production deployment. |

## 3. Stakeholder requirements — required for v1

| ID | Requirement / observable outcome |
|---|---|
| R1 | **Preserve simplicity.** Third mode only; a compact material selector and transport. Advanced generation/import settings live in a collapsible panel. No per-note popups or dashboard. |
| R2 | **Readable notation.** A moving highlight in a stable, responsive view of 1–4 bars at a time; pieces may be longer. Show real durations, rests, ties, bar numbers, clef, and key/time signatures. Do not shrink eight bars onto a phone. |
| R3 | **Correct sequential matching.** Wrong notes wait in at-your-pace mode. Repeated equal pitches need separate playing; holding one note cannot finish a phrase. Rest and tie behavior is explicitly defined in the contract. |
| R4 | **Forgiving tempo practice.** Count-in, Start/Pause/Resume, misses that never stop the run, and a compact matched/skipped summary. No claim of millisecond-level rhythmic assessment. |
| R5 | **Musical generation.** 1–8 bars, default two bars in 4/4; 3/4 also supported. Seeded generation respects the selected scale and playable note set. Favor steps, small contours, and a stable ending rather than unconstrained randomness. |
| R6 | **Any key and scale drills.** All 12 tonic pitch classes; major, natural minor, major/minor pentatonic, and the diatonic modes. One-/two-octave scales or a scale-through-position drill; up/down/both. Only offer a full octave scale when the range can contain it. |
| R7 | **Position-aware guidance.** Reuse note-set/tuning settings; additionally offer a phrase-local fret window for fretted instruments, including bass. Restrict hints to allowed positions. Explain that mic matching checks pitch, not fingering. |
| R8 | **Fixed material.** File-backed library with provenance, work/exercise identification, and adaptation notes. Aim for 4–8 good items, not a quota of unverified transcriptions. Include verified Giuliani material if a suitable lawful source is available. |
| R9 | **Add material without rebuilding.** Minimal local `.abc` file import, validation feedback, and a documented example. In-session use is sufficient; no library manager or import persistence required. |
| R10 | **Focused practice.** Select a bar range in a longer exercise. Retry preserves exactly the same notes; Next moves to the next range (or generates a new melody). Optional Repeat loops the selected range with a count-in in tempo mode. |
| R11 | **Listen before playing.** Cancellable phrase preview at the selected BPM, isolated from scoring. It must stop on mode/material changes and not leave queued notes sounding later. |
| R12 | **Zen, mobile, and accessibility.** Zen retains discreet touch-accessible transport/mic controls and Retry/Next at completion. Keyboard use, visible focus, non-color-only current-note indication, both themes, and reduced motion work. |
| R13 | **Safe lifecycle.** No background scoring/playback after leaving the mode. Pause on a hidden tab, capture interruption, or audio suspension. Existing microphone permission/error handling and virtual instruments remain usable. |
| R14 | **Tested delivery.** Unit/integration tests plus real-browser checks of notation, virtual playing, and synthetic microphone input. Existing tests, lint, and build pass. Documentation states actual limitations. |

### Default experience

Open Phrases → a two-bar C-major melody in the current instrument range → press
Start → play the highlighted notes at your pace → Retry the identical melody
or choose New melody. Nothing sounds until requested; microphone capture still
requires permission/user intent. If the microphone is unavailable, choose the
virtual instrument rather than presenting an unplayable screen.

Settings are progressive: the compact selector can read
“Melody · C major · At your pace”; editing it opens the setup panel. The old
single-note metronome and key-signature controls must not also appear as
competing phrase controls.

## 4. Content and format decisions

**ABC is the primary v1 interchange format**, with a deliberately limited,
documented single-voice subset. The normalized score is independent of ABC,
so a future MIDI or MusicXML adapter can use the same trainer and renderer.

Support common simple notation, including rests, dotted durations, and ties.
Simple repeats and pickups have explicit bounded behavior in the contract.
Unsupported tuplets, polyphony, meter changes, etc. produce actionable errors.
Do not advertise support for arbitrary ABC files.

A bundled exercise must identify its source and the transcription's rights,
not just cite the composer's death date. Generic arpeggio patterns may be
original exercises; they must not be presented as numbered historical studies.
If a Giuliani transcription cannot be verified, ship other verified/original
material and record that limitation. Do not let content research block the app.

## 5. Scope boundaries and optional improvements

**Not v1:** chords, polyphonic recognition, a full notation editor, complete
ABC/MIDI/MusicXML compatibility, phrase ear-training, persistent score history,
strict onset/duration scoring, exhaustive fingering optimization, or automatic
production deployment.

**Only after all required behavior is working:** more repertoire, scale-in-thirds
and arpeggio drill patterns, motif-based call/response generation, saving the
last phrase setup locally, and a MIDI adapter. These must not displace audio
correctness, scales, Zen/mobile behavior, import validation, or tests.

## 6. Implementation sequence and checkpoints

| Phase | Deliverable | Gate before continuing |
|---|---|---|
| P0 | Baseline checks; normalized score, range/scale helpers, matcher/transport contracts; feature branch | Existing tests still green; regression fixtures added |
| P1 | Generated melodies + scale drills + phrase renderer + at-your-pace mode | Playable through mic and virtual input; repeated notes/rests/ties covered; responsive/Zen path usable |
| P2 | Tempo transport, count-in, pause/resume, preview, cancellation | Fake-clock and synthetic-audio tests prove no early cursor, self-scoring, or stale events |
| P3 | ABC adapter, verified library, local import, range selection/repeat | Every bundled file validated; invalid/unsupported imports handled; source notes recorded |
| P4 | Accessibility/lifecycle regression pass, browser QA, docs, delivery | All R1–R14 checked; limitations and exact verification results written down |

Quality work in P4 is **not optional**. Optional features are cut first if the
implementation budget is tight. Finish required phases or explicitly report
what is incomplete; never declare the task done just because it compiles.

## 7. Handoff and publishing

- Implementation begins only after approval. Read
  [the implementation contract](docs/PHRASE_MODE_IMPLEMENTATION.md) before coding.
- Work on `feature/phrase-mode`, branched from the current local state. Preserve
  the existing local commits. Commit coherent, tested checkpoints.
- A normal backup push of the **feature branch to `origin`** is the proposed
  delivery default after “Go”. Do not update either remote's `main`, merge,
  force-push, or trigger production deployment without explicit approval.
- Verify actual model/tool availability before delegation; do not assume the
  suggested GLM model ID or a subagent tool exists. Use cheaper workers only
  for bounded independent work with fixed interfaces and tests. The main
  implementer reviews all output. No unbounded retry/research loops.
- Maintain a short implementation checklist with R1–R14 status, test commands,
  decisions/deviations, known limitations, commit, and push status. This is the
  completion/handoff artifact, not a claim that physical-instrument testing was
  performed when only synthetic input was available.

**Approval defaults:** Phrases label; ABC subset with local import; scales and
all-key support required; at-your-pace/two-bar defaults; tempo mode is forgiving;
feature-branch backup only. Reply “Go”, optionally changing these defaults.
