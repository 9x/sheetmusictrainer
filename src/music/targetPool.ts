/**
 * Unified target-note pool: base playable range (instrument + difficulty /
 * fret window) intersected with the optional key-filter (pitch classes of a
 * tonic+mode) and the optional fret window. Shared by all game modes so the
 * controls behave identically everywhere.
 */
import { keyFor, type ModeId } from './scales';
import { computePlayableNotes, isFrettedInstrument } from './playableRange';
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
    /** Selected string indices (0 = lowest). Empty = all strings. */
    readonly strings: number[];
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
 *  2. string selection ∩ fret window (fretted instruments only — replaces
 *     the range, same semantics as Phrase Mode's fret window)
 *  3. key filter (pitch-class intersection, keeps spelling/degree data intact
 *     via the same scale machinery Phrase Mode uses)
 */
export function computeTargetPool(input: TargetPoolInput): number[] {
    const tuning = TUNINGS[input.tuningId];
    const fretted = isFrettedInstrument(input.instrumentId) && !!tuning;

    // 1+2: base pool with string selection and optional fret window.
    // For fretted instruments with NO filters the pool is the full fretboard
    // (frets 0–12) — the legacy difficulty ranges no longer apply since the
    // Note Set dropdown was removed.
    let base: number[];
    if (fretted) {
        const all = tuning!.strings;
        const selected = input.strings.length > 0
            ? all.filter((_, i) => input.strings.includes(i))
            : all;
        if (selected.length === 0) return [];
        const lo = input.fretWindowEnabled ? Math.max(0, Math.min(24, input.fretMin)) : 0;
        const hi = input.fretWindowEnabled ? Math.max(lo, Math.min(24, input.fretMax)) : 12;
        base = selected.flatMap(open => {
            const notes: number[] = [];
            for (let fret = lo; fret <= hi; fret++) notes.push(open + fret);
            return notes;
        }).sort((a, b) => a - b);
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
