/**
 * The original single-note experience (Sight Reading / Ear Training),
 * extracted from App so its game-logic effects unmount entirely while
 * Phrase Mode is active (contract: "no background scoring after leaving
 * the mode" — hiding the UI alone would keep useGameLogic running).
 */
import { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from 'react';
import { SheetMusic } from './SheetMusic';
import { useSettings } from '../context/useSettings';
import { useAudioPlayer } from '../hooks/useAudioPlayer';
import { useGameLogic } from '../hooks/useGameLogic';
import { getNoteDetails } from '../music/NoteUtils';
import { TUNINGS, getFretboardPositions } from '../music/Tunings';
import { INSTRUMENT_DEFINITIONS } from '../music/InstrumentConfigs';
import { Fretboard } from './Fretboard';
import { PianoKeys } from './PianoKeys';
import { audioEngine } from '../audio/AudioEngine';
import { Guitar, HelpCircle, Volume2, SkipForward } from 'lucide-react';

export interface SingleNoteHandle {
    skipNote: () => void;
    playCurrent: () => void;
}

interface SingleNoteTrainerProps {
    /** Raw detection (gating for display happens inside). */
    pitchData: { midi: number; note: string; cents: number; frequency: number } | null;
    windowWidth: number;
    windowHeight: number;
    onSetHoveredMidi?: (midi: number | null) => void;
}

export const SingleNoteTrainer = forwardRef<SingleNoteHandle, SingleNoteTrainerProps>(
    function SingleNoteTrainer({ pitchData, windowWidth, windowHeight, onSetHoveredMidi }, ref) {
        const { settings, updateSettings } = useSettings();
        const setSettings = updateSettings;
        const { playNote } = useAudioPlayer();

        const currentTuning = TUNINGS[settings.tuningId];
        const currentInstrumentDef = INSTRUMENT_DEFINITIONS[settings.instrument];

        const {
            targetMidi,
            feedbackMessage,
            revealed,
            virtualNote,
            generateNewNote,
            handleVirtualInstrumentPlay
        } = useGameLogic(pitchData);

        useImperativeHandle(ref, () => ({
            skipNote: () => generateNewNote(),
            playCurrent: () => playNote(targetMidi, settings.referenceNoteDuration ?? 1.5, settings.autoPlayVolume ?? 0.5),
        }), [generateNewNote, playNote, targetMidi, settings.referenceNoteDuration, settings.autoPlayVolume]);

        const [hoveredMidi, setHoveredMidi] = useState<number | null>(null);
        useEffect(() => { onSetHoveredMidi?.(hoveredMidi); }, [hoveredMidi, onSetHoveredMidi]);

        // Mic feedback is gated while the app's speaker output is audible.
        const displayedPitch = audioEngine.isAudible() ? null : pitchData;

        const currentRangeDef = useMemo(() =>
            currentInstrumentDef.ranges.find(r => r.id === settings.difficulty),
        [currentInstrumentDef, settings.difficulty]);
        const activeClef = currentRangeDef?.clef ?? currentInstrumentDef.clefMode;
        const activeTranspose = currentRangeDef?.transpose ?? currentInstrumentDef.transpose;

        const hintPositions = useMemo(() => {
            if (!settings.showHint || !currentInstrumentDef.showTuning || !currentTuning) return [];
            return getFretboardPositions(targetMidi, currentTuning);
        }, [settings.showHint, targetMidi, currentInstrumentDef, currentTuning]);

        return (
            <div className={`card sheet-music-card ${(settings.showHint || settings.showFretboard) ? 'has-hint' : ''} ${settings.zenMode ? 'zen-mode' : ''}`}>
                <div className="sheet-music-container">
                    <SheetMusic
                        targetMidi={targetMidi}
                        playedMidi={virtualNote ?? displayedPitch?.midi}
                        keySignature={settings.keySignature}
                        clef={activeClef}
                        transpose={activeTranspose}
                        width={Math.min(windowWidth - 40, 500)}
                        height={
                            activeClef === 'grand'
                                ? (windowHeight < 500 ? 190 : 260)
                                : (windowHeight < 500 ? 120 : 180)
                        }
                        hideTargetNote={settings.gameMode === 'ear_training' && !revealed}
                        hoverMidi={settings.showHint ? hoveredMidi : null}
                        theme={settings.theme}
                    />
                </div>

                {!settings.zenMode && (
                    <div className="feedback-area">
                        {feedbackMessage ? (
                            <div key={feedbackMessage} className="success-message animate-pop">
                                {feedbackMessage.startsWith("Good! ") ? (
                                    <>
                                        <div className="success-prefix">Good!</div>
                                        <div className="success-note">{feedbackMessage.replace("Good! ", "")}</div>
                                    </>
                                ) : (
                                    feedbackMessage
                                )}
                            </div>
                        ) : (
                            <div className="instruction-text">
                                {settings.gameMode === 'ear_training' ? "Listen and play the note" : "Play the note above"}
                            </div>
                        )}
                    </div>
                )}

                {(settings.showHint || settings.showFretboard) && (
                    <div className="hint-card">
                        {settings.showHint && (
                            <div className="hint-note landscape-hint-note">
                                {getNoteDetails(targetMidi + activeTranspose).scientific}
                            </div>
                        )}
                        {currentInstrumentDef.showTuning && (
                            currentInstrumentDef.id === 'piano' ? (
                                <PianoKeys
                                    minMidi={36}
                                    maxMidi={84}
                                    markedNotes={settings.showHint ? [targetMidi] : []}
                                    interactive={settings.showFretboard || settings.showHint}
                                    showTooltips={settings.showHint}
                                    displayTranspose={activeTranspose}
                                    onPlayNote={handleVirtualInstrumentPlay}
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
                                        onPlayNote={handleVirtualInstrumentPlay}
                                        onHover={setHoveredMidi}
                                        showHints={settings.showHint}
                                        maxFrets={15}
                                    />
                                )
                            )
                        )}
                    </div>
                )}

                {!settings.zenMode && (
                    <div className="action-row" style={{ marginTop: '24px', display: 'flex', justifyContent: 'center', gap: '16px' }}>
                        {currentInstrumentDef.showTuning && (
                            <button
                                className={`hint-button ${settings.showFretboard ? 'active' : ''}`}
                                onClick={() => setSettings(s => ({ ...s, showFretboard: !s.showFretboard }))}
                                title={`Toggle Virtual ${currentInstrumentDef.displayName} (Keyboard Shortcut: V)`}
                            >
                                <Guitar size={18} />
                                {currentInstrumentDef.id === 'piano' ? 'Piano' : 'Guitar'}
                            </button>
                        )}
                        <button
                            className={`hint-button ${settings.showHint ? 'active' : ''}`}
                            onClick={() => setSettings(s => ({ ...s, showHint: !s.showHint }))}
                            title="Keyboard Shortcut: H"
                        >
                            <HelpCircle size={18} />
                            {settings.showHint ? "Hide Hint" : "Show Hint"}
                        </button>
                        <button
                            className="hint-button"
                            onClick={() => playNote(targetMidi, settings.referenceNoteDuration ?? 1.5, settings.autoPlayVolume ?? 0.5)}
                            title="Keyboard Shortcut: P or R"
                        >
                            <Volume2 size={18} />
                            Play Note
                        </button>
                        <button className="skip-button" onClick={() => generateNewNote()} title="Keyboard Shortcut: Space">
                            <SkipForward size={18} />
                            Skip Note
                        </button>
                    </div>
                )}
            </div>
        );
    }
);

export default SingleNoteTrainer;
