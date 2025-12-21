import type { Instrument } from './Tunings';

export type ClefMode = 'treble' | 'bass' | 'grand';

export interface RangeConfig {
    id: string;
    label: string;
    min: number; // MIDI number
    max: number; // MIDI number
}

export interface InstrumentDefinition {
    id: Instrument | 'piano' | 'voice' | 'whistle';
    displayName: string;
    clefMode: ClefMode;
    transpose: number; // Semitones to add to MIDI to get written note (e.g. +12 for guitar)
    ranges: RangeConfig[];
    showTuning: boolean;
}

export const INSTRUMENT_DEFINITIONS: Record<string, InstrumentDefinition> = {
    guitar: {
        id: 'guitar',
        displayName: 'Guitar',
        clefMode: 'treble',
        transpose: 12, // Guitar sounds octave lower than written, so we add 12 to played midi to show it
        showTuning: true,
        ranges: [
            { id: 'open', label: 'Open Strings', min: 40, max: 64 }, // Dynamic logic handled in App for specific strings, but this is fallback
            { id: 'first_pos', label: 'First Position', min: 40, max: 44 + 12 }, // Approx
            { id: 'all', label: 'All Notes', min: 40, max: 76 }
        ]
    },
    bass: {
        id: 'bass',
        displayName: 'Bass Guitar',
        clefMode: 'bass',
        transpose: 12,
        showTuning: true,
        ranges: [
            // Bass Standard: E1 (28) -> G3 approx (55)
            { id: 'all', label: 'All Notes', min: 28, max: 55 }
        ]
    },
    piano: {
        id: 'piano',
        displayName: 'Piano',
        clefMode: 'grand',
        transpose: 0,
        showTuning: false,
        ranges: [
            { id: 'middle_c', label: 'Middle C Area', min: 53, max: 67 }, // F3 to G4
            { id: 'two_octave', label: 'Two Octaves', min: 48, max: 72 }, // C3 to C5
            { id: 'grand_staff', label: 'Grand Staff Wide', min: 36, max: 84 } // C2 to C6
        ]
    },
    voice: {
        id: 'voice',
        displayName: 'Voice',
        clefMode: 'treble', // Dynamic? Usually vocal music is specific clef OR treble w/ 8va. Let's stick to Treble/Bass per range?
        // Actually, let's keep simple static clef or make App logic handle it. 
        // For now, Voice is usually Treble unless Bass/Baritone. 
        // Let's use Treble by default and maybe switch if range is low.
        transpose: 0,
        showTuning: false,
        ranges: [
            { id: 'soprano', label: 'Soprano (C4-A5)', min: 60, max: 81 },
            { id: 'alto', label: 'Alto (G3-E5)', min: 55, max: 76 },
            { id: 'tenor', label: 'Tenor (C3-A4)', min: 48, max: 69 },
            { id: 'bass_voice', label: 'Bass (E2-E4)', min: 40, max: 64 }
        ]
    },
    whistle: {
        id: 'whistle',
        displayName: 'Whistle',
        clefMode: 'treble',
        transpose: -12, // Reads 8va (written C4 = sounding C5). E5 (76) sounds -> reads as E4. C8 (108) -> C7.
        showTuning: false,
        ranges: [
            // "starts around E5 for men" -> E5 = 76.
            { id: 'basic', label: 'Basic (E5-E6)', min: 76, max: 88 },
            { id: 'extended', label: 'Extended (E5-E7)', min: 76, max: 100 },
            { id: 'extreme', label: 'Whistle Register (C6-C8)', min: 84, max: 108 }
        ]
    }
};
