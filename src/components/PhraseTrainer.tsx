/**
 * Phrase Mode main component (contracts D–F, H).
 *
 * Owns: material selection (generated melodies / scale drills / library /
 * local import), the practice-range selection, the setup panel, transport
 * controls, and the hint instruments. Playback state lives in usePhraseTrainer.
 *
 * Deviation from the contract (recorded): range conflicts for fixed material
 * show a warning and an explicit octave-shift control rather than blocking
 * the run; notes outside the playable range simply cannot be matched by mic.
 */
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { useSettings } from '../context/useSettings';
import { useAudioPlayer } from '../hooks/useAudioPlayer';
import { usePhraseTrainer, type PhraseTrainerApi, type PhrasePhase } from '../hooks/usePhraseTrainer';
import { getPhraseSettings, getPracticeFilter, type PhraseSettings, type PracticeFilter } from '../types/SettingsTypes';
import { rawFrameCount } from '../hooks/rawFrameBus';
import { audioEngine } from '../audio/AudioEngine';
import { computePlayableNotes, isFrettedInstrument, positionsWithinWindow, fretWindowNotes } from '../music/playableRange';
import { generateMelody } from '../music/melodyGenerator';
import { generateScaleDrill } from '../music/scaleDrills';
import { generateArpeggio, type ArpeggioDegree } from '../music/arpeggioGenerator';
import { isMode, type ModeId } from '../music/scales';
import { ARPEGGIO_DEGREE_LABELS } from '../music/arpeggioGenerator';
import { scoreEvents, type Result, type Score, type ScoreEvent } from '../score/model';
import { getNoteDetails } from '../music/NoteUtils';
import { EXERCISES, loadExercise } from '../exercises/library';
import { parseAbc } from '../exercises/abcParser';
import { PhraseSheetMusic } from './PhraseSheetMusic';
import { Fretboard } from './Fretboard';
import { PianoKeys } from './PianoKeys';
import { TUNINGS, getFretboardPositions } from '../music/Tunings';
import { INSTRUMENT_DEFINITIONS, resolveClefTranspose } from '../music/InstrumentConfigs';
const AUTO_CONTINUE_DELAY_MS = 1500;

import { Play, Pause, RotateCcw, SkipForward, Volume2, Square, ChevronDown, Music2, Upload, HelpCircle, Guitar } from 'lucide-react';

export interface PhraseHandle {
    pauseToggle: () => void;
    previewToggle: () => void;
    retry: () => void;
    skip: () => void;
    next: () => void;
    pause: () => void;
}

interface PhraseTrainerProps {
    listening: boolean;
    micError: string | null;
    windowWidth: number;
}

/** Shift a fixed score by whole octaves (explicit user action only). */
function shiftScoreOctaves(score: Score, octaves: number): Score {
    if (octaves === 0) return score;
    const events: ScoreEvent[] = scoreEvents(score).map((e, i) => {
        if (!e.pitch) return e;
        return {
            ...e,
            id: `os${i}`,
            pitch: { ...e.pitch, midi: e.pitch.midi + 12 * octaves, octave: e.pitch.octave + octaves },
        };
    });
    return { ...score, voices: [{ id: 'melody', events }] };
}

