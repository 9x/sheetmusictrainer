/**
 * Playable-note resolution, extracted from useGameLogic so both the
 * single-note modes and Phrase Mode share one tested implementation
 * (single-note behavior is unchanged).
 */
import { TUNINGS, getOpenStringNotes, getFirstPositionNotes, type Tuning, type FretPosition } from './Tunings';
import { INSTRUMENT_DEFINITIONS } from './InstrumentConfigs';

export interface PlayableRangeInput {
    readonly instrumentId: string;
    readonly difficulty: string;
    readonly tuningId: string;
    readonly customMinFret?: number;
    readonly customMaxFret?: number;
}

const sanitizeFret = (v: number | undefined, fallback: number): number => {
    if (v === undefined || v === null || Number.isNaN(v)) return fallback;
    return Math.max(0, Math.min(24, Math.round(v)));
};

/** Sorted list of playable MIDI notes for the current instrument/range setup. */
export function computePlayableNotes(input: PlayableRangeInput): number[] {
    const def = INSTRUMENT_DEFINITIONS[input.instrumentId];
    if (!def) return [];
    const tuning = TUNINGS[input.tuningId];
    const config = def.ranges.find(r => r.id === input.difficulty) ?? def.ranges[0];
    if (!config) return [];

    if (config.type === 'open_strings') {
        if (tuning) return getOpenStringNotes(tuning);
        return config.notes ?? [];
    }
    if (config.type === 'first_position') {
        if (tuning) return getFirstPositionNotes(tuning);
        return config.notes ?? [];
    }
    if (config.type === 'custom_fret') {
        if (!tuning) return [];
        const minFret = sanitizeFret(input.customMinFret ?? config.defaultMinFret, 0);
        const maxFret = sanitizeFret(input.customMaxFret ?? config.defaultMaxFret, 12);
        return fretWindowNotes(tuning, minFret, maxFret);
    }
    if (config.type === 'specific_string') {
        if (!tuning || config.stringIndex === undefined) return [];
        const openNote = tuning.strings[config.stringIndex];
        if (openNote === undefined) return [];
        const notes: number[] = [];
        for (let i = 0; i <= 12; i++) notes.push(openNote + i);
        return notes;
    }
    if (config.notes) return config.notes;
    if (config.min !== undefined && config.max !== undefined) {
        const min = Math.max(0, Math.min(127, Math.round(config.min)));
        const max = Math.max(0, Math.min(127, Math.round(config.max)));
        return Array.from({ length: max - min + 1 }, (_, i) => min + i);
    }
    return [];
}

/** All notes reachable within a fret window on the given tuning. */
export function fretWindowNotes(tuning: Tuning, minFret: number, maxFret: number): number[] {
    const lo = sanitizeFret(minFret, 0);
    const hi = Math.max(lo, sanitizeFret(maxFret, 12));
    const notes = new Set<number>();
    for (const open of tuning.strings) {
        for (let fret = lo; fret <= hi; fret++) notes.add(open + fret);
    }
    return Array.from(notes).sort((a, b) => a - b);
}

/**
 * Fretboard positions for a note, restricted to a fret window
 * (Phrase Mode hints must respect the selected position).
 */
export function positionsWithinWindow(
    midiNote: number,
    tuning: Tuning,
    minFret: number,
    maxFret: number,
): FretPosition[] {
    const lo = sanitizeFret(minFret, 0);
    const hi = Math.max(lo, sanitizeFret(maxFret, 12));
    const positions: FretPosition[] = [];
    tuning.strings.forEach((open, stringIndex) => {
        const fret = midiNote - open;
        if (fret >= lo && fret <= hi) positions.push({ stringIndex, fret });
    });
    return positions;
}

/** True when the instrument has a fretted tuning (guitar or bass). */
export function isFrettedInstrument(instrumentId: string): boolean {
    const def = INSTRUMENT_DEFINITIONS[instrumentId];
    return !!def && (def.id === 'guitar' || def.id === 'bass');
}
