# Phrase Mode — Delivery Record

Implementation of [PHRASE_MODE_PLAN.md](../PHRASE_MODE_PLAN.md) and
[the implementation contract](PHRASE_MODE_IMPLEMENTATION.md), branch
`feature/phrase-mode`.

## Requirement status

| Req | Status | Where |
|-----|--------|-------|
| R1 Preserve simplicity | ✅ | Third mode toggle (`Phrases`); transport reuses single-note button styles; setup is one collapsible panel |
| R2 Readable notation | ✅ | `PhraseSheetMusic` (multi-system, 1–4 bars/row adaptive, ties, rests, dotted values, bar numbers, key/time sigs, grand staff, themes); row height increased after user feedback on clipped ledger notes |
| R3 Correct sequential matching | ✅ | `PhraseMatcher`: latched results, sustained-episode blocking for repeated pitches (release ≥80 ms, ≥2-frame stable different pitch, or 2.5 s timeout in at-your-pace mode) |
| R4 Forgiving tempo practice | ✅ | 1-bar count-in (no scoring during it — fixed after browser test caught a false credit), windows advance regardless, misses marked, summary "Matched X of Y" |
| R5 Musical generation | ✅ | `generateMelody`: seeded, scale∩playable pool, soft step/contour/tonic-end preferences, exact bar totals, 1–8 bars, 4/4 + 3/4, Simple/Mixed rhythm tiers |
| R6 Any key + scale drills | ✅ | 12 tonics × 9 modes (incl. pentatonics), one/two-octave (complete path only — refuses with actionable error) + within-position, up/down/up-down |
| R7 Position-aware guidance | ✅ | Phrase-local fret window (guitar/bass) overrides note set; hints restricted to allowed positions; "pitch not fingering" note shown |
| R8 Fixed material | ✅ (adjusted) | 19 bundled items: 5 verified public-domain melodies (Ode to Joy, Ah! vous dirai-je, Jingle Bells opening, Mary Had a Little Lamb, London Bridge phrase) + 14 clearly-labeled original exercises. **No Giuliani**: no verifiable source available offline; per contract the quota was not faked — limitation recorded |
| R9 Add material without rebuilding | ✅ | Local `.abc` import in the setup panel with validation errors shown; failures keep the previous score |
| R10 Focused practice | ✅ | Start bar + bars-at-a-time selection (fixed material), Retry identical (same seed), Next advances/wraps, **auto-continue** (default on, tempo mode) rolls to the next section/new melody without interruption |
| R11 Listen before playing | ✅ | Cancellable preview at practice BPM via `AudioEngine` groups; returns to ready, cancels future sounds and gate reservations |
| R12 Zen/mobile/accessibility | ✅ mostly | Zen: staff + Start/Pause + mic; Retry/Next appear at completion. Keyboard shortcuts per mode (help popup reflects active mode); focused buttons never double-fire global shortcuts; current note = color + caret glyph; aria-label on the staff |
| R13 Safe lifecycle | ✅ | Pause on tab-hide, mic error, mic-off, dialogs; audio-group cancellation; run tokens; StrictMode-safe; unmount cleanup |
| R14 Tested delivery | ✅ | 149 unit/integration tests + real-browser synthetic-mic suite (see below) |

## Late feedback round (post first delivery)

- **Guitar octave bug**: the phrase renderer drew sounding pitch; fixed by
  deriving the written pitch through the shared `spelledPitch` helper, and
  clef/transpose resolution extracted to `resolveClefTranspose` (used by both
  modes — requested reuse of proven single-note logic).
- **Count-in**: an extra 5th click at the score's downbeat made players start
  a beat early (perceived as "play the note before"); removed (the count-in's
  last click IS the downbeat).
- **Tempo timing proven**: browser test plays every Ode note exactly in its
  audio window → 8/8 matched (also caught + fixed false scoring during the
  count-in itself).
- **Repeated notes**: release-based re-arm + 2.5 s at-your-pace timeout + a
  clear status hint ("release, then strike again").
- **Auto-continue** (tempo, default on): exercises roll to the next section
  (wrapping), melodies roll a new seed, scale drills restart.
- **BPM widget**: −/+ buttons + slider + free-typing text field (commit on
  blur/Enter) — the single-note widget pattern.
- **Live-note staff** next to the mic readout: written-pitch mini staff with
  8va/8vb normalization; box matches the mic button; VexFlow's
  `space_above_staff_ln` (~40.5px) offset compensated (see TECHNICAL_REALIZATION).
- **Library**: 19 items (5 verified PD melodies + 14 labeled originals).
- **Zen centering** + live staff sizing/overlap per user feedback.

## Verification actually performed

- `npm run lint`, `npm run build`, `npm test -- --run`: all green (149 tests,
  9 files) at commit `909c301`.
