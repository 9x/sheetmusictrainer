
export const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
export const A4 = 440;

export interface NoteDetail {
    midi: number;
    name: string;
    octave: number;
    scientific: string; // e.g., "C4"
    frequency: number;
}

export function frequencyToMidi(frequency: number): number {
    if (frequency <= 0) return 0;
    return Math.round(69 + 12 * Math.log2(frequency / A4));
}

export function midiToFrequency(midi: number): number {
    return A4 * Math.pow(2, (midi - 69) / 12);
}

export function getNoteDetails(midi: number): NoteDetail {
    const semitone = midi % 12;
    const name = NOTE_NAMES[semitone];
    const octave = Math.floor(midi / 12) - 1; // MIDI 60 is C4
    return {
        midi,
        name,
        octave,
        scientific: `${name}${octave}`,
        frequency: midiToFrequency(midi)
    };
}

export function getCentDifference(frequency: number, targetMidi: number): number {
    const targetFreq = midiToFrequency(targetMidi);
    if (frequency <= 0 || targetFreq <= 0) return 0;
    return 1200 * Math.log2(frequency / targetFreq);
}

/**
 * Returns a random MIDI note between min and max (inclusive)
 */
export function getRandomNote(min: number, max: number, validNotes?: number[]): number {
    if (validNotes && validNotes.length > 0) {
        const filtered = validNotes.filter(n => n >= min && n <= max);
        if (filtered.length === 0) return min; // Fallback
        return filtered[Math.floor(Math.random() * filtered.length)];
    }
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Helper to convert Written note to Sounding note for guitar
// e.g. Input: "C4" (Written) -> Returns C3 (Sounding) MIDI
// But usually we work with MIDI.
// This is just a note for logic: Guitar Sounding = Written - 12.
