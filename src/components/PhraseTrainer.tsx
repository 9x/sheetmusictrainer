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
import { usePhraseTrainer, type PhraseTrainerApi } from '../hooks/usePhraseTrainer';
import { getPhraseSettings, type PhraseSettings } from '../types/SettingsTypes';
import { rawFrameCount } from '../hooks/rawFrameBus';
import { audioEngine } from '../audio/AudioEngine';
import { computePlayableNotes, isFrettedInstrument, positionsWithinWindow, fretWindowNotes } from '../music/playableRange';
import { generateMelody } from '../music/melodyGenerator';
import { generateScaleDrill } from '../music/scaleDrills';
import { isMode, MODE_LABELS, TONICS, type ModeId } from '../music/scales';
import { scoreEvents, type Result, type Score, type ScoreEvent } from '../score/model';
import { getNoteDetails } from '../music/NoteUtils';
import { EXERCISES, loadExercise } from '../exercises/library';
import { parseAbc } from '../exercises/abcParser';
import { PhraseSheetMusic } from './PhraseSheetMusic';
import { Fretboard } from './Fretboard';
import { PianoKeys } from './PianoKeys';
import { TUNINGS, getFretboardPositions } from '../music/Tunings';
import { INSTRUMENT_DEFINITIONS, resolveClefTranspose } from '../music/InstrumentConfigs';
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
        const setPhrase = useCallback((updates: Partial<PhraseSettings>) => {
            updateSettings(s => ({ ...s, phrase: { ...getPhraseSettings(s), ...updates } }));
        }, [updateSettings]);

        const currentInstrumentDef = INSTRUMENT_DEFINITIONS[settings.instrument];
        const currentTuning = TUNINGS[settings.tuningId];
        const fretted = isFrettedInstrument(settings.instrument) && !!currentTuning;

        // ---- Playable pool ----------------------------------------------------
        const pool = useMemo(() => {
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
        }, [phrase.fretWindowEnabled, phrase.fretMin, phrase.fretMax, fretted, currentTuning,
            settings.instrument, settings.difficulty, settings.tuningId, settings.customMinFret, settings.customMaxFret]);

        // ---- Imported score (session-only) --------------------------------------
        const [importedScore, setImportedScore] = useState<Score | null>(null);
        const [importError, setImportError] = useState<string | null>(null);
        const [octaveShift, setOctaveShift] = useState(0);
        const [melodySeed, setMelodySeed] = useState(() => Math.floor(Math.random() * 100000));
        const fileInputRef = useRef<HTMLInputElement>(null);

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
                repeat: phrase.repeat,
                inputMode: phrase.inputMode,
                previewVolume: settings.autoPlayVolume ?? 0.4,
            },
            listening,
            micError,
        );

        const materialError = fullScore && !fullScore.ok ? fullScore.error : null;
        const scoreOk = !!fullScore && fullScore.ok;

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
            if (phrase.material === 'melody') {
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
        }, [scoreOk, materialError, trainer.phase, trainer.countInLeft, trainer.summary, phrase.pace]);

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
                            {(phrase.material === 'melody' || fixedMaterial) && (
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
                            {(phrase.material === 'melody' || fixedMaterial) && (
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
                                    <option value="library">Exercises</option>
                                    <option value="import">Imported file</option>
                                </select>
                            </label>

                            {(phrase.material === 'melody' || phrase.material === 'scale') && (
                                <>
                                    <label>Key
                                        <select value={phrase.keyTonic} onChange={e => setPhrase({ keyTonic: e.target.value })}>
                                            {Object.keys(TONICS).filter(t => !['C#', 'Gb', 'D#', 'G#', 'A#'].includes(t)).map(t => (
                                                <option key={t} value={t}>{t}</option>
                                            ))}
                                        </select>
                                    </label>
                                    <label>Mode
                                        <select value={phrase.keyMode} onChange={e => setPhrase({ keyMode: e.target.value })}>
                                            {(Object.keys(MODE_LABELS) as ModeId[]).map(m => (
                                                <option key={m} value={m}>{MODE_LABELS[m]}</option>
                                            ))}
                                        </select>
                                    </label>
                                </>
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
                                        <select value={phrase.rhythmLevel} onChange={e => setPhrase({ rhythmLevel: Number(e.target.value) === 2 ? 2 : 1 })}>
                                            <option value={1}>Simple</option>
                                            <option value={2}>Mixed</option>
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
                                    <label>Octave
                                        <select value={octaveShift} onChange={e => setOctaveShift(Number(e.target.value))}>
                                            <option value={-1}>-1</option>
                                            <option value={0}>0</option>
                                            <option value={1}>+1</option>
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
                                <>
                                    <label className="phrase-check">
                                        <input
                                            type="checkbox"
                                            checked={phrase.fretWindowEnabled}
                                            onChange={e => setPhrase({ fretWindowEnabled: e.target.checked })}
                                        />
                                        Fret window
                                    </label>
                                    {phrase.fretWindowEnabled && (
                                        <>
                                            <label>Min fret
                                                <input type="number" min={0} max={24} value={phrase.fretMin}
                                                    onChange={e => setPhrase({ fretMin: Math.max(0, Math.min(24, parseInt(e.target.value) || 0)) })} />
                                            </label>
                                            <label>Max fret
                                                <input type="number" min={0} max={24} value={phrase.fretMax}
                                                    onChange={e => setPhrase({ fretMax: Math.max(0, Math.min(24, parseInt(e.target.value) || 0)) })} />
                                            </label>
                                        </>
                                    )}
                                </>
                            )}

                            <label>Pace
                                <select value={phrase.pace} onChange={e => setPhrase({ pace: e.target.value as PhraseSettings['pace'] })}>
                                    <option value="step">At your pace</option>
                                    <option value="tempo">With tempo</option>
                                </select>
                            </label>
                            {phrase.pace === 'tempo' && (
                                <label>BPM
                                    <input
                                        type="number"
                                        min={30}
                                        max={180}
                                        value={phrase.bpm}
                                        onChange={e => setPhrase({ bpm: Math.max(30, Math.min(180, parseInt(e.target.value) || 60)) })}
                                    />
                                </label>
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
                                <label className="phrase-check">
                                    <input
                                        type="checkbox"
                                        checked={phrase.clickSound}
                                        onChange={e => setPhrase({ clickSound: e.target.checked })}
                                    />
                                    Click sound
                                </label>
                            )}
                            {phrase.pace === 'tempo' && (
                                <label className="phrase-check">
                                    <input
                                        type="checkbox"
                                        checked={phrase.repeat}
                                        onChange={e => setPhrase({ repeat: e.target.checked })}
                                    />
                                    Repeat automatically
                                </label>
                            )}
                        </div>
                        {phrase.pace === 'tempo' && phrase.clickSound && (
                            <p className="phrase-note">Clicks are short noise bursts, not pitched tones — but speaker bleed can still disturb the microphone. Headphones recommended.</p>
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
