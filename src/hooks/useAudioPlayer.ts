import { useRef, useEffect, useCallback } from 'react';
import { midiToFrequency } from '../music/NoteUtils';

interface AudioPlayerHandle {
    playNote: (midi: number, duration?: number, volume?: number) => void;
}

export function useAudioPlayer(): AudioPlayerHandle {
    const audioContext = useRef<AudioContext | null>(null);

    // Initialize AudioContext lazily or on user interaction if possible, 
    // but here we just ensure it exists when we try to play.

    const playNote = useCallback((midi: number, duration: number = 0.5, volume: number = 0.3) => {
        if (!audioContext.current) {
            audioContext.current = new (window.AudioContext || (window as any).webkitAudioContext)();
        }

        const ctx = audioContext.current;
        if (ctx.state === 'suspended') {
            ctx.resume();
        }

        const osc = ctx.createOscillator();
        const gainNode = ctx.createGain();

        const freq = midiToFrequency(midi);

        osc.frequency.value = freq;
        // Triangle wave is often nicer than sine for music training
        osc.type = 'triangle';

        osc.connect(gainNode);
        gainNode.connect(ctx.destination);

        const now = ctx.currentTime;

        // Attack
        gainNode.gain.setValueAtTime(0, now);
        gainNode.gain.linearRampToValueAtTime(volume, now + 0.02);

        // Sustain -> Release
        // Note: For a "pluck" or single hit, we just ramp down.
        gainNode.gain.exponentialRampToValueAtTime(0.001, now + duration);

        osc.start(now);
        osc.stop(now + duration + 0.1); // Stop slightly after fade out

    }, []);

    // Cleanup
    useEffect(() => {
        return () => {
            if (audioContext.current) {
                audioContext.current.close();
                audioContext.current = null;
            }
        };
    }, []);

    return { playNote };
}
