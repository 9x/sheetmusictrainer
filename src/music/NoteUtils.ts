
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


export const KEY_SIGNATURES: { [key: string]: { name: string, accidentals: string[] } } = {
    'C': { name: 'C Major', accidentals: [] },
    'G': { name: 'G Major', accidentals: ['F#'] },
    'D': { name: 'D Major', accidentals: ['F#', 'C#'] },
    'A': { name: 'A Major', accidentals: ['F#', 'C#', 'G#'] },
    'E': { name: 'E Major', accidentals: ['F#', 'C#', 'G#', 'D#'] },
    'F': { name: 'F Major', accidentals: ['Bb'] },
    'Bb': { name: 'Bb Major', accidentals: ['Bb', 'Eb'] },
    'Eb': { name: 'Eb Major', accidentals: ['Bb', 'Eb', 'Ab'] },
    'Am': { name: 'A Minor', accidentals: [] },
    'Em': { name: 'E Minor', accidentals: ['F#'] },
    'Dm': { name: 'D Minor', accidentals: ['Bb'] },
};

// Map of midi values to their "natural" note names (0=C, 1=C#/Db, etc.)
// We use this to decide if we need a sharp, flat, or natural based on the key.

// 0=C, 1=C#, 2=D, 3=D#, 4=E, 5=F, 6=F#, 7=G, 8=G#, 9=A, 10=A#, 11=B
// But wait, VexFlow needs specific spelling.
// Let's rely on standard theory:
// Key of G (F#): If we have F# (midi 6), it's consistent. If we have F (midi 5), it's a natural.

/**
 * Specs for a note to be rendered by VexFlow
 */
export interface VexFlowNoteSpec {
    keys: string[]; // e.g., ["c/4"]
    accidental?: string; // "#", "b", "n" (natural), etc.
}

export function getNoteInKey(midi: number, keySignature: string): VexFlowNoteSpec {
    // 1. Get fundamental details
    // We default to Sharps for sharp keys, Flats for flat keys?
    // Simplified logic:
    // C Major: Sharps for chromatics? Usually yes.

    // Let's determine the step and accidental.
    // 60 = C4.

    const keySpec = KEY_SIGNATURES[keySignature] || KEY_SIGNATURES['C'];
    const accList = keySpec.accidentals;

    // Determine if key is "sharp-y" or "flat-y"
    const isFlatKey = accList.some(a => a.includes('b')) || keySignature === 'F' || keySignature.includes('b');

    // Basic chromatic map preference
    const NOTE_NAMES_SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
    const NOTE_NAMES_FLAT = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];

    const preferredNames = isFlatKey ? NOTE_NAMES_FLAT : NOTE_NAMES_SHARP;

    const semitone = midi % 12;
    const octave = Math.floor(midi / 12) - 1;
    const rawName = preferredNames[semitone]; // e.g., "F#" or "Gb" or "C"

    // Check if this note is in the key signature
    // In G Major: F# is in key. F is NOT.
    // In start keys (C, Am), no accidentals in key.

    // Parse the rawName: "F#" -> step "F", mod "#"
    let step = rawName.charAt(0);
    let mod = rawName.length > 1 ? rawName.charAt(1) : "";

    // VexFlow Key Format: "c/4", "f/4", "fb/4"
    // We need to return the accidental to *display*.
    // Rule:
    // If note is in key signature (e.g. F# in G Major) -> Show nothing (implied).
    // If note is NOT in key signature:
    //    - If it's natural but key has accidental (e.g. F natural in G Major) -> Show Natural.
    //    - If it has accidental and matches key (e.g. F# in G Major) -> Show nothing.
    //    - If it has accidental and doesn't match key (e.g. C# in G Major) -> Show #.
    //    - If it's natural and key is natural (e.g. C in C Major) -> Show nothing.

    // Let's find what the key signature expects for this step.
    // Iterate accidentals in key to find if this step is modified in key.
    // e.g. G Major has F#. So for step 'F', expected is '#'. For 'C', expected is ''.

    let expectedMod = "";
    for (const acc of accList) {
        if (acc.startsWith(step)) {
            expectedMod = acc.substring(1); // "#" or "b"
            break;
        }
    }

    let displayAccidental = undefined;

    if (mod === expectedMod) {
        // Matches key signature -> No symbol needed
        displayAccidental = undefined;
    } else {
        // Diverges from key signature
        if (mod === "") {
            // Note is natural, but key expects accidental (e.g. F in G Major)
            displayAccidental = "n";
        } else {
            // Note has accidental (e.g. F# in C Major, or F# in F Major)
            displayAccidental = mod;
        }
    }

    return {
        keys: [`${step.toLowerCase()}${mod}/${octave}`], // Vexflow key: "c/4", "c#/4", "db/4"
        accidental: displayAccidental
    };
}

