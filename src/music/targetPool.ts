/**
 * Unified target-note pool: base playable range (instrument + difficulty /
 * fret window) intersected with the optional key-filter (pitch classes of a
 * tonic+mode) and the optional fret window. Shared by all game modes so the
 * controls behave identically everywhere.
 */
import { keyFor, type ModeId } from './scales';
import { computePlayableNotes, fretWindowNotes, isFrettedInstrument } from './playableRange';
import { TUNINGS } from './Tunings';

export interface TargetPoolInput {
    readonly instrumentId: string;
    readonly difficulty: string;
    readonly tuningId: string;
    readonly customMinFret?: number;
    readonly customMaxFret?: number;
    /** Key filter (target-note key, independent of the displayed key signature). */
    readonly keyEnabled: boolean;
    readonly keyTonic: string;
    readonly keyMode: string;
    /** Fret window (fretted instruments only). */
    readonly fretWindowEnabled: boolean;
    readonly fretMin: number;
    readonly fretMax: number;
}

/**
 * Compute the effective target-note pool.
 *
 * Order of application:
 *  1. base playable range (instrument difficulty / custom frets)
 *  2. fret window (replaces the range for fretted instruments — same
 *     semantics as Phrase Mode's fret window)
 *  3. key filter (pitch-class intersection, keeps spelling/degree data intact
 *     via the same scale machinery Phrase Mode uses)
 */
export function computeTargetPool(input: TargetPoolInput): number[] {
    const tuning = TUNINGS[input.tuningId];
    const fretted = isFrettedInstrument(input.instrumentId) && !!tuning;

    // 1+2: base pool with optional fret window
    let base: number[];
    if (input.fretWindowEnabled && fretted) {
        base = fretWindowNotes(tuning!, input.fretMin, input.fretMax);
    } else {
        base = computePlayableNotes({
            instrumentId: input.instrumentId,
            difficulty: input.difficulty,
            tuningId: input.tuningId,
            customMinFret: input.customMinFret,
            customMaxFret: input.customMaxFret,
        });
    }
    if (!input.keyEnabled) return base;

    // 3: key/mode pitch-class filter
    const mode: ModeId = (['major', 'minor', 'dorian', 'phrygian', 'lydian', 'mixolydian', 'locrian', 'major-pentatonic', 'minor-pentatonic'] as const).includes(input.keyMode as ModeId)
        ? input.keyMode as ModeId
        : 'major';
    const key = keyFor(input.keyTonic, mode);
    const pcs = new Set(key.pitchClasses);
    return base.filter(midi => pcs.has(((midi % 12) + 12) % 12));
}
