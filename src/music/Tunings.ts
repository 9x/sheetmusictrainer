

export interface Tuning {
    name: string;
    strings: number[]; // MIDI numbers for strings, usually low to high (6th to 1st)
}

// Low E2 (40), A2 (45), D3 (50), G3 (55), B3 (59), E4 (64)
export const STANDARD_TUNING: Tuning = {
    name: "Standard",
    strings: [40, 45, 50, 55, 59, 64]
};

// Low D2 (38), A2 (45), D3 (50), G3 (55), B3 (59), E4 (64)
export const DROP_D_TUNING: Tuning = {
    name: "Drop D",
    strings: [38, 45, 50, 55, 59, 64]
};

export const TUNINGS: Record<string, Tuning> = {
    "standard": STANDARD_TUNING,
    "drop_d": DROP_D_TUNING,
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
