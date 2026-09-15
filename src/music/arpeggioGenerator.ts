/**
 * Arpeggio generator (Phrase Mode material).
 *
 * Diatonic triads (I, ii, iii, IV, V, vi, vii°) built from the selected
 * key/mode; each practice run arpeggiates ONE chord — the user picks the
 * degree, the pattern (up / down / up-down / 1-2-3-5) and the coverage
 * (one or two octaves). Chord tones are spelled via the key's degree
 * spelling (same machinery as melody/scale generators), so spelling and
 * validation match the Phrase Mode invariants exactly.
 *
 * Arpeggio mode is ALWAYS eighths (240 ticks per note). Meter is auto-derived
 * from the pattern length — the user no longer picks rhythm or meter.
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
    | '12353'  // root-third-fifth-octave-fifth
    | '121321' // rolling thirds (root-third-root-fifth-third-root)
    | '1353'   // root-third-fifth-third
    | '15453'  // root-octave-fifth-octave-fifth-octave
    | '132532' // long broken-chord wave
    | 'custom'; // user-defined pattern from customPattern digits
export type ArpeggioCoverage = 'one-octave' | 'two-octave';
/** How the chord per bar is chosen in sequence mode. */
export type ArpeggioProgression = 'random' | 'functional' | 'diatonic-cycle';

export interface ArpeggioConfig {
    readonly keyTonic: string;
    readonly keyMode: ModeId;
    readonly degree: ArpeggioDegree;
    readonly pattern: ArpeggioPattern;
    readonly coverage: ArpeggioCoverage;
    /** Sequence mode: bars > 1 with chord progression selection. */
    readonly bars?: number;
    readonly progression?: ArpeggioProgression;
    /** Restrict progression chords to these degrees (empty = all 7).
     *  The first bar always uses `degree` if it is in the selection. */
    readonly chordSelection?: readonly ArpeggioDegree[];
    /** Seed for progression selection (deterministic). */
    readonly seed?: number;
    /** User-defined custom pattern digits (1-indexed: 1=root, 2=third, 3=fifth,
     *  4=octave, 5=fifth-above-octave). Only used when pattern === 'custom'. */
    readonly customPattern?: string;
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
    '121321': '1-2-1-3-2-1',
    '1353': '1-3-5-3',
    '15453': '1-5-4-5-3-5',
    '132532': '1-3-2-5-3-2',
    'custom': 'Custom…',
};

/**
 * Broken-chord figures — NOTE sequences (not fingerings): the bass takes the
 * root, the remaining notes ride the upper chord tones.
 * Indices into the octave cycle [0=root, 1=third, 2=fifth, 3=octave].
 */
const BROKEN_FIGURES: Record<string, number[]> = {
    '1321': [0, 2, 1, 0],
    '1325': [0, 2, 1, 3],
    '1535': [0, 3, 2, 3],
    '12353': [0, 1, 2, 3, 2],
    '121321': [0, 1, 0, 2, 1, 0],
    '1353': [0, 1, 2, 1],
    '15453': [0, 3, 2, 3, 2, 3],
    '132532': [0, 2, 1, 3, 2, 1],
};

/**
 * Renderable note durations — subset of VexFlow duration codes the
 * PhraseSheetMusic renderer accepts. ALL generated durations MUST be in this
 * set, otherwise the renderer produces ghost slots and crashes or misaligns.
 */
const RENDERABLE_NOTE_TICKS = new Set([120, 240, 360, 480, 720, 960, 1440, 1920]);

/** Descending renderable durations for rest fills (largest first). */
const REST_FILL_TICKS = [1920, 1440, 960, 720, 480, 240];

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
 * Auto-derive a meter (3/4 or 4/4) from the number of eighths in the phrase.
 * Always returns 3/4 or 4/4 — 6/8 is never used for arpeggios since it can
 * produce non-renderable tick sizes with some pattern lengths.
 *
 * For N notes at 240 ticks each:
 *   Try 4/4: bars4 = ceil(N*240 / 1920), remainder4 = bars4*1920 - N*240
 *   Try 3/4: bars3 = ceil(N*240 / 1440), remainder3 = bars3*1440 - N*240
 *   Pick the one with smaller remainder (fewer bars as tiebreaker).
 */
