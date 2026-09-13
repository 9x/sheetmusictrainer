/**
 * Scales, modes and key spelling for Phrase Mode.
 *
 * All 12 tonic pitch classes are supported. Modes are defined by
 * {letterOffset, semitones} degree pairs so enharmonic spelling is derived
 * (E# in F# major, B# in C# major, Cb in Ab major, ...) instead of guessed
 * from a chromatic name array — the existing `getNoteInKey` in NoteUtils.ts
 * is limited to 8 major + 3 minor signatures and stays untouched for the
 * single-note modes.
 */
import { STEP_LETTERS, LETTER_PC, type StepLetter, type SpelledPitch } from '../score/model';

export type ModeId =
    | 'major' | 'minor'
    | 'dorian' | 'phrygian' | 'lydian' | 'mixolydian' | 'locrian'
    | 'major-pentatonic' | 'minor-pentatonic';

export interface Degree {
    /** Letter distance from the tonic letter (0 = tonic). */
    readonly letterOffset: number;
    /** Semitone distance from the (spelled) tonic pitch class. */
    readonly semitones: number;
}

export const SCALE_MODES: Record<ModeId, Degree[]> = {
    major: [{ letterOffset: 0, semitones: 0 }, { letterOffset: 1, semitones: 2 }, { letterOffset: 2, semitones: 4 }, { letterOffset: 3, semitones: 5 }, { letterOffset: 4, semitones: 7 }, { letterOffset: 5, semitones: 9 }, { letterOffset: 6, semitones: 11 }],
    minor: [{ letterOffset: 0, semitones: 0 }, { letterOffset: 1, semitones: 2 }, { letterOffset: 2, semitones: 3 }, { letterOffset: 3, semitones: 5 }, { letterOffset: 4, semitones: 7 }, { letterOffset: 5, semitones: 8 }, { letterOffset: 6, semitones: 10 }],
    dorian: [{ letterOffset: 0, semitones: 0 }, { letterOffset: 1, semitones: 2 }, { letterOffset: 2, semitones: 3 }, { letterOffset: 3, semitones: 5 }, { letterOffset: 4, semitones: 7 }, { letterOffset: 5, semitones: 9 }, { letterOffset: 6, semitones: 10 }],
    phrygian: [{ letterOffset: 0, semitones: 0 }, { letterOffset: 1, semitones: 1 }, { letterOffset: 2, semitones: 3 }, { letterOffset: 3, semitones: 5 }, { letterOffset: 4, semitones: 7 }, { letterOffset: 5, semitones: 8 }, { letterOffset: 6, semitones: 10 }],
    lydian: [{ letterOffset: 0, semitones: 0 }, { letterOffset: 1, semitones: 2 }, { letterOffset: 2, semitones: 4 }, { letterOffset: 3, semitones: 6 }, { letterOffset: 4, semitones: 7 }, { letterOffset: 5, semitones: 9 }, { letterOffset: 6, semitones: 11 }],
    mixolydian: [{ letterOffset: 0, semitones: 0 }, { letterOffset: 1, semitones: 2 }, { letterOffset: 2, semitones: 4 }, { letterOffset: 3, semitones: 5 }, { letterOffset: 4, semitones: 7 }, { letterOffset: 5, semitones: 9 }, { letterOffset: 6, semitones: 10 }],
    locrian: [{ letterOffset: 0, semitones: 0 }, { letterOffset: 1, semitones: 1 }, { letterOffset: 2, semitones: 3 }, { letterOffset: 3, semitones: 5 }, { letterOffset: 4, semitones: 6 }, { letterOffset: 5, semitones: 8 }, { letterOffset: 6, semitones: 10 }],
    'major-pentatonic': [{ letterOffset: 0, semitones: 0 }, { letterOffset: 1, semitones: 2 }, { letterOffset: 2, semitones: 4 }, { letterOffset: 4, semitones: 7 }, { letterOffset: 5, semitones: 9 }],
    'minor-pentatonic': [{ letterOffset: 0, semitones: 0 }, { letterOffset: 2, semitones: 3 }, { letterOffset: 3, semitones: 5 }, { letterOffset: 4, semitones: 7 }, { letterOffset: 6, semitones: 10 }],
};

