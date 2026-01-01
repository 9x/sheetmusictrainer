import { useEffect, useRef, useState, useCallback } from 'react';
import { PitchAnalyzer, type MicrophoneDebugInfo } from '../audio/PitchAnalyzer';
import { frequencyToMidi, getNoteDetails, getCentDifference } from '../music/NoteUtils';

interface PitchData {
    frequency: number;
    midi: number;
    note: string;
    cents: number;
    clarity: number; // Placeholder for now, maybe uses probability if YIN exposes it
}

import { MIC_DEFAULT_SENSITIVITY } from '../AppConfig';

export type { MicrophoneDebugInfo };

export function usePitchDetector(active: boolean, sensitivity: number = MIC_DEFAULT_SENSITIVITY) {
    const analyzerRef = useRef<PitchAnalyzer | null>(null);
    const [pitchData, setPitchData] = useState<PitchData | null>(null);
    const [isListening, setIsListening] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [audioLevel, setAudioLevel] = useState<number>(0);
    const [debugInfo, setDebugInfo] = useState<MicrophoneDebugInfo | null>(null);
    const animationRef = useRef<number | null>(null);

    // Update sensitivity when it changes
    useEffect(() => {
        if (analyzerRef.current) {
            analyzerRef.current.setSensitivity(sensitivity);
        }
    }, [sensitivity]);

    const updatePitch = useCallback(() => {
        if (!analyzerRef.current) return;

        const freq = analyzerRef.current.getPitch();
        if (freq) {
            const midi = frequencyToMidi(freq);
            const { scientific } = getNoteDetails(midi);

            const cents = getCentDifference(freq, midi);

            setPitchData({
                frequency: freq,
                midi,
                note: scientific,
                cents,
                clarity: 1
            });
        }

        // Always update level and debug info
        setAudioLevel(analyzerRef.current.getCurrentLevel());
        setDebugInfo(analyzerRef.current.getDebugInfo());

        animationRef.current = requestAnimationFrame(updatePitch);
    }, []);

    useEffect(() => {
        if (active) {
            if (!analyzerRef.current) {
                analyzerRef.current = new PitchAnalyzer();
                analyzerRef.current.setSensitivity(sensitivity);
            }

            analyzerRef.current.start()
                .then(() => {
                    setIsListening(true);
                    setError(null);
                    updatePitch();
                })
                .catch(err => {
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
        } else {
            if (analyzerRef.current) {
                analyzerRef.current.stop();
                analyzerRef.current = null;
            }
            setIsListening(false);
            setPitchData(null);
            setAudioLevel(0);
            setDebugInfo(null);
            if (animationRef.current) cancelAnimationFrame(animationRef.current);
        }

        return () => {
            if (animationRef.current) cancelAnimationFrame(animationRef.current);
            if (analyzerRef.current) {
                analyzerRef.current.stop();
            }
        };
    }, [active, updatePitch]);

    return { pitchData, isListening, error, audioLevel, debugInfo };
}
