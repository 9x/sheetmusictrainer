import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useSettings } from '../context/SettingsContext';
import { useAudioPlayer } from './useAudioPlayer';
import { useMetronome } from './useMetronome';
import {
    getRandomNote,
    getNoteDetails
} from '../music/NoteUtils';
import {
    TUNINGS,
    getOpenStringNotes,
    getFirstPositionNotes,
} from '../music/Tunings';
import { INSTRUMENT_DEFINITIONS } from '../music/InstrumentConfigs';
import { NOTE_MATCH_THRESHOLD_MS } from '../AppConfig';

export const useGameLogic = (
    pitchData: { midi: number; note: string; cents: number; frequency: number } | null
) => {
    const { settings } = useSettings();
    const { playNote } = useAudioPlayer();

    const [targetMidi, setTargetMidi] = useState<number>(60);
    const [matchStartTime, setMatchStartTime] = useState<number | null>(null);
    const [feedbackMessage, setFeedbackMessage] = useState<string>("");
    const [revealed, setRevealed] = useState(false);
    const [virtualNote, setVirtualNote] = useState<number | null>(null);
    const feedbackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // --- Valid Notes Calculation ---
    const currentTuning = TUNINGS[settings.tuningId];
    const currentInstrumentDef = INSTRUMENT_DEFINITIONS[settings.instrument];

    const validNotes = useMemo(() => {
        const rangeConfig = currentInstrumentDef.ranges.find(r => r.id === settings.difficulty);

        const getNotesFromConfig = (config: typeof rangeConfig) => {
            if (!config) return [];

            if (config.type === 'open_strings') {
                if (currentTuning) return getOpenStringNotes(currentTuning);
                return config.notes || [];
            }

            if (config.type === 'first_position') {
                if (currentTuning) return getFirstPositionNotes(currentTuning);
                return config.notes || [];
            }

            if (config.type === 'custom_fret') {
                if (currentTuning) {
                    const minFret = settings.customMinFret ?? config.defaultMinFret ?? 0;
                    const maxFret = settings.customMaxFret ?? config.defaultMaxFret ?? 12;
                    const notes = new Set<number>();
                    currentTuning.strings.forEach(stringMidi => {
                        for (let fret = minFret; fret <= maxFret; fret++) {
                            notes.add(stringMidi + fret);
                        }
                    });
                    return Array.from(notes).sort((a, b) => a - b);
                }
                return [];
            }

            if (config.type === 'specific_string') {
                if (currentTuning && config.stringIndex !== undefined) {
                    const openNote = currentTuning.strings[config.stringIndex];
                    if (openNote === undefined) return [];
                    const notes = [];
                    for (let i = 0; i <= 12; i++) {
                        notes.push(openNote + i);
                    }
                    return notes;
                }
                return [];
            }

            if (config.notes) return config.notes;
            if (config.min !== undefined && config.max !== undefined) {
                return Array.from({ length: config.max - config.min + 1 }, (_, i) => config.min! + i);
            }
            return [];
        };

        if (rangeConfig) return getNotesFromConfig(rangeConfig);
        const fallbackRange = currentInstrumentDef.ranges[0];
        return getNotesFromConfig(fallbackRange);

    }, [settings.difficulty, currentInstrumentDef, currentTuning, settings.customMinFret, settings.customMaxFret]);

    // --- Note Generation ---
    const generateNewNote = useCallback((keepFeedback = false) => {
        if (validNotes.length === 0) return;
        const min = validNotes[0];
        const max = validNotes[validNotes.length - 1];

        const newNote = getRandomNote(min, max, validNotes);
        if (newNote === targetMidi && validNotes.length > 1) {
            const retry = getRandomNote(min, max, validNotes);
            setTargetMidi(retry);
        } else {
            setTargetMidi(newNote);
        }
        setMatchStartTime(null);
        if (!keepFeedback) {
            setFeedbackMessage("");
        }
        setRevealed(false);
    }, [validNotes, targetMidi]);

    // --- Metronome Logic ---
    const effectiveBpm = useMemo(() => {
        if (settings.rhythm.mode === 'bpm') return settings.rhythm.bpm;
        return 60 / settings.rhythm.seconds;
    }, [settings.rhythm.mode, settings.rhythm.bpm, settings.rhythm.seconds]);

    const handleTick = useCallback(() => {
        if (settings.rhythm.autoAdvance && settings.rhythm.active) {
            generateNewNote();
            setFeedbackMessage("");
        }
    }, [settings.rhythm.autoAdvance, settings.rhythm.active, generateNewNote]);

    const { restart: restartMetronome } = useMetronome({
        bpm: effectiveBpm,
        volume: settings.rhythm.sound ? settings.rhythm.volume : 0,
        playing: settings.rhythm.active,
        onTick: handleTick
    });

    // --- Audio Auto-Play ---
    useEffect(() => {
        const shouldAutoPlay = settings.gameMode === 'ear_training' || (settings.gameMode === 'sight_reading' && settings.autoPlaySightReading);

        if (shouldAutoPlay && !revealed) {
            const timer = setTimeout(() => {
                playNote(targetMidi, 1.0, settings.autoPlayVolume ?? 0.5);
            }, 100);
            return () => clearTimeout(timer);
        }
    }, [targetMidi, settings.gameMode, settings.autoPlaySightReading, revealed, playNote, settings.autoPlayVolume]);

    // --- Init / Reset ---
    useEffect(() => {
        generateNewNote();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [settings.difficulty, settings.tuningId, settings.gameMode]);


    // --- Success Handler ---
    const handleMatchSuccess = useCallback(() => {
        if (feedbackTimeoutRef.current) {
            clearTimeout(feedbackTimeoutRef.current);
        }

        const noteDetails = getNoteDetails(targetMidi);
        setFeedbackMessage(`Good! ${noteDetails.name}`);
        setRevealed(true);
        setMatchStartTime(null);

        const isRhythmActive = settings.rhythm.active && settings.rhythm.autoAdvance;
        const isTimerMode = settings.rhythm.mode === 'seconds';

        if (!isRhythmActive) {
            generateNewNote(true);
            if (settings.disableAnimation) {
                setFeedbackMessage("");
                setRevealed(false);
            } else {
                feedbackTimeoutRef.current = setTimeout(() => {
                    setFeedbackMessage("");
                }, 1500);
            }
        } else {
            if (isTimerMode) {
                restartMetronome();
                generateNewNote(true);
                feedbackTimeoutRef.current = setTimeout(() => {
                    setFeedbackMessage("");
                }, 1500);
                setMatchStartTime(null);
            }
        }
    }, [targetMidi, settings.rhythm, settings.disableAnimation, restartMetronome, generateNewNote]);

    // --- Virtual Instrument Handler ---
    const handleVirtualInstrumentPlay = useCallback((playedMidi: number) => {
        if (!settings.virtualGuitarMute) {
            playNote(playedMidi, 0.5, settings.virtualGuitarVolume ?? 0.5);
        }
        setVirtualNote(playedMidi);

        setTimeout(() => {
            setVirtualNote(null);
        }, 500);

        if (playedMidi === targetMidi) {
            handleMatchSuccess();
        }
    }, [playNote, targetMidi, handleMatchSuccess, settings.virtualGuitarMute, settings.virtualGuitarVolume]);


    // --- Match Checking Loop ---
    useEffect(() => {
        if (!pitchData) {
            setMatchStartTime(null);
            return;
        }

        if (pitchData.midi === targetMidi) {
            if (matchStartTime === null) {
                setMatchStartTime(Date.now());
            } else {
                const duration = Date.now() - matchStartTime;
                if (duration > NOTE_MATCH_THRESHOLD_MS) {
                    handleMatchSuccess();
                }
            }
        } else {
            setMatchStartTime(null);
        }
    }, [pitchData, targetMidi, matchStartTime, handleMatchSuccess]);

    return {
        targetMidi,
        feedbackMessage,
        revealed,
        virtualNote,
        generateNewNote,
        handleMatchSuccess,
        handleVirtualInstrumentPlay,
        setVirtualNote // Exposed for consistency or additional external control if needed
    };
};
