import { useEffect, useRef, useState } from 'react';
import { PitchAnalyzer, type MicrophoneDebugInfo } from '../audio/PitchAnalyzer';
import { frequencyToMidi, getNoteDetails, getCentDifference } from '../music/NoteUtils';
import { emitRawFrame } from './rawFrameBus';
import {
    MIC_DEFAULT_SENSITIVITY,
    PITCH_READING_HOLD_MS,
    DISPLAY_EMA_FACTOR,
    NOTE_DISPLAY_STABLE_FRAMES,
} from '../AppConfig';

interface PitchData {
    frequency: number;
    midi: number;
    note: string;
    cents: number;
    clarity: number; // Placeholder for now, maybe uses probability if YIN exposes it
}

export type { MicrophoneDebugInfo };

export function usePitchDetector(
    active: boolean,
    sensitivity: number = MIC_DEFAULT_SENSITIVITY,
    minFrequencyHz?: number
) {
    const analyzerRef = useRef<PitchAnalyzer | null>(null);
    const [pitchData, setPitchData] = useState<PitchData | null>(null);
    const [isListening, setIsListening] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [audioLevel, setAudioLevel] = useState<number>(0);
    const [debugInfo, setDebugInfo] = useState<MicrophoneDebugInfo | null>(null);

    // Latest values for the capture effect (refs keep its dep list minimal so
    // changing them does not restart the microphone)
    const sensitivityRef = useRef(sensitivity);
    const minFrequencyRef = useRef(minFrequencyHz);

    // Apply sensitivity live without restarting capture
    useEffect(() => {
        sensitivityRef.current = sensitivity;
        analyzerRef.current?.setSensitivity(sensitivity);
    }, [sensitivity]);

    // Adapt the analysis window to the instrument's lowest note, live
    useEffect(() => {
        minFrequencyRef.current = minFrequencyHz;
        if (minFrequencyHz) {
            analyzerRef.current?.setLowestFrequency(minFrequencyHz);
        }
    }, [minFrequencyHz]);

    useEffect(() => {
        if (!active) {
            setIsListening(false);
            setPitchData(null);
            setAudioLevel(0);
            setDebugInfo(null);
            return;
        }

        let cancelled = false;
        let rafId = 0;
        let frameCount = 0;
        let lastPitchAt = 0;
        // Display smoothing: pitch/cents/level arrive on every detection frame
        // (~60 fps) and jitter slightly. A short exponential moving average keeps
        // the tuner needle and level meter readable. Done here (in the producer)
        // so the display components can render directly without CSS transitions —
        // transitions on values that change every frame get interrupted 60x/sec,
        // which some engines (Safari/WebKit) punish with a visually stuck needle.
        let smoothedCents: number | null = null;
        let smoothedLevel = 0;
        // Note-name stability: the displayed note only switches after the raw
        // detection reports a different note for several consecutive frames.
        // Prevents D#2/E2-style flicker at semitone boundaries. The raw midi
        // (used for matching) is unaffected.
        let stableMidi: number | null = null;
        let candidateMidi: number | null = null;
        let candidateCount = 0;

        const analyzer = new PitchAnalyzer();
        analyzer.setSensitivity(sensitivityRef.current);
        if (minFrequencyRef.current) {
            analyzer.setLowestFrequency(minFrequencyRef.current);
        }
        analyzerRef.current = analyzer;

        function tick() {
            if (cancelled) return;

            const freq = analyzer.getPitch();
            const now = performance.now();

            // RAW frame for sequence matching (phrase mode): one per tick,
            // silence included. Not batched through React state — matching
            // must see nulls immediately and must not depend on render rate.
            emitRawFrame({ midi: freq ? frequencyToMidi(freq) : null, at: now });

            if (freq) {
                lastPitchAt = now;
                const midi = frequencyToMidi(freq);

                // Note-name hysteresis: only switch the displayed note after
                // the new one persists for a few consecutive frames.
                if (midi === stableMidi) {
                    candidateMidi = null;
                    candidateCount = 0;
                } else if (midi === candidateMidi) {
                    if (++candidateCount >= NOTE_DISPLAY_STABLE_FRAMES) {
                        stableMidi = midi;
                        candidateMidi = null;
                        candidateCount = 0;
                        // Re-anchor the cents average: a new note means a new
                        // reference (the needle must not sweep across the scale).
                        smoothedCents = null;
                    }
                } else {
                    candidateMidi = midi;
                    candidateCount = 1;
                }

                // Cents are displayed relative to the STABLE note (like real
                // tuners): the needle sweeps to ±50 and only then the note flips.
                const displayMidi = stableMidi ?? midi;
                const { scientific } = getNoteDetails(displayMidi);
                const cents = getCentDifference(freq, displayMidi);

                smoothedCents = smoothedCents === null
                    ? cents
                    : smoothedCents + (cents - smoothedCents) * DISPLAY_EMA_FACTOR;

                setPitchData({
                    frequency: freq,
                    midi, // raw — matching uses this and must stay unsmoothed
                    note: scientific,
                    cents: smoothedCents, // smoothed — display only
                    clarity: 1
                });
            } else if (lastPitchAt !== 0 && now - lastPitchAt > PITCH_READING_HOLD_MS) {
                // Clear stale readings so the UI doesn't keep displaying
                // (and matching against) a note that stopped sounding long ago.
                lastPitchAt = 0;
                smoothedCents = null;
                stableMidi = null;
                candidateMidi = null;
                candidateCount = 0;
                setPitchData(null);
            }

            // Always update level (smoothed)
            smoothedLevel += (analyzer.getCurrentLevel() - smoothedLevel) * DISPLAY_EMA_FACTOR;
            setAudioLevel(smoothedLevel);

            // Debug info is only shown in the settings modal; ~4 Hz is plenty
            // and avoids a third state update (full re-render) every frame.
            if (++frameCount % 15 === 0) {
                setDebugInfo(analyzer.getDebugInfo());
            }

            rafId = requestAnimationFrame(tick);
        }

        analyzer.start()
            .then(() => {
                if (cancelled) {
                    // StrictMode double-mount or quick toggle-off while
                    // getUserMedia was pending: don't leave the mic running.
                    analyzer.stop();
                    return;
                }
                setIsListening(true);
                setError(null);
                tick();
            })
            .catch((err: Error) => {
                if (cancelled) return;
                console.error(err);
                // Provide more specific error messages
                if (err.name === 'NotAllowedError') {
                    setError("Microphone access denied. Please allow microphone access.");
                } else if (err.name === 'NotFoundError') {
                    setError("No microphone found. Please connect a microphone.");
                } else if (err.name === 'NotReadableError') {
                    setError("Microphone is in use by another app.");
                } else {
                    setError("Could not access microphone.");
                }
                setIsListening(false);
            });

        return () => {
            cancelled = true;
            cancelAnimationFrame(rafId);
            analyzer.stop();
            if (analyzerRef.current === analyzer) {
                analyzerRef.current = null;
            }
            setIsListening(false);
            setPitchData(null);
            setAudioLevel(0);
            setDebugInfo(null);
        };
    }, [active]);

    return { pitchData, isListening, error, audioLevel, debugInfo };
}
