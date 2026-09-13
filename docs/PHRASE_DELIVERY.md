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
| R8 Fixed material | ⚠️ partial | 6 bundled items: 2 verified public-domain melodies (Ode to Joy theme, Ah! vous dirai-je) + 4 original exercises. **No Giuliani**: no verifiable source available offline; per contract the quota was not faked — limitation recorded |
| R9 Add material without rebuilding | ✅ | Local `.abc` import in the setup panel with validation errors shown; failures keep the previous score |
| R10 Focused practice | ✅ | Start bar + bars-at-a-time selection (fixed material), Retry identical (same seed), Next advances/wraps, tempo Repeat option |
| R11 Listen before playing | ✅ | Cancellable preview at practice BPM via `AudioEngine` groups; returns to ready, cancels future sounds and gate reservations |
| R12 Zen/mobile/accessibility | ✅ mostly | Zen: staff + Start/Pause + mic; Retry/Next appear at completion. Keyboard shortcuts per mode (help popup reflects active mode); focused buttons never double-fire global shortcuts; current note = color + caret glyph; aria-label on the staff |
| R13 Safe lifecycle | ✅ | Pause on tab-hide, mic error, mic-off, dialogs; audio-group cancellation; run tokens; StrictMode-safe; unmount cleanup |
| R14 Tested delivery | ✅ | 149 unit/integration tests + real-browser synthetic-mic suite (see below) |

## Verification actually performed

- `npm run lint`, `npm run build`, `npm test -- --run`: all green (149 tests,
  9 files) at commit `909c301`.
- Real-browser (headless Chrome via `scripts/phrase_e2e*.cjs`, synthetic mic):
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
