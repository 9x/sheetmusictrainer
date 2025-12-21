import { useRef, useEffect, useCallback } from 'react';

interface MetronomeOptions {
    bpm: number;
    volume: number; // 0.0 to 1.0
    playing: boolean;
    onTick: (beat: number) => void;
}

export interface MetronomeHandle {
    restart: () => void;
}

export function useMetronome({ bpm, volume, playing, onTick }: MetronomeOptions): MetronomeHandle {
    const audioContext = useRef<AudioContext | null>(null);
    const nextNoteTime = useRef<number>(0.0);
    const timerID = useRef<number | null>(null);
    const lookahead = 25.0; // How frequently to call scheduling function (in milliseconds)
    const scheduleAheadTime = 0.1; // How far ahead to schedule audio (sec)
    const currentBeat = useRef<number>(0);

    // Keep callback fresh without re-triggering effect
    const onTickRef = useRef(onTick);
    useEffect(() => {
        onTickRef.current = onTick;
    }, [onTick]);

    const nextNote = useCallback(() => {
        const secondsPerBeat = 60.0 / bpm;
        nextNoteTime.current += secondsPerBeat;
        currentBeat.current++;
    }, [bpm]);

    const playClick = useCallback((time: number) => {
        if (!audioContext.current) return;

        const osc = audioContext.current.createOscillator();
        const gainNode = audioContext.current.createGain();

        osc.connect(gainNode);
        gainNode.connect(audioContext.current.destination);

        // Click sound: high pitch, very short decay
        osc.frequency.value = 880;

        // Simple envelope
        gainNode.gain.setValueAtTime(volume, time);
        gainNode.gain.exponentialRampToValueAtTime(0.001, time + 0.05);

        osc.start(time);
        osc.stop(time + 0.05);

        onTickRef.current(currentBeat.current);
    }, [volume]);

    const scheduler = useCallback(() => {
        if (!audioContext.current) return;

        // while there are notes that will need to play before the next interval, 
        // schedule them and advance the pointer.
        while (nextNoteTime.current < audioContext.current.currentTime + scheduleAheadTime) {
            playClick(nextNoteTime.current);
            nextNote();
        }
        timerID.current = window.setTimeout(scheduler, lookahead);
    }, [nextNote, playClick]);

    const restart = useCallback(() => {
        if (audioContext.current) {
            // Reset to play one beat interval from NOW
            const secondsPerBeat = 60.0 / bpm;
            nextNoteTime.current = audioContext.current.currentTime + secondsPerBeat;
            // Should we reset currentBeat?
            currentBeat.current = 0;
        }
    }, [bpm]);

    useEffect(() => {
        if (playing) {
            if (!audioContext.current) {
                audioContext.current = new (window.AudioContext || (window as any).webkitAudioContext)();
            }

            // Resume if suspended (browser autoplay policy)
            if (audioContext.current.state === 'suspended') {
                audioContext.current.resume();
            }

            currentBeat.current = 0;
            nextNoteTime.current = audioContext.current.currentTime + 0.05;
            scheduler();

            return () => {
                if (timerID.current) window.clearTimeout(timerID.current);
            };
        } else {
            if (timerID.current) window.clearTimeout(timerID.current);
        }
    }, [playing, scheduler]);

    return { restart };
}
