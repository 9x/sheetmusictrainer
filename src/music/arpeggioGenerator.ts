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
import { makeRng } from './melodyGenerator';

export type ArpeggioDegree = 'I' | 'ii' | 'iii' | 'IV' | 'V' | 'vi' | 'vii0';
export type ArpeggioPattern =
    | 'up' | 'down' | 'updown' | '1235'
    // Giuliani-style right-hand figures over one chord (indices into the
    // chord cycle per note; 1=root 2=third 3=fifth 4=octave):
    | '1321'   // root-fifth-third-root
    | '1325'   // root-fifth-third-octave
    | '1535'   // root-octave-fifth-octave
    | '12353'; // root-third-fifth-octave-fifth
export type ArpeggioCoverage = 'one-octave' | 'two-octave';
/** How the chord per bar is chosen in sequence mode. */
export type ArpeggioProgression = 'random' | 'functional' | 'diatonic-cycle';
/** Rhythm density for arpeggio sequences. */
export type ArpeggioRhythm = 'quarters' | 'eighths';

export interface ArpeggioConfig {
    readonly keyTonic: string;
    readonly keyMode: ModeId;
    readonly degree: ArpeggioDegree;
    readonly pattern: ArpeggioPattern;
    readonly coverage: ArpeggioCoverage;
    readonly meter: { readonly numerator: 3 | 4 | 6; readonly denominator: 4 };
    /** Sequence mode: bars > 1 with chord progression selection. */
    readonly bars?: number;
    readonly progression?: ArpeggioProgression;
    readonly rhythm?: ArpeggioRhythm;
    /** Restrict progression chords to these degrees (empty = all 7).
     *  The first bar always uses `degree` if it is in the selection. */
    readonly chordSelection?: readonly ArpeggioDegree[];
    /** Seed for progression selection (deterministic). */
    readonly seed?: number;
}

/** Degree index (0-based) into the scale for each arpeggio degree label. */
const DEGREE_INDEX: Record<ArpeggioDegree, number> = {
    I: 0, ii: 1, iii: 2, IV: 3, V: 4, vi: 5, 'vii0': 6,
};

export const ARPEGGIO_DEGREE_LABELS: Record<ArpeggioDegree, string> = {
    I: 'I', ii: 'ii', iii: 'iii', IV: 'IV', V: 'V', vi: 'vi', 'vii0': 'vii°',
};

export const PATTERN_LABELS: Record<ArpeggioPattern, string> = {
    up: 'Up', down: 'Down', updown: 'Up & down', '1235': '1-2-3-5',
    '1321': '1-3-2-1',
    '1325': '1-3-2-5(8)',
    '1535': '1-5-3-5(8)',
    '12353': '1-2-3-5-3',
};

/**
 * Giuliani figures — NOTE sequences (not fingerings): the thumb (p) always
 * takes the bass/root, the remaining notes ride the upper chord tones.
 * Indices into the octave cycle [0=root, 1=third, 2=fifth, 3=octave]; the
 * figure repeats with an ascending octave shift per repetition (the bass
 * stays in place — like the Maestoso studies).
 */
// Broken-chord figures — NOTE sequences on the cycle [0=root, 1=third,
// 2=fifth, 3=octave]; register ascends per repetition.
const BROKEN_FIGURES: Record<string, number[]> = {
    '1321': [0, 2, 1, 0],
    '1325': [0, 2, 1, 3],
    '1535': [0, 3, 2, 3],
    '12353': [0, 1, 2, 3, 2],
};

/** pc of a spelled degree (step letter + alter). */
const degreePc = (d: { step: StepLetter; alter: number }): number =>
    (LETTER_PC[STEP_LETTERS.indexOf(d.step)] + d.alter + 144) % 12;

