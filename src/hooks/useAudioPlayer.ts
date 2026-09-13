import { useCallback } from 'react';
import { audioEngine } from '../audio/AudioEngine';

interface AudioPlayerHandle {
    playNote: (midi: number, duration?: number, volume?: number) => void;
}

/**
 * Thin hook wrapper around the shared AudioEngine singleton.
 * All playback goes through one AudioContext and is tracked there, so pitch
 * detection can gate itself while the app's own speaker output is audible.
 */
export function useAudioPlayer(): AudioPlayerHandle {
    const playNote = useCallback((midi: number, duration: number = 0.5, volume: number = 0.3) => {
        audioEngine.playNote(midi, duration, volume);
    }, []);

    return { playNote };
}