export function autoArpeggioMeter(noteCount: number): { numerator: 4 | 3; denominator: 4 } {
    const totalTicks = noteCount * 240;
    const bars4 = Math.ceil(totalTicks / 1920);
    const remainder4 = bars4 * 1920 - totalTicks;
    const bars3 = Math.ceil(totalTicks / 1440);
    const remainder3 = bars3 * 1440 - totalTicks;

    if (remainder3 < remainder4) return { numerator: 3, denominator: 4 };
    if (remainder4 < remainder3) return { numerator: 4, denominator: 4 };
    // equal remainders → prefer fewer bars
    return bars3 <= bars4 ? { numerator: 3, denominator: 4 } : { numerator: 4, denominator: 4 };
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
            // Broken-chord figure: cycle [root, third, fifth, octave] with the
            // figure selecting cycle positions per note; the octave wraps so
            // e.g. 1321 over C-E-G becomes C G E C' ... (ascending octave
            // register shift every figure repetition).
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

/**
 * Parse custom pattern digits into cycle indices (0-based).
 * Digits are 1-indexed: 1=root, 2=third, 3=fifth, 4=octave, 5=fifth-above-octave.
 * Returns null for empty/invalid input.
 */
function parseCustomPattern(digits: string): number[] | null {
    if (!digits || digits.trim().length === 0) return null;
    const result: number[] = [];
    for (const ch of digits.trim()) {
        const n = parseInt(ch, 10);
        if (isNaN(n) || n < 1 || n > 5) return null;
        // Map 1→0 (root), 2→1 (third), 3→2 (fifth), 4→3 (octave), 5→4 (fifth above octave)
        result.push(n - 1);
    }
    return result.length > 0 ? result : null;
}

/**
 * Build a custom path from 0-based digit indices using the one-octave cycle
 * [root, third, fifth, octave] (index 4 = fifth above the octave).
 */
function buildCustomPath(
    base: number[],
    pattern: number[],
    octavesWanted: number,
    pool: number[],
): number[] | null {
    const cycleOct = (oct: number): number[] => [
        base[0] + 12 * oct, base[1] + 12 * oct, base[2] + 12 * oct, base[0] + 12 * (oct + 1),
    ];

    const path: number[] = [];
    for (let oct = 0; oct < octavesWanted; oct++) {
        const c = cycleOct(oct);
        // Extend the cycle for digit 5: fifth above the octave (+7 semitones).
        const extended = [...c, c[3] + 7];
        for (const idx of pattern) {
            const note = extended[idx];
            if (note === undefined) continue;
            if (oct > 0 && !pool.includes(note)) continue;
            path.push(note);
        }
    }
    return path.length > 0 ? path : null;
}

/**
 * Build the path for one chord (degree), honouring built-in patterns and the
 * user-defined custom pattern. Returns null when the chord cannot be voiced
 * in the playable pool.
 */
function pathForChord(
    key: KeyContext,
    degreeIndex: number,
    pool: number[],
    coverage: ArpeggioCoverage,
    pattern: ArpeggioPattern,
    customDigits: number[] | null,
): number[] | null {
    if (pattern === 'custom') {
        if (!customDigits) return null;
        const tones = chordTonesInPool(key, degreeIndex, pool);
        if (tones.length < 3) return null;
        const rootPc = degreePc(key.degrees[degreeIndex]);
        const roots = tones.filter(m => ((m % 12) + 12) % 12 === rootPc);
        const octavesWanted = coverage === 'one-octave' ? 1 : 2;
        for (const root of roots) {
            // chord tones >= root within one octave, including the octave
            const cycle: number[] = [];
            for (const midi of tones) {
                if (midi >= root && midi <= root + 12) cycle.push(midi);
            }
            if (!cycle.includes(root + 12) && pool.includes(root + 12)) cycle.push(root + 12);
            cycle.sort((a, b) => a - b);
            if (cycle.length < 3 || cycle[0] !== root) continue;
            const p = buildCustomPath(cycle, customDigits, octavesWanted, pool);
            if (p) return p;
        }
        return null;
    }
    return buildPath(key, degreeIndex, pool, coverage, pattern);
}

/**
 * Emit one eighth-note event with key-aware spelling.
 * Returns false when the midi note cannot be spelled in this key.
 */
function pushNote(
    events: ScoreEvent[],
    key: KeyContext,
    midi: number,
    startTick: number,
    id: string,
): boolean {
    const spelled = spellInKey(key, midi);
    if (!spelled) return false;
    events.push({
        id,
        startTick,
        durationTicks: 240,
        pitch: { midi, ...spelled },
    });
    return true;
}

/**
 * Fill the tail of the material (after the last note) with rests built from
 * RENDERABLE durations only. Splits the gap greedily, largest duration first.
 */
function pushRestFill(events: ScoreEvent[], fromTick: number, untilTick: number): void {
    let cursor = fromTick;
    while (cursor < untilTick) {
        const gap = untilTick - cursor;
        const dur = REST_FILL_TICKS.find(d => d <= gap);
        if (!dur) break; // gap smaller than an eighth — should not happen
        events.push({
            id: `r${events.length}`,
            startTick: cursor,
            durationTicks: dur,
            pitch: null, // rest
        });
        cursor += dur;
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
    const degreeIndices: number[] = [];
    const sel = (config.chordSelection ?? []).filter(d => d in DEGREE_INDEX).map(d => DEGREE_INDEX[d as ArpeggioDegree]);
    const pool7 = sel.length > 0 ? Array.from(new Set(sel)).sort((a, b) => a - b) : [0, 1, 2, 3, 4, 5, 6];
    if (bars === 1) {
        degreeIndices.push(DEGREE_INDEX[config.degree]);
    } else {
        const rng = makeRng(config.seed ?? 1);
        const pick = <T,>(arr: T[]): T => arr[Math.floor(rng() * arr.length)];
        for (let b = 0; b < bars; b++) {
            if (b === 0) {
                degreeIndices.push(pool7.includes(DEGREE_INDEX[config.degree]) && rng() < 0.34
                    ? DEGREE_INDEX[config.degree]
                    : pick(pool7));
                continue;
            }
            const prev = degreeIndices[b - 1];
            if (config.progression === 'diatonic-cycle') {
                let next = (prev + 1) % 7;
                for (let tries = 0; tries < 7 && !pool7.includes(next); tries++) next = (next + 1) % 7;
                degreeIndices.push(next);
            } else if (config.progression === 'functional') {
                const NEXT: Record<number, number[]> = {
                    0: [3, 4, 5],
                    1: [4],
                    2: [3, 5],
                    3: [0, 4],
                    4: [0, 5],
                    5: [1, 3],
                    6: [0],
                };
                const targets = (NEXT[prev] ?? [0]).filter(d => pool7.includes(d));
                degreeIndices.push(pick(targets.length > 0 ? targets : pool7.filter(d => d !== prev)));
            } else {
                const candidates = pool7.filter(d => d !== prev);
                degreeIndices.push(pick(candidates.length > 0 ? candidates : pool7));
            }
        }
    }

    // ---- Custom pattern digits (only for pattern === 'custom') --------------
    const customDigits = pattern === 'custom' ? parseCustomPattern(config.customPattern ?? '') : null;
    if (pattern === 'custom' && !customDigits) {
        return { ok: false, error: 'Custom pattern is empty or invalid — enter digits like "1321" (1=root, 2=third, 3=fifth, 4=octave).' };
    }

    // ---- Build the path for the first chord ----------------------------------
    // All bars share the same pattern, so the path length (and thus meter) is
    // derived from the first chord's voicing. Sequence mode repeats the path
    // within each bar, so the meter also derives from the path length itself.
    const firstPath = pathForChord(key, degreeIndices[0], pool, coverage, pattern, customDigits);
    if (!firstPath || firstPath.length === 0) {
        return {
            ok: false,
            error: 'The arpeggio does not fit the playable range — widen the range (strings/fret window) or pick another degree.',
        };
    }
    const meter = autoArpeggioMeter(firstPath.length);
    const notesPerBar = meter.numerator * 2; // 2 eighths per beat
    const barLength = meter.numerator * PPQ;
    const noteDur = 240; // always eighths

    // ---- Events: single-chord vs sequence mode --------------------------------
    const events: ScoreEvent[] = [];
    const chordSymbols: (string | null)[] = [];

    if (bars === 1) {
        // Single-chord mode: the path plays once; any remaining ticks in the
        // final bar(s) become rests (renderable durations only). The path is
        // NEVER stretched — durations stay at 240 ticks.
        const barCount = Math.max(1, Math.ceil((firstPath.length * noteDur) / barLength));
        chordSymbols.push(chordNameFor(key, degreeIndices[0]));

        let cursor = 0;
        for (let slot = 0; slot < firstPath.length; slot++) {
            pushNote(events, key, firstPath[slot], cursor, `a0-${slot}`);
            cursor += noteDur;
        }
        const totalTicks = barCount * barLength;
        if (cursor < totalTicks) pushRestFill(events, cursor, totalTicks);
    } else {
        // Sequence mode: one chord per bar, each bar holds exactly
        // `notesPerBar` eighths (the path cycles if it is shorter, and is
        // truncated if longer — with two-octave coverage the auto-derived
        // meter always gives enough room).
        let cursor = 0;
        for (let b = 0; b < bars; b++) {
            const di = degreeIndices[b];
            chordSymbols.push(chordNameFor(key, di));
            const barPath = pathForChord(key, di, pool, coverage, pattern, customDigits);
            if (!barPath || barPath.length === 0) {
                return { ok: false, error: `Cannot voice arpeggio for chord ${chordNameFor(key, di)}.` };
            }
            for (let n = 0; n < notesPerBar; n++) {
                pushNote(events, key, barPath[n % barPath.length], cursor, `a${b}-${n}`);
                cursor += noteDur;
            }
        }
    }

    // ---- Validate all durations are renderable -----------------------------
    for (const e of events) {
        if (!RENDERABLE_NOTE_TICKS.has(e.durationTicks)) {
            return { ok: false, error: `Internal arpeggio error: non-renderable duration ${e.durationTicks} at ${e.id}.` };
        }
    }

    const chordName = `${key.tonic} ${ARPEGGIO_DEGREE_LABELS[config.degree]}`;
    const patternLabel = PATTERN_LABELS[config.pattern];
    const totalMeasures = Math.max(1, Math.ceil(events.reduce((s, e) => Math.max(s, e.startTick + e.durationTicks), 0) / barLength));
    const title = bars === 1
        ? `Arpeggio — ${chordName} (${patternLabel}, ${coverage})`
        : `Arpeggio — ${key.tonic}: ${bars} bars (${config.progression ?? 'functional'})`;
    const score: Score = {
        version: 1,
        id: `arpeggio-${config.keyTonic}-${config.keyMode}-${config.degree}-${config.pattern}-${config.coverage}-${bars}b-${config.progression ?? 'single'}-${config.seed ?? 0}`,
        title,
        meter,
        key: { tonic: config.keyTonic, mode: config.keyMode, signature: key.signature },
        measures: Array.from({ length: totalMeasures }, (_, i) => ({
            number: i + 1,
            startTick: i * barLength,
            durationTicks: barLength,
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