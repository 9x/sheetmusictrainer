/**
 * Arpeggio generator (Phrase Mode material).
 *
 * Diatonic triads (I, ii, iii, IV, V, vi, vii°) built from the selected
 * key/mode; each practice run arpeggiates ONE chord — the user picks the
 * degree, the pattern (up / down / up-down / 1-2-3-5) and the coverage
 * (one or two octaves). Chord tones are spelled via the key's degree
 * spelling (same machinery as melody/scale generators), so spelling and
 * validation match the Phrase Mode invariants exactly.
 */
import { PPQ, validateScore, type Result, type Score, type ScoreEvent } from '../score/model';
import { keyFor, type KeyContext, type ModeId } from './scales';
import { STEP_LETTERS, LETTER_PC, type StepLetter } from '../score/model';

export type ArpeggioDegree = 'I' | 'ii' | 'iii' | 'IV' | 'V' | 'vi' | 'vii0';
export type ArpeggioPattern = 'up' | 'down' | 'updown' | '1235';
export type ArpeggioCoverage = 'one-octave' | 'two-octave';

export interface ArpeggioConfig {
    readonly keyTonic: string;
    readonly keyMode: ModeId;
    readonly degree: ArpeggioDegree;
    readonly pattern: ArpeggioPattern;
    readonly coverage: ArpeggioCoverage;
    readonly meter: { readonly numerator: 3 | 4; readonly denominator: 4 };
}

/** Degree index (0-based) into the scale for each arpeggio degree label. */
const DEGREE_INDEX: Record<ArpeggioDegree, number> = {
    I: 0, ii: 1, iii: 2, IV: 3, V: 4, vi: 5, 'vii0': 6,
};

export const ARPEGGIO_DEGREE_LABELS: Record<ArpeggioDegree, string> = {
    I: 'I', ii: 'ii', iii: 'iii', IV: 'IV', V: 'V', vi: 'vi', 'vii0': 'vii°',
};

/** pc of a spelled degree (step letter + alter). */
const degreePc = (d: { step: StepLetter; alter: number }): number =>
    (LETTER_PC[STEP_LETTERS.indexOf(d.step)] + d.alter + 144) % 12;

/**
 * Chord-tone midi notes of the diatonic triad on `degreeIndex` (0-based),
 * intersected with the playable pool, ascending.
 */
function chordTonesInPool(key: KeyContext, degreeIndex: number, pool: number[]): number[] {
    const steps = [0, 2, 4].map(offset => (degreeIndex + offset) % 7);
    const pcs = new Set(steps.map(i => degreePc(key.degrees[i])));
    return pool.filter(midi => pcs.has(((midi % 12) + 12) % 12));
}

/** Spelling (step, alter) for a midi note in the key — via scale degrees. */
function spellInKey(key: KeyContext, midi: number): { step: StepLetter; alter: number; octave: number } | null {
    const pc = ((midi % 12) + 12) % 12;
    const d = key.degrees.find(deg => degreePc(deg) === pc);
    if (!d) return null;
    const octave = (midi - pc) / 12 - 1;
    return { step: d.step, alter: d.alter, octave };
}

/**
 * Build the arpeggio path: chord tones ascending from the lowest available
 * root (degree tone) that allows a full one/two-octave cycle in the pool.
 * Pattern up/down/updown/1235 is applied to one octave cycle.
 */