/** Chord symbol name for a diatonic degree, e.g. "C", "Am", "Bdim". */
function chordNameFor(key: KeyContext, degreeIndex: number): string {
    const d = key.degrees[degreeIndex];
    const third = key.degrees[(degreeIndex + 2) % 7];
    const fifth = key.degrees[(degreeIndex + 4) % 7];
    const root = d.step + (d.alter < 0 ? 'b'.repeat(-d.alter) : '#'.repeat(d.alter));
    const thirdInterval = (degreePc(third) - degreePc(d) + 12) % 12;
    const fifthInterval = (degreePc(fifth) - degreePc(d) + 12) % 12;
    let suffix = '';
    if (thirdInterval === 3 && fifthInterval === 7) suffix = 'm';
    else if (thirdInterval === 3 && fifthInterval === 6) suffix = 'dim';
    return root + suffix;
}

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
        default: {
            // Giuliani figure: cycle [root, third, fifth, octave] with the
            // figure selecting cycle positions per note; the octave wraps so
            // e.g. p-i-m over C-E-G becomes C E G | C' E' G' ... (ascending
            // octave register shift every figure repetition).
            const figure = BROKEN_FIGURES[pattern];
            // 4-note cycle per octave: root, third, fifth, octave
            const cycleOct = (oct: number): number[] => [
                base[0] + 12 * oct, base[1] + 12 * oct, base[2] + 12 * oct, base[0] + 12 * (oct + 1),
            ];
            const path: number[] = [];
            for (let oct = 0; oct < octavesWanted; oct++) {
                const c = cycleOct(oct);
                for (const idx of figure) {
                    const note = c[idx];
                    if (note !== undefined && (oct === 0 || pool.includes(note))) path.push(note);
                }
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

    const bars = config.bars ?? 1;
    const pattern = config.pattern;
    const coverage = config.coverage;

    // ---- Chord sequence ----------------------------------------------------
    // Single-bar mode: the chosen degree for all bars (bars is 1).
    // Sequence mode: one chord per bar, chosen by progression rule.
    const degreeIndices: number[] = [];
    // Sequence chord pool: user selection (restricted to it) or all 7.
    const sel = (config.chordSelection ?? []).filter(d => d in DEGREE_INDEX).map(d => DEGREE_INDEX[d as ArpeggioDegree]);
    const pool7 = sel.length > 0 ? Array.from(new Set(sel)).sort((a, b) => a - b) : [0, 1, 2, 3, 4, 5, 6];
    if (bars === 1) {
        degreeIndices.push(DEGREE_INDEX[config.degree]);
    } else {
        const rng = makeRng(config.seed ?? 1);
        const pick = <T,>(arr: T[]): T => arr[Math.floor(rng() * arr.length)];
        for (let b = 0; b < bars; b++) {
            if (b === 0) {
                // First bar: a random chord FROM THE SELECTION — fixed starts
                // repeated the exercise identically every time.
                degreeIndices.push(pool7.includes(DEGREE_INDEX[config.degree]) && rng() < 0.34
                    ? DEGREE_INDEX[config.degree]
                    : pick(pool7));
                continue;
            }
            const prev = degreeIndices[b - 1];
            if (config.progression === 'diatonic-cycle') {
                // Next diatonic degree that is also in the selection
                let next = (prev + 1) % 7;
                for (let tries = 0; tries < 7 && !pool7.includes(next); tries++) next = (next + 1) % 7;
                degreeIndices.push(next);
            } else if (config.progression === 'functional') {
                // Simple tonal function rules (major-oriented; mirrored for
                // minor by degree relationships below):
                //   I   -> {IV, V, vi}
                //   ii  -> {V}
                //   iii -> {IV, vi}
                //   IV  -> {I, V}
                //   V   -> {I, vi}
                //   vi  -> {ii, IV}
                //   vii -> {I}
                const NEXT: Record<number, number[]> = {
                    0: [3, 4, 5],
                    1: [4],
                    2: [3, 5],
                    3: [0, 4],
                    4: [0, 5],
                    5: [1, 3],
                    6: [0],
                };
                // functional: honor the selection — filter rule targets by it
                const targets = (NEXT[prev] ?? [0]).filter(d => pool7.includes(d));
                degreeIndices.push(pick(targets.length > 0 ? targets : pool7.filter(d => d !== prev)));
            } else {
                // random: any selected degree, avoid immediate repetition
                const candidates = pool7.filter(d => d !== prev);
                degreeIndices.push(pick(candidates.length > 0 ? candidates : pool7));
            }
        }
    }

    // ---- Path per bar: one arpeggio cycle per chord -------------------------
    const full = config.meter.numerator * PPQ;
    const perBarSegments: { path: number[]; degreeIndex: number }[] = [];
    for (const di of degreeIndices) {
        const path = buildPath(key, di, pool, coverage, pattern);
        if (!path || path.length === 0) {
            return {
                ok: false,
                error: 'The arpeggio does not fit the playable range — widen the range (strings/fret window) or pick another degree.',
            };
        }
        perBarSegments.push({ path, degreeIndex: di });
    }

    // ---- Events: fit each segment into one bar ------------------------------
    const rhythm = config.rhythm ?? 'quarters';
    const events: ScoreEvent[] = [];
    const chordSymbols: (string | null)[] = [];
    let cursor = 0;
    for (let b = 0; b < bars; b++) {
        const { path, degreeIndex } = perBarSegments[b];
        chordSymbols.push(chordNameFor(key, degreeIndex));
        if (bars === 1) {
            // Single-bar mode (v1 behavior): whole path, final note extended
            // to fill the bar — or, when the path overflows one bar, spread
            // over the needed bars with the overflow in the last note.
            const barCount = Math.max(1, Math.ceil((path.length * PPQ) / full));
            const totalTicks = barCount * full;
            const lastDuration = PPQ + (totalTicks - path.length * PPQ);
            path.forEach((midi, n) => {
                const spelled = spellInKey(key, midi);
                if (!spelled) return;
                const dur = n === path.length - 1 ? lastDuration : PPQ;
                events.push({ id: `a${b}-${n}`, startTick: cursor, durationTicks: dur, pitch: { midi, ...spelled } });
                cursor += dur;
            });
            continue;
        }
        // Sequence mode: fit the bar exactly. 'quarters': one note per beat,
        // cycling up/down through the path. 'eighths': two notes per beat.
        const slots = rhythm === 'quarters' ? 1 : 2;
        const notesPerBar = config.meter.numerator * slots;
        const line: number[] = [];
        let dir = 1;
        let lastIdx = 0;
        while (line.length < notesPerBar) {
            line.push(path[lastIdx]);
            if (lastIdx + dir < 0 || lastIdx + dir >= path.length) dir = -dir;
            else lastIdx += dir;
        }
        const noteDur = full / notesPerBar;
        line.forEach((midi, n) => {
            const spelled = spellInKey(key, midi);
            if (!spelled) return;
            events.push({
                id: `a${b}-${n}`,
                startTick: cursor,
                durationTicks: noteDur,
                pitch: { midi, ...spelled },
            });
            cursor += noteDur;
        });
    }

    const chordName = `${key.tonic} ${ARPEGGIO_DEGREE_LABELS[config.degree]}`;
    const patternLabel = PATTERN_LABELS[config.pattern];
    // Single-bar paths can overflow into extra bars (updown/two-octave);
    // sequence mode always has exactly `bars` measures.
    const totalMeasures = bars === 1 ? Math.max(1, Math.ceil((cursor) / full)) : bars;
    const title = bars === 1
        ? `Arpeggio — ${chordName} (${patternLabel}, ${coverage})`
        : `Arpeggio — ${key.tonic}: ${bars} bars (${config.progression ?? 'functional'})`;
    const score: Score = {
        version: 1,
        id: `arpeggio-${config.keyTonic}-${config.keyMode}-${config.degree}-${config.pattern}-${config.coverage}-${bars}b-${config.progression ?? 'single'}-${config.seed ?? 0}`,
        title,
        meter: config.meter,
        key: { tonic: config.keyTonic, mode: config.keyMode, signature: key.signature },
        measures: Array.from({ length: totalMeasures }, (_, i) => ({
            number: i + 1,
            startTick: i * full,
            durationTicks: full,
        })),
        chordSymbols: bars === 1
            // repeat the single chord symbol across the overflow bars
            ? Array.from({ length: totalMeasures }, () => chordSymbols[0])
            : chordSymbols,
        voices: [{ id: 'melody', events }],
    };
    const problems = validateScore(score);
    if (problems.length > 0) return { ok: false, error: `Internal arpeggio error: ${problems[0]}` };
    return { ok: true, value: score };
}
