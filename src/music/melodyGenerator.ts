/**
 * Seeded melody generator (Phrase Mode).
 *
 * Deterministic: all randomness flows through a supplied seed so Retry can
 * replay the identical phrase (the trainer never regenerates) and tests can
 * assert invariants over many seeds (contract C3).
 *
 * Hard invariants (tested): every pitch ∈ scale ∩ playable pool, exact bar
 * totals, valid spelling, determinism, bounded loops.
 * Musical preferences (steps, small contours, tonic endings) are SOFT — a
 * sparse fretboard pool can make them impossible, and the generator must
 * still terminate and stay in the pool rather than escape its constraints.
 */
import { PPQ, validateScore, type Result, type Score, type ScoreEvent } from '../score/model';
import { keyFor, scalePitches, type ModeId } from './scales';

/** mulberry32 — small, fast, deterministic. */
export function makeRng(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export interface MelodyConfig {
    readonly keyTonic: string;
    readonly keyMode: ModeId;
    /** 1..8 */
    readonly bars: number;
    readonly meter: { readonly numerator: 3 | 4; readonly denominator: 4 };
    /** 1 = Simple (quarters/halves/wholes), 2 = Mixed (+ paired eighths, dotted quarters). */
    readonly rhythmLevel: 1 | 2;
    readonly seed: number;
}

// Rhythm templates in ticks (quarter = 480). Each template fills one full bar.
const TEMPLATES_4_L1: number[][] = [
    [480, 480, 480, 480],
    [960, 960],
    [480, 480, 960],
    [960, 480, 480],
    [480, 960, 480],
    [1920],
    [1440, 480],
];
const TEMPLATES_4_L2: number[][] = [
    [480, 480, 240, 240, 480],
    [240, 240, 480, 480, 480],
    [480, 480, 480, 240, 240],
    [720, 720, 480],
    [720, 480, 240, 240, 240],
];
const TEMPLATES_3_L1: number[][] = [
    [480, 480, 480],
    [960, 480],
    [480, 960],
    [1440],
];
const TEMPLATES_3_L2: number[][] = [
    [240, 240, 480, 480],
    [480, 240, 240, 480],
    [720, 720],
    [720, 240, 240, 240],
];

function templatesFor(meter: { numerator: 3 | 4 }, level: 1 | 2): number[][] {
    const base = meter.numerator === 4
        ? (level === 1 ? TEMPLATES_4_L1 : [...TEMPLATES_4_L1, ...TEMPLATES_4_L2])
        : (level === 1 ? TEMPLATES_3_L1 : [...TEMPLATES_3_L1, ...TEMPLATES_3_L2]);
    return base.filter(t => t.reduce((a, b) => a + b, 0) === meter.numerator * PPQ);
}

/** Motion weights by semitone distance (soft preference, contract C3). */
function motionWeight(delta: number, afterLeap: boolean, repeats: number): number {
    const ad = Math.abs(delta);
    if (delta === 0) return repeats >= 2 ? 0 : 6; // never more than two in a row
    if (ad <= 2) return afterLeap ? 240 : 70;      // steps (preferred, esp. after leaps)
    if (ad <= 4) return afterLeap ? 120 : 20;      // thirds
    if (ad <= 7) return 8;                         // fourth/fifth
    if (ad <= 12) return 2;                        // sixth/octave
    return 0;                                      // out of pool handled separately
}

export function generateMelody(
    config: MelodyConfig,
    eligiblePitches: number[],
): Result<{ score: Score; seed: number }> {
    const { bars, meter, rhythmLevel, seed } = config;
    if (!Number.isInteger(bars) || bars < 1 || bars > 8) {
        return { ok: false, error: 'Bars must be 1–8.' };
    }
    const key = keyFor(config.keyTonic, config.keyMode);

    const pool = Array.from(new Set(eligiblePitches.filter(m => Number.isInteger(m)))).sort((a, b) => a - b);
    if (pool.length === 0) return { ok: false, error: 'No playable notes in the selected range — widen the note set or change the key.' };
    const scale = scalePitches(key, pool[0], pool[pool.length - 1]).filter(p => pool.includes(p.midi));
    if (scale.length < 2) {
        return { ok: false, error: 'The selected range/key combination leaves fewer than two usable pitches — widen the range or change the key.' };
    }

    const templates = templatesFor(meter, rhythmLevel);
    const endingTemplates = templates.filter(t => t[t.length - 1] >= 960);
    const finalTemplates = endingTemplates.length > 0 ? endingTemplates : templates;

    const rng = makeRng(seed);
    const pick = <T,>(arr: T[]): T => arr[Math.floor(rng() * arr.length)];

    // ---- Build the rhythm (bar by bar) -------------------------------------
    const rhythm: number[] = [];
    for (let bar = 0; bar < bars; bar++) {
        const t = bar === bars - 1 ? finalTemplates : templates;
        rhythm.push(...pick(t));
    }

    // ---- Build the pitches -------------------------------------------------
    // Weighted random walk over the eligible scale notes with soft musical
    // preferences. Bounded: exactly one decision per rhythm slot.
    const tonicPc = key.pitchClasses[0];
    const thirdPc = key.pitchClasses[2];
    const fifthPc = key.pitchClasses[4];

    const events: ScoreEvent[] = [];
    let idx = Math.floor(rng() * scale.length); // start anywhere; endpoints preferred next
    // Preferred start: tonic, else 3rd/5th.
    const startCandidates = scale
        .map((p, i) => ({ p, i }))
        .filter(({ p }) => p.pitch.midi % 12 === tonicPc);
    if (startCandidates.length > 0) idx = pick(startCandidates).i;
    else {
        const alt = scale.map((p, i) => ({ p, i })).filter(({ p }) => [thirdPc, fifthPc].includes(p.pitch.midi % 12));
        if (alt.length > 0) idx = pick(alt).i;
    }

    let lastWasLeap = false;   // previous motion was a leap ≥ 5 semitones
    let leapFromMidi = 0;       // origin pitch of that leap (step-back target)
    let repeats = 0;
    let cursor = 0;
    for (let slot = 0; slot < rhythm.length; slot++) {
        const dur = rhythm[slot];
        const isFinal = slot === rhythm.length - 1;
        const cur = scale[idx];

        let chosen = idx;
        if (isFinal) {
            // Soft: end on tonic, else 3rd/5th, else nearest to current.
            const finals = scale.map((p, i) => ({ p, i })).filter(({ p }) => p.pitch.midi % 12 === tonicPc);
            const alt = scale.map((p, i) => ({ p, i })).filter(({ p }) => [thirdPc, fifthPc].includes(p.pitch.midi % 12));
            const cand = finals.length > 0 ? finals : alt;
            if (cand.length > 0) {
                chosen = pick(cand).i;
            }
        } else {
            const weights = scale.map((p, i) => {
                if (i === idx) return motionWeight(0, false, repeats);
                const delta = p.midi - cur.midi;
                let w = motionWeight(delta, lastWasLeap, repeats);
                // A leap (≥5) prefers a subsequent step back toward its origin.
                if (lastWasLeap && Math.abs(delta) <= 2) {
                    const stepBackToward = Math.sign(delta) === Math.sign(leapFromMidi - cur.midi) || leapFromMidi === cur.midi;
                    if (stepBackToward) w = Math.max(w, 240);
                }
                return w;
            });
            const total = weights.reduce((a, b) => a + b, 0);
            if (total > 0) {
                let r = rng() * total;
                for (let i = 0; i < weights.length; i++) {
                    r -= weights[i];
                    if (r <= 0) { chosen = i; break; }
                }
            } else {
                chosen = Math.floor(rng() * scale.length);
            }
        }

        const note = scale[chosen];
        const moved = Math.abs(note.midi - cur.midi);
        if (moved >= 5) { lastWasLeap = true; leapFromMidi = cur.midi; }
        else { lastWasLeap = false; leapFromMidi = 0; }
        if (note.midi === cur.midi) {
            if (!isFinal) repeats++;
        } else {
            repeats = 0;
        }

        events.push({
            id: `n${slot}`,
            startTick: cursor,
            durationTicks: dur,
            pitch: { ...note.pitch },
        });
        cursor += dur;
        idx = chosen;
    }

    const score: Score = {
        version: 1,
        id: `melody-${config.keyTonic}-${config.keyMode}-${meter.numerator}4-${bars}b-${rhythmLevel}-s${seed}`,
        title: `${key.tonic} ${key.degrees.length === 5 ? (config.keyMode === 'major-pentatonic' ? 'Major Pentatonic' : 'Minor Pentatonic') : 'Melody'}`,
        meter,
        key: { tonic: config.keyTonic, mode: config.keyMode, signature: key.signature },
        measures: Array.from({ length: bars }, (_, i) => ({
            number: i + 1,
            startTick: i * meter.numerator * PPQ,
            durationTicks: meter.numerator * PPQ,
        })),
        voices: [{ id: 'melody', events }],
    };
    const problems = validateScore(score);
    if (problems.length > 0) return { ok: false, error: `Internal generator error: ${problems[0]}` };
    return { ok: true, value: { score, seed } };
}