function buildPath(key: KeyContext, degreeIndex: number, pool: number[], coverage: ArpeggioCoverage, pattern: ArpeggioPattern): number[] | null {
    const tones = chordTonesInPool(key, degreeIndex, pool);
    if (tones.length < 3) return null; // need at least one full triad

    const rootPc = degreePc(key.degrees[degreeIndex]);
    const octaveCycle = (startMidi: number): number[] => {
        // chord tones >= startMidi within one octave, INCLUDING the octave
        // of the root (an arpeggio cycle conventionally ends on the octave)
        const cycle: number[] = [];
        for (const midi of tones) {
            if (midi >= startMidi && midi <= startMidi + 12) cycle.push(midi);
        }
        if (!cycle.includes(startMidi + 12) && pool.includes(startMidi + 12)) {
            cycle.push(startMidi + 12);
        }
        return cycle.sort((a, b) => a - b);
    };

    const cycles: number[][] = [];
    // candidate roots: chord-tone midis with pc == rootPc, ascending
    const roots = tones.filter(m => ((m % 12) + 12) % 12 === rootPc);
    const octavesWanted = coverage === 'one-octave' ? 1 : 2;
    for (const root of roots) {
        const first = octaveCycle(root);
        if (first.length < 3 || first[0] !== root) continue;
        // second octave: tones one octave above `root`
        const second = first.map(m => m + 12).filter(m => pool.includes(m));
        if (octavesWanted === 2 && second.length < 4) continue;
        cycles.push(first);
        break; // lowest fitting root
    }
    if (cycles.length === 0) return null;

    const base = cycles[0];
    const up = octavesWanted === 2
        // base already ends on the octave of the root — the second octave
        // continues from there (drop the duplicated turning root)
        ? [...base, ...base.map(m => m + 12).slice(1)]
        : base;

    switch (pattern) {
        case 'up': return up;
        case 'down': return [...up].reverse();
        case 'updown': {
            // ascend then descend, dropping the duplicated turning note
            const desc = [...up].reverse().slice(1);
            return [...up, ...desc];
        }
        case '1235': {
            // root, third, fifth, octave (of the root) — repeated per octave
            const path: number[] = [];
            for (let oct = 0; oct < octavesWanted; oct++) {
                path.push(base[0] + 12 * oct);
                path.push(base[1] + 12 * oct);
                path.push(base[2] + 12 * oct);
                path.push(base[0] + 12 * (oct + 1));
            }
            return path;
        }
    }
}

export function generateArpeggio(
    config: ArpeggioConfig,
    eligiblePitches: number[],
): Result<Score> {
    const key = keyFor(config.keyTonic, config.keyMode);
    const pool = Array.from(new Set(eligiblePitches.filter(m => Number.isInteger(m)))).sort((a, b) => a - b);
    if (pool.length === 0) return { ok: false, error: 'No playable notes in the selected range — widen the note set.' };

    const degreeIndex = DEGREE_INDEX[config.degree];
    const path = buildPath(key, degreeIndex, pool, config.coverage, config.pattern);
    if (!path || path.length === 0) {
        return {
            ok: false,
            error: 'The complete arpeggio does not fit the playable range — widen the range (strings/fret window) or pick another degree.',
        };
    }

    // ---- Quarter-note rhythm, final note extended to fill its bar ---------
    const full = config.meter.numerator * PPQ;
    if (path.length * PPQ > 8 * full) {
        return { ok: false, error: 'This arpeggio is longer than 8 bars — reduce the coverage.' };
    }
    const barCount = Math.max(1, Math.ceil((path.length * PPQ) / full));
    const totalTicks = barCount * full;
    const lastDuration = PPQ + (totalTicks - path.length * PPQ);

    const events: ScoreEvent[] = [];
    let cursor = 0;
    for (let i = 0; i < path.length; i++) {
        const dur = i === path.length - 1 ? lastDuration : PPQ;
        const spelled = spellInKey(key, path[i]);
        if (!spelled) return { ok: false, error: 'Internal error spelling arpeggio pitch.' };
        events.push({ id: `a${i}`, startTick: cursor, durationTicks: dur, pitch: { midi: path[i], ...spelled } });
        cursor += dur;
    }

    const chordName = `${key.tonic} ${ARPEGGIO_DEGREE_LABELS[config.degree]}`;
    const patternLabel = { up: 'up', down: 'down', updown: 'up & down', '1235': '1-2-3-5' }[config.pattern];
    const score: Score = {
        version: 1,
        id: `arpeggio-${config.keyTonic}-${config.keyMode}-${config.degree}-${config.pattern}-${config.coverage}-${config.meter.numerator}4`,
        title: `Arpeggio — ${chordName} (${patternLabel}, ${config.coverage})`,
        meter: config.meter,
        key: { tonic: config.keyTonic, mode: config.keyMode, signature: key.signature },
        measures: Array.from({ length: barCount }, (_, i) => ({
            number: i + 1,
            startTick: i * full,
            durationTicks: full,
        })),
        voices: [{ id: 'melody', events }],
    };
    const problems = validateScore(score);
    if (problems.length > 0) return { ok: false, error: `Internal arpeggio error: ${problems[0]}` };
    return { ok: true, value: score };
}
