

export interface Tuning {
    name: string;
    strings: number[]; // MIDI numbers for strings, usually low to high (6th to 1st)
}

export type Instrument = 'guitar' | 'bass';

// Low E2 (40), A2 (45), D3 (50), G3 (55), B3 (59), E4 (64)
export const STANDARD_TUNING: Tuning = {
    name: "Standard (Guitar)",
    strings: [40, 45, 50, 55, 59, 64]
};

// Low D2 (38), A2 (45), D3 (50), G3 (55), B3 (59), E4 (64)
export const DROP_D_TUNING: Tuning = {
    name: "Drop D (Guitar)",
    strings: [38, 45, 50, 55, 59, 64]
};

// D G D G B E - Drop D & G (D2, G2, D3, G3, B3, E4)
// Standard: E2 A2 D3 G3 B3 E4
// Drop D:   D2 A2 D3 G3 B3 E4
// Drop DG:  D2 G2 D3 G3 B3 E4 (A string dropped to G)
export const DROP_DG_TUNING: Tuning = {
    name: "Drop D & G (Guitar)",
    strings: [38, 43, 50, 55, 59, 64]
};

// Bass Standard: E1 (28), A1 (33), D2 (38), G2 (43)
export const BASS_STANDARD_TUNING: Tuning = {
    name: "Standard (Bass)",
    strings: [28, 33, 38, 43]
};

export const TUNINGS: Record<string, Tuning> = {
    "standard": STANDARD_TUNING,
    "drop_d": DROP_D_TUNING,
    "drop_dg": DROP_DG_TUNING,
    "bass_standard": BASS_STANDARD_TUNING,
};

export const INSTRUMENT_TUNINGS: Record<Instrument, string[]> = {
    'guitar': ['standard', 'drop_d', 'drop_dg'],
    'bass': ['bass_standard']
};

export interface FretPosition {
    stringIndex: number; // 0-based index of the string in the strings array (0 = lowest string)
    fret: number;
}

/**
 * Finds all places on the fretboard where a specific note can be played.
 * Assumes 20 frets by default.
 */
export function getFretboardPositions(midiNote: number, tuning: Tuning = STANDARD_TUNING, maxFrets: number = 20): FretPosition[] {
    const positions: FretPosition[] = [];

    tuning.strings.forEach((openNote, stringIndex) => {
        const fret = midiNote - openNote;
        if (fret >= 0 && fret <= maxFrets) {
            positions.push({ stringIndex, fret });
        }
    });

    return positions;
}


/**
 * Helpers to get useful ranges for beginners
 */
export function getOpenStringNotes(tuning: Tuning = STANDARD_TUNING): number[] {
    return tuning.strings;
}

export function getFirstPositionNotes(tuning: Tuning = STANDARD_TUNING): number[] {
    const notes = new Set<number>();
    tuning.strings.forEach(openNote => {
        // First position usually means frets 0-4
        for (let i = 0; i <= 4; i++) {
            notes.add(openNote + i);
        }
    });
    return Array.from(notes).sort((a, b) => a - b);
}
