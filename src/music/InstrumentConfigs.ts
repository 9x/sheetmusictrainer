import type { Instrument } from './Tunings';

export type ClefMode = 'treble' | 'bass' | 'grand';

export type NoteSetType = 'static' | 'open_strings' | 'first_position' | 'custom_fret' | 'specific_string';

export interface NoteSetConfig {
    id: string;
    label: string;
    type: NoteSetType;
    min?: number; // MIDI number for static
    max?: number; // MIDI number for static
    notes?: number[]; // Explicit list for static
    defaultMinFret?: number;
    defaultMaxFret?: number;
    stringIndex?: number; // 0-based index from lowest string (0) to highest
}

export interface InstrumentDefinition {
    id: Instrument | 'piano' | 'voice' | 'whistle';
    displayName: string;
    clefMode: ClefMode;
    transpose: number; // Semitones to add to MIDI to get written note (e.g. +12 for guitar)
    ranges: NoteSetConfig[];
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
            {
                id: 'open',
                label: 'Open Strings',
                type: 'open_strings',
                // Legacy fallback if needed, but App should use type
                min: 40, max: 64
            },
            {
                id: 'first_pos',
                label: 'First Position',
                type: 'first_position',
                min: 40, max: 68
            },
            {
                id: 'all',
                label: 'All Notes',
                type: 'static',
                min: 40, max: 76
            },
            {
                id: 'custom',
                label: 'Custom Fret Range',
                type: 'custom_fret',
                defaultMinFret: 0,
                defaultMaxFret: 12
            },
            // Per String Sets (High E is index 5, Low E is index 0)
            { id: 'string_1', label: 'String 1 (High)', type: 'specific_string', stringIndex: 5 },
            { id: 'string_2', label: 'String 2', type: 'specific_string', stringIndex: 4 },
            { id: 'string_3', label: 'String 3', type: 'specific_string', stringIndex: 3 },
            { id: 'string_4', label: 'String 4', type: 'specific_string', stringIndex: 2 },
            { id: 'string_5', label: 'String 5', type: 'specific_string', stringIndex: 1 },
            { id: 'string_6', label: 'String 6 (Low)', type: 'specific_string', stringIndex: 0 },
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
            { id: 'all', label: 'All Notes', type: 'static', min: 28, max: 55 },
            { id: 'string_1', label: 'String 1 (High)', type: 'specific_string', stringIndex: 3 },
            { id: 'string_2', label: 'String 2', type: 'specific_string', stringIndex: 2 },
            { id: 'string_3', label: 'String 3', type: 'specific_string', stringIndex: 1 },
            { id: 'string_4', label: 'String 4 (Low)', type: 'specific_string', stringIndex: 0 },
        ]
    },
    piano: {
        id: 'piano',
        displayName: 'Piano',
        clefMode: 'grand',
        transpose: 0,
        showTuning: false,
        ranges: [
            { id: 'middle_c', label: 'Middle C Area', type: 'static', min: 53, max: 67 }, // F3 to G4
            { id: 'two_octave', label: 'Two Octaves', type: 'static', min: 48, max: 72 }, // C3 to C5
            { id: 'grand_staff', label: 'Grand Staff Wide', type: 'static', min: 36, max: 84 } // C2 to C6
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
            { id: 'soprano', label: 'Soprano (C4-A5)', type: 'static', min: 60, max: 81 },
            { id: 'alto', label: 'Alto (G3-E5)', type: 'static', min: 55, max: 76 },
            { id: 'tenor', label: 'Tenor (C3-A4)', type: 'static', min: 48, max: 69 },
            { id: 'bass_voice', label: 'Bass (E2-E4)', type: 'static', min: 40, max: 64 }
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
            { id: 'basic', label: 'Basic (E5-E6)', type: 'static', min: 76, max: 88 },
            { id: 'extended', label: 'Extended (E5-E7)', type: 'static', min: 76, max: 100 },
            { id: 'extreme', label: 'Whistle Register (C6-C8)', type: 'static', min: 84, max: 108 }
        ]
    }
};
