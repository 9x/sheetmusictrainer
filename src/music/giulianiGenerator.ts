/**
 * Giuliani study generator (Phrase Mode material) — its own category
 * because the figures require a REAL guitar voicing: the thumb takes the
 * bass (root on a lower string) and i/m/a ride higher strings. A figure is
 * only playable when each consecutive voice slot maps to a distinct string
 * with a valid fret in the playable pool — arbitrary chord arpeggios cannot
 * guarantee that.
 *
 * Voicing search: for a figure of voice-count V, pick a bass string (for
 * the root) and V-1 higher strings; each note of the cycle is placed on its
 * designated string at the fret matching the chord tone. Figure repeats
 * over the chord; every bar re-voices (deterministically) so sequences work.
 */
import { PPQ, validateScore, type Result, type Score, type ScoreEvent, STEP_LETTERS, LETTER_PC, type StepLetter } from '../score/model';
import { keyFor, type KeyContext, type ModeId } from './scales';
import { TUNINGS, type Tuning } from '../music/Tunings';
import { makeRng } from './melodyGenerator';

export type GiulianiPattern =
    | 'pim'      // Studies 1–20 feel: bass + two upper voices
    | 'pima'     // Studies 21–40: bass + three upper voices
    | 'pami'     // bass + descending upper voices
    | 'aim'      // upper voices first
    | 'pimamim'  // six-note rolling
    | 'pmamim'   // asymmetric
    | 'piai'     // bass + octave-third (wide spacing)
    | 'pmami'    // bass + fifth-octave-third
    | 'pimami'   // bass-third-fifth-third (waltz-like)
    | 'pimaia';  // bass with two upper-voice pairs

export const GIULIANI_PATTERN_LABELS: Record<GiulianiPattern, string> = {
    pim: 'p-i-m (3 voices)',
    pima: 'p-i-m-a (4 voices)',
    pami: 'p-a-m-i',
    aim: 'a-i-m',
    pimamim: 'p-i-m-a-m-i',
    pmamim: 'p-m-a-m-i-m',
    piai: 'p-i-a-i (wide)',
    pmami: 'p-m-a-m-i',
    pimami: 'p-i-m-a-m-i (waltz)',
    pimaia: 'p-i-m-a-i-a',
};

/** Figure voice slots per repetition (indices into the cycle [root, third, fifth, octave]). */
const FIGURES: Record<GiulianiPattern, number[]> = {
    pim: [0, 1, 2],
    pima: [0, 1, 2, 3],
    pami: [0, 3, 2, 1],
    aim: [0, 3, 1],
    pimamim: [0, 1, 2, 3, 2, 1],
    pmamim: [0, 2, 3, 2, 1, 2],
    piai: [0, 1, 3, 1],
    pmami: [0, 2, 3, 2, 1],
    pimami: [0, 1, 2, 3, 2],
    pimaia: [0, 1, 2, 3, 1, 3],
};

export interface GiulianiConfig {
    readonly keyTonic: string;
    readonly keyMode: ModeId;
    readonly pattern: GiulianiPattern;
    readonly meter: { readonly numerator: 3 | 4 | 6; readonly denominator: 4 };
    readonly tuningId: string;
    /** Bars (one chord per bar). */
    readonly bars: number;
    /** Chord degrees allowed (empty = all 7). */
    readonly chordSelection: readonly string[];
    /** Seed for chord sequence + voicing choices. */
    readonly seed: number;
    /** Deterministic pattern from the practice filter (strings restriction). */
    readonly allowedStrings: readonly number[];
}

const DEGREE_INDEX: Record<string, number> = { I: 0, ii: 1, iii: 2, IV: 3, V: 4, vi: 5, 'vii0': 6 };

const degreePc = (d: { step: StepLetter; alter: number }): number =>
    (LETTER_PC[STEP_LETTERS.indexOf(d.step)] + d.alter + 144) % 12;

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

interface ChordTone { readonly pc: number; readonly step: StepLetter; readonly alter: number }

/** Diatonic triad pcs for a degree, spelled. */
function triadPcs(key: KeyContext, degreeIndex: number): ChordTone[] {
    return [0, 2, 4].map(o => key.degrees[(degreeIndex + o) % 7]).map(d => ({
        pc: degreePc(d), step: d.step, alter: d.alter,
    }));
}

/**
 * Voice a figure bar: assign each cycle position (root/third/fifth/octave)
 * to a string with a valid fret, bass string lowest. Returns per-slot
 * {stringIndex, fret, midi} or null when impossible with the allowed strings.
 */