export const PhraseTrainer = forwardRef<PhraseHandle, PhraseTrainerProps>(
    function PhraseTrainer({ listening, micError, windowWidth }, ref) {
        const { settings, updateSettings } = useSettings();
        const setSettings = updateSettings;
        const { playNote } = useAudioPlayer();
        const phrase = getPhraseSettings(settings);
        // Unified target-note controls: Phrase Mode reads/writes the shared
        // practice filter so all modes expose identical key/fret-window state.
        const pf = getPracticeFilter(settings);
        phrase.keyTonic = pf.keyTonic;
        phrase.keyMode = pf.keyMode;
        phrase.fretWindowEnabled = pf.fretWindowEnabled;
        phrase.fretMin = pf.fretMin;
        phrase.fretMax = pf.fretMax;
        // Unified metronome: phrase tempo reads from the shared rhythm BPM
        // (single source of truth across modes; the phrase-local BPM control
        // was replaced by the common metronome widget in Controls).
        phrase.bpm = settings.rhythm.bpm;
        // "Sync to metronome": the phrase run IS the click source while it
        // plays (scheduler-driven, with count-in) — the metronome widget only
        // mirrors the beats visually and is muted in Phrase Mode, so clicks
        // can never double. The separate-click checkbox stays as an explicit
        // opt-in for a click even in "at your pace" mode.
        const metronomeActive = settings.rhythm.active;
        phrase.clickSound = phrase.pace === 'tempo' ? true : phrase.clickSound && metronomeActive;
        const setPhrase = useCallback((updates: Partial<PhraseSettings>) => {
            updateSettings(s => {
                const next = { ...s, phrase: { ...getPhraseSettings(s), ...updates } };
                // Mirror shared filter fields into the unified practice filter.
                const shared: Partial<PracticeFilter> = {};
                if ('keyTonic' in updates) shared.keyTonic = updates.keyTonic;
                if ('keyMode' in updates) shared.keyMode = updates.keyMode;
                if ('fretWindowEnabled' in updates) shared.fretWindowEnabled = updates.fretWindowEnabled;
                if ('fretMin' in updates) shared.fretMin = updates.fretMin;
                if ('fretMax' in updates) shared.fretMax = updates.fretMax;
                if (Object.keys(shared).length > 0) next.practice = { ...getPracticeFilter(s), ...shared };
                return next;
            });
        }, [updateSettings]);
        const currentInstrumentDef = INSTRUMENT_DEFINITIONS[settings.instrument];
        const currentTuning = TUNINGS[settings.tuningId];
        const fretted = isFrettedInstrument(settings.instrument) && !!currentTuning;

        // ---- Playable pool ----------------------------------------------------
        const pool = useMemo(() => {
            // Unified filter: strings ∩ fret window take precedence for fretted
            // instruments (same semantics as the single-note modes).
            if (fretted && currentTuning && (pf.strings.length > 0 || pf.fretWindowEnabled)) {
                const all = currentTuning.strings;
                const selected = pf.strings.length > 0
                    ? all.filter((_, i) => pf.strings.includes(i))
                    : all;
                if (selected.length > 0) {
                    if (pf.fretWindowEnabled) {
                        const lo = Math.max(0, Math.min(24, pf.fretMin));
                        const hi = Math.max(lo, Math.min(24, pf.fretMax));
                        return selected.flatMap(open => {
                            const notes: number[] = [];
                            for (let fret = lo; fret <= hi; fret++) notes.push(open + fret);
                            return notes;
                        }).sort((a, b) => a - b);
                    }
                    // Strings only: use their full range
                    const maxFret = Math.max(...all.map(open => {
                        let f = 0;
                        while (open + f <= 127) f++;
                        return Math.min(f - 1, 24);
                    }));
                    return selected.flatMap(open => {
                        const notes: number[] = [];
                        for (let fret = 0; fret <= maxFret; fret++) notes.push(open + fret);
                        return notes;
                    }).sort((a, b) => a - b);
                }
                return [];
            }
            if (phrase.fretWindowEnabled && fretted && currentTuning) {
                return fretWindowNotes(currentTuning, phrase.fretMin, phrase.fretMax);
            }
            return computePlayableNotes({
                instrumentId: settings.instrument,
                difficulty: settings.difficulty,
                tuningId: settings.tuningId,
                customMinFret: settings.customMinFret,
                customMaxFret: settings.customMaxFret,
            });
        }, [pf.strings, pf.fretWindowEnabled, pf.fretMin, pf.fretMax, fretted, currentTuning,
            phrase.fretWindowEnabled, phrase.fretMin, phrase.fretMax,
            settings.instrument, settings.difficulty, settings.tuningId, settings.customMinFret, settings.customMaxFret]);

        // ---- Imported score (session-only) --------------------------------------
        const [importedScore, setImportedScore] = useState<Score | null>(null);
        const [importError, setImportError] = useState<string | null>(null);
        const [octaveShift, setOctaveShift] = useState(0);
        const [melodySeed, setMelodySeed] = useState(() => Math.floor(Math.random() * 100000));
        const fileInputRef = useRef<HTMLInputElement>(null);
        const pendingAutoStart = useRef(false);

        const handleImportFile = useCallback((file: File) => {
            setImportError(null);
            if (file.size > 256 * 1024) {
                setImportError('File is larger than 256 KiB.');
                return;
            }
            file.text().then(text => {
                const result = parseAbc(text);
                if (result.ok) {
                    setImportedScore(result.value);
                    setOctaveShift(0);
                    setPhrase({ material: 'import', startBar: 1 });
                } else {
                    setImportError(result.error);
                }
            }).catch(() => setImportError('Could not read the file.'));
        }, [setPhrase]);

        // ---- Material score ----------------------------------------------------
        const baseScore: Result<Score> | null = useMemo(() => {
            if (phrase.material === 'melody') {
                const result = generateMelody({
                    keyTonic: phrase.keyTonic,
                    keyMode: (isMode(phrase.keyMode) ? phrase.keyMode : 'major') as ModeId,
                    bars: phrase.bars,
                    meter: { numerator: phrase.meterNumerator, denominator: 4 },
                    rhythmLevel: phrase.rhythmLevel,
                    seed: melodySeed,
                }, pool);
                return result.ok ? { ok: true as const, value: result.value.score } : result;
            }
            if (phrase.material === 'scale') {
                return generateScaleDrill({
                    keyTonic: phrase.keyTonic,
                    keyMode: (isMode(phrase.keyMode) ? phrase.keyMode : 'major') as ModeId,
                    direction: phrase.scaleDirection,
                    coverage: phrase.scaleCoverage,
                    meter: { numerator: phrase.meterNumerator, denominator: 4 },
                }, pool);
            }
            if (phrase.material === 'arpeggio') {
                return generateArpeggio({
                    keyTonic: phrase.keyTonic,
                    keyMode: (isMode(phrase.keyMode) ? phrase.keyMode : 'major') as ModeId,
                    degree: (phrase.arpeggioDegree as ArpeggioDegree) || 'I',
                    pattern: phrase.arpeggioPattern,
                    coverage: phrase.arpeggioCoverage,
                    meter: { numerator: phrase.meterNumerator, denominator: 4 },
                    bars: phrase.arpeggioBars,
                    progression: phrase.arpeggioProgression,
                    rhythm: phrase.arpeggioRhythm,
                    seed: melodySeed,
                }, pool);
            }
            if (phrase.material === 'library') {
                const id = phrase.libraryId || EXERCISES[0]?.id;
                if (!id) return { ok: false, error: 'No exercises available.' };
                return loadExercise(id);
            }
            if (phrase.material === 'import') {
                if (!importedScore) return { ok: false, error: 'No file imported yet — pick an .abc file in the setup panel.' };
                return { ok: true, value: importedScore };
            }
            return null;
        }, [phrase.material, phrase.keyTonic, phrase.keyMode, phrase.bars, phrase.meterNumerator,
            phrase.rhythmLevel, phrase.scaleDirection, phrase.scaleCoverage, phrase.libraryId,
            phrase.arpeggioDegree, phrase.arpeggioPattern, phrase.arpeggioCoverage,
            phrase.arpeggioBars, phrase.arpeggioProgression, phrase.arpeggioRhythm, melodySeed,
            melodySeed, pool, importedScore]);

        const fullScore: Result<Score> | null = useMemo(() => {
            if (!baseScore) return null;
            if (!baseScore.ok) return baseScore;
            if (octaveShift !== 0 && (phrase.material === 'library' || phrase.material === 'import')) {
                return { ok: true, value: shiftScoreOctaves(baseScore.value, octaveShift) };
            }
            return baseScore;
        }, [baseScore, octaveShift, phrase.material]);

        const fixedMaterial = phrase.material === 'library' || phrase.material === 'import';
        const scoreOk = !!fullScore && fullScore.ok;
        const selection = useMemo(() => ({
            startBar: fixedMaterial ? phrase.startBar : 1,
            barCount: fixedMaterial ? phrase.barCount : (fullScore && fullScore.ok ? fullScore.value.measures.length : 8),
        }), [fixedMaterial, phrase.startBar, phrase.barCount, fullScore]);

        const trainer: PhraseTrainerApi | null = usePhraseTrainer(
            fullScore && fullScore.ok ? fullScore.value : EMPTY_SCORE,
            selection,
            {
                pace: phrase.pace,
                bpm: phrase.bpm,
                clickSound: phrase.clickSound,
                inputMode: phrase.inputMode,
                previewVolume: settings.autoPlayVolume ?? 0.4,
                autoStartOnNote: phrase.autoStartOnNote,
            },
            listening,
            micError,
        );


        // Auto-continue: when a run finishes, keep practice flowing —
        // fixed material advances to the next section (wrapping), generated
        // melodies roll a new seed, scale drills restart. Tempo mode only.
        const prevPhaseRef = useRef<PhrasePhase>('ready');
        useEffect(() => {
            const was = prevPhaseRef.current;
            prevPhaseRef.current = trainer.phase;
            if (trainer.phase === 'done' && was !== 'done' && phrase.autoContinue && scoreOk && phrase.pace === 'tempo') {
                const material = phrase.material;
                const full = fullScore && fullScore.ok ? fullScore.value : null;
                if (material === 'scale') {
                    const timer = setTimeout(() => trainer.start(), AUTO_CONTINUE_DELAY_MS);
                    return () => clearTimeout(timer);
                }
                const timer = setTimeout(() => {
                    if (material === 'library' || material === 'import') {
                        if (!full) return;
                        const total = full.measures.length;
                        const nextStart = phrase.startBar + phrase.barCount;
                        pendingAutoStart.current = true;
                        setPhrase(nextStart > total ? { startBar: 1 } : { startBar: nextStart });
                    } else {
                        pendingAutoStart.current = true;
                        setMelodySeed(s => (s + 1) % 999983);
                    }
                }, AUTO_CONTINUE_DELAY_MS);
                return () => clearTimeout(timer);
            }
            // eslint-disable-next-line react-hooks/exhaustive-deps
        }, [trainer.phase, phrase.pace, phrase.autoContinue, phrase.material, phrase.startBar, phrase.barCount, scoreOk, fullScore, setPhrase]);

        // Auto-start after a structural change triggered by auto-continue.
        useEffect(() => {
            if (pendingAutoStart.current && trainer.phase === 'ready' && scoreOk) {
                pendingAutoStart.current = false;
                trainer.start();
            }
        });

        const materialError = fullScore && !fullScore.ok ? fullScore.error : null;

        // Range-conflict warning for fixed material.
        const rangeWarning = useMemo(() => {
            if (!scoreOk || !fixedMaterial) return null;
            const set = new Set(pool);
            const out = scoreEvents(fullScore!.value).filter(e => e.pitch && !set.has(e.pitch.midi));
            return out.length > 0
                ? `${out.length} of ${scoreEvents(fullScore!.value).length} notes are outside the current playable range — change the range, or use the octave control.`
                : null;
        }, [scoreOk, fixedMaterial, pool, fullScore]);

        const nextAction = useCallback(() => {
            if (phrase.material === 'melody' || (phrase.material === 'arpeggio' && phrase.arpeggioBars > 1)) {
                setMelodySeed(s => (s + 1) % 999983);
            } else if (fixedMaterial && scoreOk) {
                const total = fullScore!.value.measures.length;
                const nextStart = phrase.startBar + phrase.barCount;
                if (nextStart > total) {
                    setPhrase({ startBar: 1 }); // back to beginning
                } else {
                    setPhrase({ startBar: nextStart });
                }
            }
        }, [phrase.material, phrase.startBar, phrase.barCount, fixedMaterial, scoreOk, fullScore, setPhrase]);

        // ---- Ref API -----------------------------------------------------------
        useImperativeHandle(ref, () => ({
            pauseToggle: () => trainer?.pauseToggle(),
            previewToggle: () => trainer?.previewToggle(),
            retry: () => trainer?.retry(),
            skip: () => trainer?.skip(),
            pause: () => trainer?.pause(),
            next: () => nextAction(),
        }));

        // ---- Hints --------------------------------------------------------------
        const activeScore = trainer.activeScore;
        const events = scoreEvents(activeScore);
        const currentMidi = trainer.currentIdx >= 0 && events[trainer.currentIdx]?.pitch
            ? events[trainer.currentIdx]!.pitch!.midi
            : null;

        const hintPositions = useMemo(() => {
            if (!settings.showHint || !currentInstrumentDef.showTuning || !currentTuning || currentMidi === null) return [];
            if (phrase.fretWindowEnabled) {
                return positionsWithinWindow(currentMidi, currentTuning, phrase.fretMin, phrase.fretMax);
            }
            return getFretboardPositions(currentMidi, currentTuning);
        }, [settings.showHint, currentInstrumentDef, currentTuning, currentMidi, phrase.fretWindowEnabled, phrase.fretMin, phrase.fretMax]);

        const handleVirtualPlay = useCallback((midi: number) => {
            if (!settings.virtualGuitarMute) {
                playNote(midi, 0.5, settings.virtualGuitarVolume ?? 0.5);
            }
            trainer?.virtualTap(midi);
        }, [settings.virtualGuitarMute, settings.virtualGuitarVolume, playNote, trainer]);

        const [hoveredMidi, setHoveredMidi] = useState<number | null>(null); // accepted by Fretboard/PianoKeys; phrase renderer has no hover preview
        void hoveredMidi;

        // Shared clef/transpose resolution (single-note mode uses the same).
        const { clef: activeClef, transpose: activeTranspose } = useMemo(() =>
            resolveClefTranspose(currentInstrumentDef, settings.difficulty),
        [currentInstrumentDef, settings.difficulty]);

        // ---- Status line ----------------------------------------------------------
        const statusText = useMemo(() => {
            if (!scoreOk) return materialError ?? 'No material.';
            const p = trainer.phase;
            if (p === 'preview') return 'Listen …';
            if (p === 'countIn') return `Count-in: ${trainer.countInLeft}`;
            if (p === 'paused') return 'Paused';
            if (p === 'done') {
                if (phrase.pace === 'tempo') return `Matched ${trainer.summary.matched} of ${trainer.summary.total} notes`;
                return `Completed ${trainer.summary.total} notes, skipped ${trainer.summary.skipped}`;
            }
            if (p === 'playing') {
                if (phrase.pace === 'tempo') return `${trainer.summary.matched} matched · ${trainer.summary.missed + trainer.summary.skipped} missed`;
                if (trainer.repeatedNoteBlocked) return 'Same note again — release, then strike it once more';
                return 'Play the highlighted note';
            }
            return phrase.pace === 'tempo' ? 'Press start — one bar of count-in, then play in time.' : 'Press start, then play the highlighted notes.';
        }, [scoreOk, materialError, trainer.phase, trainer.countInLeft, trainer.summary, phrase.pace, trainer.repeatedNoteBlocked]);

        const startLabel = useMemo(() => {
            const p = trainer.phase;
            if (p === 'playing' || p === 'countIn') return 'Pause';
            if (p === 'paused') return 'Resume';
            if (p === 'preview') return 'Stop preview';
            return 'Start';
        }, [trainer.phase]);

        const startAction = useMemo(() => {
            if (trainer.phase === 'preview') return trainer.previewToggle;
            return trainer.pauseToggle;
        }, [trainer]);

        const staffWidth = Math.min(windowWidth - 40, 860);

        // Debug hook for real-browser QA (enable with localStorage.phraseDebug = '1')
        useEffect(() => {
            if (typeof window === 'undefined') return;
            const w = window as unknown as { __phraseDebug?: unknown };
            if (localStorage.getItem('phraseDebug') === '1') {
                w.__phraseDebug = () => ({
                    frames: rawFrameCount(),
                    audioNow: audioEngine.now(),
                    scoreStart: trainer.scoreStart,
                    spb: trainer.spb,
                    micGate: audioEngine.isAudible(),
                    micBlanked: audioEngine.isMicBlanked(),
                    phase: trainer.phase,
                    currentIdx: trainer.currentIdx,
                    statuses: [...trainer.statuses],
                    summary: trainer.summary,
                    pool: [...pool],
                    firstNote: events[0]?.pitch?.midi ?? null,
                    scoreOk,
                    material: phrase.material,
                    midis: events.map(e => (e.pitch ? e.pitch.midi : null)),
                });
            } else {
                delete w.__phraseDebug;
            }
        });

        // ---- Render ---------------------------------------------------------------
        return (
            <div className={`card sheet-music-card phrase-card ${(settings.showHint || settings.showFretboard) ? 'has-hint' : ''}`}>
                <div className="phrase-title-row">
                    <Music2 size={18} />
                    <span className="phrase-title">
                        {scoreOk ? fullScore!.value.title : 'Phrase Mode'}
                        {fixedMaterial && scoreOk && (
                            <span className="phrase-range">
                                {' '}— bars {selection.startBar}–{Math.min(selection.startBar + selection.barCount - 1, fullScore!.value.measures.length)}
                            </span>
                        )}
                    </span>
                </div>

                <div className="sheet-music-container">
                    {scoreOk ? (
                        <PhraseSheetMusic
                            score={trainer.activeScore}
                            currentIdx={trainer.currentIdx}
                            statuses={trainer.statuses}
                            clef={activeClef}
                            transpose={activeTranspose}
                            width={staffWidth}
                            theme={settings.theme}
                        />
                    ) : (
                        <div className="phrase-error">{materialError}</div>
                    )}
                </div>

                {trainer.error && <div className="error-message">{trainer.error}</div>}
                {importError && <div className="error-message">{importError}</div>}
                {rangeWarning && <div className="phrase-warning">{rangeWarning}</div>}

                <div className="feedback-area">
                    {trainer.phase === 'countIn' && (
                        <span
                            className="phrase-countin"
                            style={{
                                display: 'inline-block',
                                minWidth: '20px',
                                padding: '1px 7px',
                                marginRight: '8px',
                                borderRadius: '10px',
                                fontSize: '11px',
                                opacity: 0.75,
                                background: 'color-mix(in srgb, var(--color-text-main) 10%, transparent)',
                            }}
                            aria-label={`Count-in: ${trainer.countInLeft} beats left`}
                        >{trainer.countInLeft}</span>
                    )}
                    <div className="instruction-text phrase-status">{statusText}</div>
                </div>

                {/* Transport — reuses the single-note button styles/behavior */}
                <div className="action-row phrase-transport">
                    <button className="skip-button" onClick={startAction} title="Start / Pause (Space)">
                        {trainer.phase === 'playing' || trainer.phase === 'countIn' ? <Pause size={18} /> : <Play size={18} />}
                        {startLabel}
                    </button>
                    {!settings.zenMode && (
                        <>
                            <button
                                className="hint-button"
                                onClick={trainer.previewToggle}
                                title="Preview the phrase (P)"
                            >
                                {trainer.phase === 'preview' ? <Square size={18} /> : <Volume2 size={18} />}
                                {trainer.phase === 'preview' ? 'Stop' : 'Preview'}
                            </button>
                            <button className="hint-button" onClick={trainer.retry} title="Retry from the start (R)">
                                <RotateCcw size={18} />
                                Retry
                            </button>
                            {(phrase.material === 'melody' || phrase.material === 'arpeggio' || fixedMaterial) && (
                                <button className="hint-button" onClick={nextAction} title="New melody / next bars (N)">
                                    <SkipForward size={18} />
                                    {phrase.material === 'melody' ? 'New' : 'Next'}
                                </button>
                            )}
                            {phrase.pace === 'step' && (
                                <button className="hint-button" onClick={trainer.skip} title="Skip this note (S)">
                                    <SkipForward size={18} />
                                    Skip
                                </button>
                            )}
                        </>
                    )}
                    {/* Same virtual-instrument / hint toggles as single-note mode */}
                    {trainer.phase === 'done' && settings.zenMode && (
                        <>
                            <button className="hint-button" onClick={trainer.retry} title="Retry (R)">
                                <RotateCcw size={18} />
                                Retry
                            </button>
                            {(phrase.material === 'melody' || phrase.material === 'arpeggio' || fixedMaterial) && (
                                <button className="hint-button" onClick={nextAction} title="New / Next (N)">
                                    <SkipForward size={18} />
                                    {phrase.material === 'melody' ? 'New' : 'Next'}
                                </button>
                            )}
                        </>
                    )}
                    {!settings.zenMode && currentInstrumentDef.showTuning && (
                        <button
                            className={`hint-button ${settings.showFretboard ? 'active' : ''}`}
                            onClick={() => setSettings(s => ({ ...s, showFretboard: !s.showFretboard }))}
                            title={`Toggle Virtual ${currentInstrumentDef.displayName} (Keyboard Shortcut: V)`}
                        >
                            <Guitar size={18} />
                            {currentInstrumentDef.id === 'piano' ? 'Piano' : 'Guitar'}
                        </button>
                    )}
                    {!settings.zenMode && (
                        <button
                            className={`hint-button ${settings.showHint ? 'active' : ''}`}
                            onClick={() => setSettings(s => ({ ...s, showHint: !s.showHint }))}
                            title="Keyboard Shortcut: H"
                        >
                            <HelpCircle size={18} />
                            {settings.showHint ? "Hide Hint" : "Show Hint"}
                        </button>
                    )}
                </div>

                {/* Setup panel */}
                {!settings.zenMode && (
                    <details className="phrase-setup">
                        <summary><ChevronDown size={16} /> Setup</summary>
                        <div className="phrase-setup-grid">
                            <label>Material
                                <select value={phrase.material} onChange={e => setPhrase({ material: e.target.value as PhraseSettings['material'] })}>
                                    <option value="melody">Melodies (generated)</option>
                                    <option value="scale">Scale drills</option>
                                    <option value="arpeggio">Arpeggios (generated)</option>
                                    <option value="library">Exercises</option>
                                    <option value="import">Imported file</option>
                                </select>
                            </label>

                            {(phrase.material === 'melody' || phrase.material === 'scale' || phrase.material === 'arpeggio') && (
                                <span style={{ fontSize: '11px', opacity: 0.7, alignSelf: 'center' }}>
                                    Key/mode: use the "Target key" controls below the sheet — shared across modes.
                                </span>
                            )}

                            {phrase.material === 'melody' && (
                                <>
                                    <label>Bars
                                        <select value={phrase.bars} onChange={e => setPhrase({ bars: Number(e.target.value) })}>
                                            {[1, 2, 3, 4, 6, 8].map(b => <option key={b} value={b}>{b}</option>)}
                                        </select>
                                    </label>
                                    <label>Meter
                                        <select value={phrase.meterNumerator} onChange={e => setPhrase({ meterNumerator: Number(e.target.value) === 3 ? 3 : 4 })}>
                                            <option value={4}>4/4</option>
                                            <option value={3}>3/4</option>
                                        </select>
                                    </label>
                                    <label>Rhythm
                                        <select value={phrase.rhythmLevel} onChange={e => setPhrase({ rhythmLevel: Math.max(1, Math.min(3, Number(e.target.value))) as 1 | 2 | 3 })}>
                                            <option value={1}>Simple</option>
                                            <option value={2}>Mixed</option>
                                            <option value={3}>Elaborate (16ths)</option>
                                        </select>
                                    </label>
                                </>
                            )}

                            {phrase.material === 'scale' && (
                                <>
                                    <label>Coverage
                                        <select value={phrase.scaleCoverage} onChange={e => setPhrase({ scaleCoverage: e.target.value as PhraseSettings['scaleCoverage'] })}>
                                            <option value="one-octave">One octave</option>
                                            <option value="two-octave">Two octaves</option>
                                            <option value="position">Within position</option>
                                        </select>
                                    </label>
                                    <label>Direction
                                        <select value={phrase.scaleDirection} onChange={e => setPhrase({ scaleDirection: e.target.value as PhraseSettings['scaleDirection'] })}>
                                            <option value="up">Up</option>
                                            <option value="down">Down</option>
                                            <option value="updown">Up &amp; down</option>
                                        </select>
                                    </label>
                                    <label>Meter
                                        <select value={phrase.meterNumerator} onChange={e => setPhrase({ meterNumerator: Number(e.target.value) === 3 ? 3 : 4 })}>
                                            <option value={4}>4/4</option>
                                            <option value={3}>3/4</option>
                                        </select>
                                    </label>
                                </>
                            )}

                            {phrase.material === 'arpeggio' && (
                                <>
                                    <label>Chord
                                        <select value={phrase.arpeggioDegree} onChange={e => setPhrase({ arpeggioDegree: e.target.value, arpeggioBars: 1 })}>
                                            {(Object.keys(ARPEGGIO_DEGREE_LABELS) as ArpeggioDegree[]).map(d => (
                                                <option key={d} value={d}>{ARPEGGIO_DEGREE_LABELS[d]}</option>
                                            ))}
                                        </select>
                                    </label>
                                    <label>Pattern
                                        <select value={phrase.arpeggioPattern} onChange={e => setPhrase({ arpeggioPattern: e.target.value as PhraseSettings['arpeggioPattern'] })}>
                                            <option value="up">Up</option>
                                            <option value="down">Down</option>
                                            <option value="updown">Up &amp; down</option>
                                            <option value="1235">1-2-3-5</option>
                                        </select>
                                    </label>
                                    <label>Coverage
                                        <select value={phrase.arpeggioCoverage} onChange={e => setPhrase({ arpeggioCoverage: e.target.value as PhraseSettings['arpeggioCoverage'] })}>
                                            <option value="one-octave">One octave</option>
                                            <option value="two-octave">Two octaves</option>
                                        </select>
                                    </label>
                                    <label>Length
                                        <select value={phrase.arpeggioBars} onChange={e => setPhrase({ arpeggioBars: Math.max(1, Math.min(8, Number(e.target.value))) })}>
                                            {[1, 2, 4, 6, 8].map(b => <option key={b} value={b}>{b === 1 ? 'Single chord' : `${b} bars`}</option>)}
                                        </select>
                                    </label>
                                    {phrase.arpeggioBars > 1 && (
                                        <label>Chords
                                            <select value={phrase.arpeggioProgression} onChange={e => setPhrase({ arpeggioProgression: e.target.value as PhraseSettings['arpeggioProgression'] })}>
                                                <option value="functional">Functional (I-IV-V...)</option>
                                                <option value="diatonic-cycle">Diatonic cycle</option>
                                                <option value="random">Random</option>
                                            </select>
                                        </label>
                                    )}
                                    <label>Rhythm
                                        <select value={phrase.arpeggioRhythm} onChange={e => setPhrase({ arpeggioRhythm: e.target.value as PhraseSettings['arpeggioRhythm'] })}>
                                            <option value="quarters">Quarter notes</option>
                                            <option value="eighths">Eighth notes</option>
                                        </select>
                                    </label>
                                    <label>Meter
                                        <select value={phrase.meterNumerator} onChange={e => setPhrase({ meterNumerator: Number(e.target.value) === 3 ? 3 : 4 })}>
                                            <option value={4}>4/4</option>
                                            <option value={3}>3/4</option>
                                        </select>
                                    </label>
                                </>
                            )}

                            {phrase.material === 'library' && (
                                <label>Exercise
                                    <select value={phrase.libraryId || EXERCISES[0].id} onChange={e => setPhrase({ libraryId: e.target.value, startBar: 1 })}>
                                        {EXERCISES.map(ex => (
                                            <option key={ex.id} value={ex.id}>{ex.label} ({ex.level})</option>
                                        ))}
                                    </select>
                                </label>
                            )}

                            {fixedMaterial && scoreOk && (
                                <>
                                    <label>Start bar
                                        <select value={phrase.startBar} onChange={e => setPhrase({ startBar: Number(e.target.value) })}>
                                            {Array.from({ length: fullScore!.value.measures.length }, (_, i) => i + 1).map(b => (
                                                <option key={b} value={b}>{b}</option>
                                            ))}
                                        </select>
                                    </label>
                                    <label>Bars at a time
                                        <select value={phrase.barCount} onChange={e => setPhrase({ barCount: Number(e.target.value) })}>
                                            {[1, 2, 4, 6, 8].map(b => <option key={b} value={b}>{b}</option>)}
                                        </select>
                                    </label>
                                    <label>Transpose
                                        <select value={octaveShift} onChange={e => setOctaveShift(Number(e.target.value))}>
                                            <option value={-2}>-2 oct</option>
                                            <option value={-1}>-1 oct</option>
                                            <option value={0}>0</option>
                                            <option value={1}>+1 oct</option>
                                            <option value={2}>+2 oct</option>
                                        </select>
                                    </label>
                                </>
                            )}

                            {phrase.material === 'import' && (
                                <label>File
                                    <button className="hint-button" onClick={() => fileInputRef.current?.click()}>
                                        <Upload size={16} /> Choose .abc file
                                    </button>
                                    <input
                                        ref={fileInputRef}
                                        type="file"
                                        accept=".abc,.txt"
                                        style={{ display: 'none' }}
                                        onChange={e => { const f = e.target.files?.[0]; if (f) handleImportFile(f); e.target.value = ''; }}
                                    />
                                </label>
                            )}

                            {fretted && (
                                <span style={{ fontSize: '11px', opacity: 0.7, alignSelf: 'center' }}>
                                    Fret window: use the "Fret window" controls below the sheet — shared across modes.
                                </span>
                            )}

                            <label>Pace
                                <select
                                    value={phrase.pace}
                                    onChange={e => {
                                        const pace = e.target.value as PhraseSettings['pace'];
                                        setPhrase({ pace });
                                        // "Sync to metronome" only makes sense with the
                                        // metronome running — switch it on automatically.
                                        if (pace === 'tempo' && !settings.rhythm.active) {
                                            setSettings(s => ({ ...s, rhythm: { ...s.rhythm, active: true } }));
                                        }
                                    }}
                                >
                                    <option value="step">At your pace</option>
                                    <option value="tempo">Sync to metronome</option>
                                </select>
                            </label>
                            {phrase.pace === 'tempo' && (
                                <span style={{ fontSize: '11px', opacity: 0.7, alignSelf: 'center' }}>
                                    Tempo (BPM): set it on the metronome in the tools below — shared across modes.
                                </span>
                            )}
                            <label className="phrase-check">
                                <input
                                    type="checkbox"
                                    checked={phrase.inputMode === 'virtual'}
                                    onChange={e => setPhrase({ inputMode: e.target.checked ? 'virtual' : 'mic' })}
                                />
                                Virtual input only
                            </label>
                            {phrase.pace === 'tempo' && (
                                <span style={{ fontSize: '11px', opacity: 0.7, alignSelf: 'center' }}>
                                    Clicks come from the run (with count-in); the metronome widget mirrors the beats.
                                </span>
                            )}
                            {phrase.pace === 'step' && (
                                <label className="phrase-check">
                                    <input
                                        type="checkbox"
                                        checked={phrase.clickSound}
                                        onChange={e => setPhrase({ clickSound: e.target.checked })}
                                    />
                                    Metronome click while practicing (requires metronome on)
                                </label>
                            )}
                            <label className="phrase-check">
                                <input
                                    type="checkbox"
                                    checked={phrase.autoContinue}
                                    onChange={e => setPhrase({ autoContinue: e.target.checked })}
                                />
                                Auto-continue
                            </label>
                            <label className="phrase-check">
                                <input
                                    type="checkbox"
                                    checked={phrase.autoStartOnNote}
                                    onChange={e => setPhrase({ autoStartOnNote: e.target.checked })}
                                />
                                Start on first note (no count-in)
                            </label>
                        </div>
                        {phrase.pace === 'tempo' && (
                            <p className="phrase-note">The run clicks a full count-in bar, then one click per beat. The metronome pendulum mirrors these beats — set the tempo on the metronome tool.</p>
                        )}
                        <p className="phrase-note">
                            Matching checks pitch, not fingering — several fretboard positions produce the same pitch.
                            For repeated identical notes, briefly release between notes so each attack is detected.
                        </p>
                    </details>
                )}

                {/* Hint instruments */}
                {(settings.showHint || settings.showFretboard) && currentInstrumentDef.showTuning && (
                    <div className="hint-card">
                        {settings.showHint && currentMidi !== null && (
                            <div className="hint-note landscape-hint-note">
                                {getNoteDetails(currentMidi + activeTranspose).scientific}
                            </div>
                        )}
                        {currentInstrumentDef.id === 'piano' ? (
                            <PianoKeys
                                minMidi={36}
                                maxMidi={84}
                                markedNotes={settings.showHint && currentMidi !== null ? [currentMidi] : []}
                                interactive={settings.showFretboard || settings.showHint}
                                showTooltips={settings.showHint}
                                displayTranspose={activeTranspose}
                                onPlayNote={handleVirtualPlay}
                                onHover={setHoveredMidi}
                            />
                        ) : (
                            currentTuning && (
                                <Fretboard
                                    tuning={currentTuning}
                                    positions={hintPositions}
                                    interactive={settings.showFretboard || settings.showHint}
                                    showTooltips={settings.showHint}
                                    displayTranspose={activeTranspose}
                                    onPlayNote={handleVirtualPlay}
                                    onHover={setHoveredMidi}
                                    showHints={settings.showHint}
                                    maxFrets={Math.max(15, phrase.fretWindowEnabled ? phrase.fretMax + 1 : 0)}
                                />
                            )
                        )}
                    </div>
                )}

                {phrase.material === 'import' && importedScore && !importError && (
                    <p className="phrase-note">Imported “{importedScore.title}” — this stays in this browser tab only.</p>
                )}
            </div>
        );
    }
);

const EMPTY_SCORE: Score = {
    version: 1,
    id: 'empty',
    title: '',
    meter: { numerator: 4, denominator: 4 },
    key: { tonic: 'C', mode: 'major', signature: 'C' },
    measures: [],
    voices: [{ id: 'melody', events: [] }],
};

export default PhraseTrainer;