export const MODE_LABELS: Record<ModeId, string> = {
    major: 'Major',
    minor: 'Minor',
    dorian: 'Dorian',
    phrygian: 'Phrygian',
    lydian: 'Lydian',
    mixolydian: 'Mixolydian',
    locrian: 'Locrian',
    'major-pentatonic': 'Major Pentatonic',
    'minor-pentatonic': 'Minor Pentatonic',
};

/** Parent-major offset per mode: parentPc = (tonicPc - offset + 12) % 12. */
const MODE_PARENT_OFFSET: Record<ModeId, number> = {
    major: 0, minor: 9, dorian: 2, phrygian: 4, lydian: 5, mixolydian: 7,
    locrian: 11, 'major-pentatonic': 0, 'minor-pentatonic': 9,
};

/** Conventional tonic names covering all 12 pitch classes. */
export const TONICS: Record<string, { pc: number; step: StepLetter; alter: number }> = {
    'C': { pc: 0, step: 'C', alter: 0 },
    'G': { pc: 7, step: 'G', alter: 0 },
    'D': { pc: 2, step: 'D', alter: 0 },
    'A': { pc: 9, step: 'A', alter: 0 },
    'E': { pc: 4, step: 'E', alter: 0 },
    'B': { pc: 11, step: 'B', alter: 0 },
    'F#': { pc: 6, step: 'F', alter: 1 },
    'Db': { pc: 1, step: 'D', alter: -1 },
    'Ab': { pc: 8, step: 'A', alter: -1 },
    'Eb': { pc: 3, step: 'E', alter: -1 },
    'Bb': { pc: 10, step: 'B', alter: -1 },
    'F': { pc: 5, step: 'F', alter: 0 },
    // Conventional aliases accepted in settings/imports.
    'C#': { pc: 1, step: 'C', alter: 1 },
    'Gb': { pc: 6, step: 'G', alter: -1 },
    'D#': { pc: 3, step: 'D', alter: 1 },
    'G#': { pc: 8, step: 'G', alter: 1 },
    'A#': { pc: 10, step: 'A', alter: 1 },
};

/** Major key signatures by pitch class of the tonic (max 7 accidentals). */
const MAJOR_SIGNATURES: Record<number, { name: string; sharps: string[]; flats: string[] }> = {
    0: { name: 'C', sharps: [], flats: [] },
    7: { name: 'G', sharps: ['F#'], flats: [] },
    2: { name: 'D', sharps: ['F#', 'C#'], flats: [] },
    9: { name: 'A', sharps: ['F#', 'C#', 'G#'], flats: [] },
    4: { name: 'E', sharps: ['F#', 'C#', 'G#', 'D#'], flats: [] },
    11: { name: 'B', sharps: ['F#', 'C#', 'G#', 'D#', 'A#'], flats: [] },
    6: { name: 'F#', sharps: ['F#', 'C#', 'G#', 'D#', 'A#', 'E#'], flats: [] },
    1: { name: 'Db', sharps: [], flats: ['Bb', 'Eb', 'Ab', 'Db', 'Gb'] },
    8: { name: 'Ab', sharps: [], flats: ['Bb', 'Eb', 'Ab', 'Db'] },
    3: { name: 'Eb', sharps: [], flats: ['Bb', 'Eb', 'Ab'] },
    10: { name: 'Bb', sharps: [], flats: ['Bb', 'Eb'] },
    5: { name: 'F', sharps: [], flats: ['Bb'] },
};

export interface KeyContext {
    readonly tonic: string;
    readonly mode: ModeId;
    /** Parent major key name (also the VexFlow key-signature spec). */
    readonly signature: string;
    /** Alter expected by the key signature per step letter. */
    readonly signatureAlter: Record<StepLetter, number>;
    /** Spelled degrees of the scale (length 5 or 7). */
    readonly degrees: Array<{ step: StepLetter; alter: number; semitones: number }>;
    /** Pitch classes (sounding) of the scale. */
    readonly pitchClasses: number[];
}