function voiceBar(
    tuning: Tuning,
    chord: ChordTone[],
    pattern: GiulianiPattern,
    allowedStrings: number[],
): { stringIndex: number; fret: number; midi: number }[] | null {
    const figure = FIGURES[pattern];
    const maxVoice = Math.max(...figure) + 1; // e.g. 3 for p-i-m, 4 for p-i-m-a
    const bassPc = chord[0].pc;

    // Candidate strings sorted low→high for the bass; upper voices fill above.
    const strings = tuning.strings.map((open, idx) => ({ open, idx }));
    const sorted = [...strings].sort((a, b) => a.open - b.open);
    const usable = sorted.filter(s => allowedStrings.length === 0 || allowedStrings.includes(s.idx));

    const octavePcs = [...chord.map(c => c.pc), (chord[0].pc + 12) % 12];
    // cyclePcs[i] = pitch class of cycle position i
    const cyclePcs = octavePcs;

    const bassCandidates = usable.filter(s => {
        // bass must be able to reach the root within 12 frets
        for (let fret = 0; fret <= 12; fret++) {
            if (((s.open + fret) % 12 + 12) % 12 === bassPc) return true;
        }
        return false;
    });

    for (const bass of bassCandidates) {
        // assign remaining voices to strings above the bass
        const uppers = usable.filter(s => s.open > bass.open).slice(0, maxVoice - 1);
        if (uppers.length < maxVoice - 1) continue;
        // Voice slots: cycle positions 1..maxVoice-1 map to uppers in order
        const slotStrings: ({ open: number; idx: number } | null)[] = [bass];
        for (let v = 1; v < maxVoice; v++) slotStrings.push(uppers[v - 1]);

        let ok = true;
        const placement: { stringIndex: number; fret: number; midi: number }[] = [];
        const usedFrets = new Set<string>();
        for (let slot = 0; slot < maxVoice; slot++) {
            const pc = cyclePcs[slot];
            const s = slotStrings[slot];
            if (!s) { ok = false; break; }
            let found: number | null = null;
            for (let fret = 0; fret <= 12; fret++) {
                if ((((s.open + fret) % 12) + 12) % 12 === pc) { found = fret; break; }
            }
            if (found === null) { ok = false; break; }
            const midi = s.open + found;
            const key = `${slot}:${found}`;
            if (usedFrets.has(key)) { ok = false; break; } // same string double-stop — not for these studies
            usedFrets.add(key);
            placement.push({ stringIndex: s.idx, fret: found, midi });
        }
        if (ok) return placement;
    }
    return null;
}

export function generateGiulianiStudy(
    config: GiulianiConfig,
    eligiblePitches: number[],
): Result<Score> {
    const tuning = TUNINGS[config.tuningId];
    if (!tuning) return { ok: false, error: 'No tuning available for Giuliani studies — pick a fretted instrument.' };
    const key = keyFor(config.keyTonic, config.keyMode);

    const poolSet = new Set(eligiblePitches.filter(m => Number.isInteger(m)));
    if (poolSet.size === 0) return { ok: false, error: 'No playable notes in the selected range — widen the note set.' };

    const rng = makeRng(config.seed);
    const pick = <T,>(arr: T[]): T => arr[Math.floor(rng() * arr.length)];

    // Chord sequence: random from selection (no immediate repeats)
    const sel = (config.chordSelection ?? []).filter(d => d in DEGREE_INDEX);
    const poolDegrees = (sel.length > 0 ? sel : Object.keys(DEGREE_INDEX)) as string[];
    const degreeIndices: number[] = [];
    for (let b = 0; b < config.bars; b++) {
        const prev = degreeIndices[b - 1];
        const candidates = poolDegrees
            .map(d => DEGREE_INDEX[d])
            .filter(di => di !== prev);
        degreeIndices.push(pick(candidates.length > 0 ? candidates : poolDegrees.map(d => DEGREE_INDEX[d])));
    }

    // Voice each bar; drop bars that cannot be voiced (rare with full pool).
    const full = config.meter.numerator * PPQ;
    const events: ScoreEvent[] = [];
    const chordSymbols: (string | null)[] = [];
    const usableBars: { degreeIndex: number; placement: ReturnType<typeof voiceBar> }[] = [];
    for (const di of degreeIndices) {
        const chord = triadPcs(key, di);
        const placement = voiceBar(tuning, chord, config.pattern, config.allowedStrings as number[]);
        if (!placement) continue;
        usableBars.push({ degreeIndex: di, placement });
    }
    if (usableBars.length === 0) {
        return { ok: false, error: 'No bar could be voiced with the current string selection — allow more strings or a lower fret window.' };
    }

    // Rhythm: one note per slot (figure repeats); one figure per beat.
    const figure = FIGURES[config.pattern];
    // Each figure repetition occupies one beat; repetitions per bar = meter.numerator.
    const notesPerBar = config.meter.numerator * figure.length;
    const noteDur = full / notesPerBar;

    let cursor = 0;
    for (let b = 0; b < usableBars.length; b++) {
        const { degreeIndex, placement } = usableBars[b];
        if (!placement) continue;
        chordSymbols.push(chordNameFor(key, degreeIndex));
        for (let beat = 0; beat < config.meter.numerator; beat++) {
            for (let f = 0; f < figure.length; f++) {
                const slot = figure[f];
                const note = placement[slot];
                if (!note) continue;
                // spelling via key degree of this pc
                const pc = ((note.midi % 12) + 12) % 12;
                const d = key.degrees.find(deg => degreePc(deg) === pc);
                if (!d) continue;
                const octave = (note.midi - pc) / 12 - 1;
                events.push({
                    id: `g${b}-${beat}-${f}`,
                    startTick: cursor,
                    durationTicks: noteDur,
                    pitch: { midi: note.midi, step: d.step, alter: d.alter, octave },
                });
                cursor += noteDur;
            }
        }
    }

    const totalBars = usableBars.length;
    const score: Score = {
        version: 1,
        id: `giuliani-${config.keyTonic}-${config.keyMode}-${config.pattern}-${config.bars}b-${config.seed}`,
        title: `Giuliani study — ${key.tonic} ${config.pattern} (${totalBars} bars)`,
        meter: config.meter,
        key: { tonic: config.keyTonic, mode: config.keyMode, signature: key.signature },
        measures: Array.from({ length: totalBars }, (_, i) => ({
            number: i + 1,
            startTick: i * full,
            durationTicks: full,
        })),
        chordSymbols,
        voices: [{ id: 'melody', events }],
    };
    const problems = validateScore(score);
    if (problems.length > 0) return { ok: false, error: `Internal giuliani error: ${problems[0]}` };
    return { ok: true, value: score };
}
