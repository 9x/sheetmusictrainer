import { useEffect, useRef, useState, useCallback } from 'react';
import { PitchAnalyzer } from '../audio/PitchAnalyzer';
import { frequencyToMidi, getNoteDetails, getCentDifference } from '../music/NoteUtils';

interface PitchData {
    frequency: number;
    midi: number;
    note: string;
    cents: number;
    clarity: number; // Placeholder for now, maybe uses probability if YIN exposes it
}

export function usePitchDetector(active: boolean) {
    const analyzerRef = useRef<PitchAnalyzer | null>(null);
    const [pitchData, setPitchData] = useState<PitchData | null>(null);
    const [isListening, setIsListening] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const animationRef = useRef<number | null>(null);

    const updatePitch = useCallback(() => {
        if (!analyzerRef.current) return;

        const freq = analyzerRef.current.getPitch();
        if (freq) {
            const midi = frequencyToMidi(freq);
            const { scientific } = getNoteDetails(midi);

            // Calculate cents off purely for display if needed, 
            // but for training we usually care if midi matches.

            const cents = getCentDifference(freq, midi);

            setPitchData({
                frequency: freq,
                midi,
                note: scientific,
                cents,
                clarity: 1
            });
        }

        animationRef.current = requestAnimationFrame(updatePitch);
    }, []);

    useEffect(() => {
        if (active) {
            if (!analyzerRef.current) {
                analyzerRef.current = new PitchAnalyzer();
            }

            analyzerRef.current.start()
                .then(() => {
                    setIsListening(true);
                    updatePitch();
                })
                .catch(err => {
                    console.error(err);
                    setError("Could not access microphone.");
                    setIsListening(false);
                });
        } else {
            if (analyzerRef.current) {
                analyzerRef.current.stop();
                analyzerRef.current = null;
            }
            setIsListening(false);
            setPitchData(null);
            if (animationRef.current) cancelAnimationFrame(animationRef.current);
        }

        return () => {
            if (animationRef.current) cancelAnimationFrame(animationRef.current);
            if (analyzerRef.current) {
                analyzerRef.current.stop();
            }
        };
    }, [active, updatePitch]);

    return { pitchData, isListening, error };
}