export function isTonic(name: string): boolean {
    return name in TONICS;
}

export function isMode(mode: string): mode is ModeId {
    return mode in SCALE_MODES;
}

export function keyFor(tonicName: string, modeId: ModeId): KeyContext {
    const tonic = TONICS[tonicName];
    if (!tonic) throw new Error(`Unknown tonic: ${tonicName}`);
    const parentPc = (tonic.pc - MODE_PARENT_OFFSET[modeId] + 12) % 12;
    const sig = MAJOR_SIGNATURES[parentPc];

    const signatureAlter = {} as Record<StepLetter, number>;
    for (const s of STEP_LETTERS) signatureAlter[s] = 0;
    for (const acc of sig.sharps) signatureAlter[acc[0] as StepLetter] = 1;
    for (const acc of sig.flats) signatureAlter[acc[0] as StepLetter] = -1;

    const tonicLetterIdx = STEP_LETTERS.indexOf(tonic.step);
    const tonicPc = (LETTER_PC[STEP_LETTERS.indexOf(tonic.step)] + tonic.alter + 12) % 12;
    const degrees = SCALE_MODES[modeId].map(d => {
        const step = STEP_LETTERS[(tonicLetterIdx + d.letterOffset) % 7];
        const targetPc = (tonicPc + d.semitones) % 12;
        const stepPc = LETTER_PC[STEP_LETTERS.indexOf(step)];
        let alter = ((targetPc - stepPc) % 12 + 12) % 12;
        if (alter > 6) alter -= 12;
        return { step, alter, semitones: d.semitones };
    });

    const pitchClasses = degrees.map(d => (LETTER_PC[STEP_LETTERS.indexOf(d.step)] + d.alter + 12) % 12);
    return { tonic: tonicName, mode: modeId, signature: sig.name, signatureAlter, degrees, pitchClasses };
}

/** VexFlow key-signature spec for the parent major. */
export function vexflowKeySpec(key: KeyContext): string {
    return key.signature;
}

/** Spell a sounding midi note as the given (step, alter), computing octave. */
export function spelledPitch(midi: number, step: StepLetter, alter: number): SpelledPitch {
    const pc = ((LETTER_PC[STEP_LETTERS.indexOf(step)] + alter) % 12 + 12) % 12;
    const octave = (midi - pc) / 12 - 1;
    if (!Number.isInteger(octave)) throw new Error(`Spelling ${step}${alter} does not match midi ${midi}`);
    return { midi, step, alter, octave };
}

/** Spelling of a scale pitch class in the key (degree spelling). */
export function spellPcInKey(pc: number, key: KeyContext): { step: StepLetter; alter: number } | null {
    const normalized = ((pc % 12) + 12) % 12;
    const degree = key.degrees.find(d => (LETTER_PC[STEP_LETTERS.indexOf(d.step)] + d.alter + 12) % 12 === normalized);
    return degree ? { step: degree.step, alter: degree.alter } : null;
}

export interface ScalePitch {
    readonly midi: number;
    readonly pitch: SpelledPitch;
    /** Index into key.degrees (used for step-motion preference). */
    readonly degreeIndex: number;
}

/**
 * All scale notes in [minMidi, maxMidi], spelled in the key.
 * Returned ascending. Each entry knows its scale-degree index so the melody
 * generator can prefer adjacent-degree motion.
 */
export function scalePitches(key: KeyContext, minMidi: number, maxMidi: number): ScalePitch[] {
    const out: ScalePitch[] = [];
    if (maxMidi < minMidi) return out;
    for (let midi = Math.max(0, Math.floor(minMidi)); midi <= Math.min(127, Math.ceil(maxMidi)); midi++) {
        const pc = ((midi % 12) + 12) % 12;
        const degreeIndex = key.pitchClasses.indexOf(pc);
        if (degreeIndex === -1) continue;
        const d = key.degrees[degreeIndex];
        out.push({ midi, pitch: spelledPitch(midi, d.step, d.alter), degreeIndex });
    }
    return out;
}
