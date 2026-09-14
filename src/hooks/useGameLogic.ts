import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useSettings } from '../context/useSettings';
import { useAudioPlayer } from './useAudioPlayer';
import { useMetronome } from './useMetronome';
import { audioEngine } from '../audio/AudioEngine';
import { MatchTracker } from '../game/MatchTracker';
import {
    getRandomNote,
    getNoteDetails
} from '../music/NoteUtils';
import { computeTargetPool } from '../music/targetPool';
import { getPracticeFilter } from '../types/SettingsTypes';
import {
    NOTE_MATCH_THRESHOLD_MS,
    NOTE_MATCH_GRACE_MS,
    REFERENCE_QUIET_MAX_WAIT_MS,
} from '../AppConfig';

export const useGameLogic = (
    pitchData: { midi: number; note: string; cents: number; frequency: number } | null
) => {
    const { settings } = useSettings();
    const { playNote } = useAudioPlayer();

    const [targetMidi, setTargetMidi] = useState<number>(60);
    const [feedbackMessage, setFeedbackMessage] = useState<string>("");
    const [revealed, setRevealed] = useState(false);
    const [virtualNote, setVirtualNote] = useState<number | null>(null);
    const feedbackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Flicker-tolerant match timer: brief detection dropouts don't reset progress
    const [tracker] = useState(() => new MatchTracker(NOTE_MATCH_THRESHOLD_MS, NOTE_MATCH_GRACE_MS));

    // --- Valid Notes Calculation ---

    const validNotes = useMemo(() => {
        const pf = getPracticeFilter(settings);
        return computeTargetPool({
            instrumentId: settings.instrument,
            difficulty: settings.difficulty,
            tuningId: settings.tuningId,
            customMinFret: settings.customMinFret,
            customMaxFret: settings.customMaxFret,
            keyEnabled: pf.keyEnabled,
            keyTonic: pf.keyTonic,
            keyMode: pf.keyMode,
            fretWindowEnabled: pf.fretWindowEnabled,
            fretMin: pf.fretMin,
            fretMax: pf.fretMax,
        });
    }, [settings.instrument, settings.difficulty, settings.tuningId, settings.customMinFret, settings.customMaxFret,
        settings.practice?.keyEnabled, settings.practice?.keyTonic, settings.practice?.keyMode,
        settings.practice?.fretWindowEnabled, settings.practice?.fretMin, settings.practice?.fretMax]);

    // --- Note Generation ---
    const generateNewNote = useCallback((keepFeedback = false) => {
        if (validNotes.length === 0) return;
        const min = validNotes[0];
        const max = validNotes[validNotes.length - 1];

        // Avoid repeating the previous note (a single retry could still land on it)
        const candidates = validNotes.length > 1
            ? validNotes.filter(n => n !== targetMidi)
            : validNotes;
        setTargetMidi(getRandomNote(min, max, candidates));

        tracker.reset();
        if (!keepFeedback) {
            setFeedbackMessage("");
        }
        setRevealed(false);
    }, [validNotes, targetMidi, tracker]);

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
    // Boolean summary of "is the mic currently detecting a sounding note".
    // The effect below depends on this BOOLEAN rather than on `pitchData`
    // itself (which is a new object every frame — it would reset the 100ms
    // play timer 60 times per second and the note would never play).
    const isMicQuiet = pitchData === null;

    // Remembers which target the reference note was already played for,
    // so re-running the effect (e.g. the quiet-state flipping) can't play it twice.
    const autoPlayedForRef = useRef<number | null>(null);

    useEffect(() => {
        const shouldAutoPlay =
            settings.gameMode === 'ear_training' ||
            (settings.gameMode === 'sight_reading' && settings.autoPlaySightReading);

        if (!shouldAutoPlay || revealed) return;
        if (autoPlayedForRef.current === targetMidi) return; // already played

        const duration = settings.referenceNoteDuration ?? 1.5;
        const volume = settings.autoPlayVolume ?? 0.5;

        // "Wait for silence": hold the next reference note while the user's
        // instrument is still ringing, so it can't mask the new note.
        if (settings.waitForQuiet && !isMicQuiet) {
            const cap = setTimeout(() => {
                if (autoPlayedForRef.current === targetMidi) return;
                autoPlayedForRef.current = targetMidi;
                playNote(targetMidi, duration, volume);
            }, REFERENCE_QUIET_MAX_WAIT_MS);
            return () => clearTimeout(cap);
        }

        const timer = setTimeout(() => {
            autoPlayedForRef.current = targetMidi;
            playNote(targetMidi, duration, volume);
        }, 100);
        return () => clearTimeout(timer);
    }, [
        targetMidi,
        revealed,
        isMicQuiet,
        settings.gameMode,
        settings.autoPlaySightReading,
        settings.referenceNoteDuration,
        settings.autoPlayVolume,
        settings.waitForQuiet,
        playNote,
    ]);

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
    // Tolerant of flicker: MatchTracker keeps accumulating hold time across
    // brief dropouts instead of resetting on every single bad frame.
    useEffect(() => {
        // Ignore the microphone while the app itself is making sound — the
        // speaker output would otherwise be picked up and scored as correct
        // (ear-training auto-play, Play Note button, virtual instruments).
        if (audioEngine.isAudible()) {
            tracker.reset();
            return;
        }

        const matching = pitchData !== null && pitchData.midi === targetMidi;
        if (tracker.update(matching, Date.now())) {
            handleMatchSuccess();
        }
    }, [pitchData, targetMidi, handleMatchSuccess, tracker]);

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