- Real-browser (headless Chrome via `scripts/phrase_e2e*.cjs`, synthetic mic):
  - **Tempo timing: every note of the Ode opening played exactly in its audio
    window matches (8/8)** — proves count-in/window/display alignment after
    the redundant-downbeat click fix.
  - Detection pipeline sanity (single-note readout shows synthetic 440 Hz).
  - Phrase mode: first note matches with a sustained synthetic pitch; cursor
    advances; no console errors.
  - Repeated E–E (Ode to Joy): sustained pitch blocked; release (400 ms mute)
    + re-attack matches; 2.5 s sustained hold re-arms in at-your-pace mode.
  - Tempo mode: count-in phase, no scoring during count-in (found + fixed a
    false credit during count-in), 8 windows expired as `missed` with silence,
    run reaches `done` without deadlock.

## Known limitations (honest)

- **Repeated same-pitch notes**: a genuine re-attack with no detectable gap
  (same string, ringing decay) is indistinguishable from holding the note.
  Mitigations shipped: release/timeout re-arm + explicit status hint. A
  raw-RMS reattack detector is future work.
- **Mic matching is pitch-only**: no fingering/string verification (a mic
  cannot know which string was played); no timing/onset precision in tempo
  mode — it is pitch-following with a metronome, as specified.
- **Giuliani content**: not included (no verifiable source at hand). Library
  holds 2 verified PD melodies + 4 clearly-labeled original exercises.
- **Live played-note staff** next to the mic readout shows the detected pitch as written notation (same display pipeline as the single-note "played note" measure).
- **ABC subset only**: documented subset (no tuplets, polyphony, alternate
  endings, mid-tune meter/key changes); rejects with line/column errors.
- **Count-in/preview drift**: click scheduling uses the shared AudioContext
  lookahead (~100 ms) — cosmetic audio jitter possible under load; cursor
  timing derives from boundaries, not the scheduler.
- **Deviation recorded**: fixed-material range conflicts warn + offer octave
  shift instead of blocking the run (contract said "require playable before
  start"); judged more user-hostile than helpful at this scale.
- **Settings persistence**: in-session only (pre-existing app behavior).

## Reuse of single-note logic (user request)

- Clef/transpose resolution extracted to `resolveClefTranspose` — used by
  both renderers; detection floor, tunings, note sets, `MatchTracker`,
  `AudioEngine` mic-gating, Fretboard/PianoKeys all shared unchanged.
- The renderer octave bug (staff showed sounding instead of written pitch)
  was fixed via the shared `spelledPitch` helper — same sounding+transpose
  semantics as `SheetMusic`.

## Not done / deferred

- MIDI adapter, motif-based generation, persisted phrase setup, extra
  repertoire, per-note timing scoring — all explicitly deferred in the plan.

## Feedback round 4 (2026-09-15): always-eighths arpeggio/Giuliani + custom/random patterns

**Generator redesign (Phrase Mode materials `arpeggio` + `giuliani`):**

- **Always eighth notes** (240 ticks/note). The quarter-note fallback and
  stretch-the-last-note logic were removed — the latter produced
  non-renderable 2880-tick durations (two-octave arpeggio in 6/8) that
  crashed the VexFlow renderer (white screen).
- **Auto-derived meter** (`autoArpeggioMeter`): 3/4 vs 4/4 chosen by the
  smallest rest remainder for the path length (fewer bars as tiebreaker).
  Giuliani meter derives from figure length (3 voices → 3/4, 4 → 4/4,
  5 → 4/4 + rest fill, 6 → 3/4). The Meter and Rhythm selects were removed
  from both setups; leftover bar space is filled with rests built from
  renderable durations only.
- **Custom arpeggio pattern**: new `custom` pattern + text field; digits map
  1=root, 2=third, 3=fifth, 4=octave, 5=fifth above the octave; invalid
  input fails with an actionable error.
- **Random arpeggio pattern**: new `random` pattern — one broken-chord
  figure is chosen deterministically per seed, so every auto-continued run
  gets a fresh figure while Retry stays reproducible.
- **Two-octave coverage** doubles the path; the auto-derived meter adjusts
  (e.g. updown two-octave = 13 notes → 4/4 with a rest fill).
- **Giuliani**: `pimami` figure corrected to 6 voices; new figures
  `pimai`, `pmia`, `pmim`; new **alternating bass** option (even bars voice
  the fifth as the bass — the original studies' thumb-jump feel).
- **Renderer**: `minWidthPerBar` for sixteenths raised 420 → 500 px
  (mobile clipping).

**Verification:** 193 unit tests green (`npx vitest run`), `tsc --noEmit`
clean, production build + deploy to `smt-beta`. A pattern×degree×coverage
sweep test guarantees every generated duration stays in the renderable set.
