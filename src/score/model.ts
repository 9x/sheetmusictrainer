/**
 * Normalized score model (Phrase Mode).
 *
 * Versioned, interchange-independent representation of a single-voice musical
 * line. Both the generators (melody/scale drills) and the ABC import adapter
 * produce it; the VexFlow renderer and the phrase matcher consume it — neither
 * ever sees raw ABC. This keeps a future MIDI/MusicXML adapter possible
 * without touching the trainer or renderer.
 *
 * Key decisions (see docs/PHRASE_MODE_IMPLEMENTATION.md, section B):
 * - Integer ticks at 480 per quarter note (PPQ). No floating beat arithmetic.
 * - Ties are ALWAYS pre-merged: one ScoreEvent = one required attack ("logical
 *   note"). The renderer re-splits such events into tied glyphs at barlines;
 *   the matcher and the summary count them exactly once.
 * - Pitches are stored SOUNDING, with preserved enharmonic spelling. The
 *   instrument display transpose is applied once, at render time only.
 * - Playback state (cursor, results, seed, ...) NEVER lives on the score.
 */

/** Ticks per quarter note. */
export const PPQ = 480;

/** Simple result wrapper used by generators and the import adapter. */
export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export const STEP_LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'] as const;
/** Sounding pitch class of each natural letter (C=0 ... B=11). */
export const LETTER_PC = [0, 2, 4, 5, 7, 9, 11] as const;
export type StepLetter = (typeof STEP_LETTERS)[number];

/** Written (notated) pitch with explicit enharmonic spelling. */
export interface SpelledPitch {
    /** Sounding MIDI note number (0..127). */
    readonly midi: number;
    readonly step: StepLetter;
    /** -2..2; 0 = natural, 1 = sharp, -1 = flat, ±2 = double. */
    readonly alter: number;
    /** Spelling octave: written midi = 12 * (octave + 1) + stepPc + alter. */
    readonly octave: number;
}

/** One required attack (a "logical note"); null pitch = rest. */
export interface ScoreEvent {
    /** Stable identity through rendering/retries (unique within a score). */
    readonly id: string;
    readonly startTick: number;
    readonly durationTicks: number;
    readonly pitch: SpelledPitch | null;
}

export interface ScoreMeasure {
    /** 1-based original bar number (kept through slicing for orientation). */
    readonly number: number;
    readonly startTick: number;
    readonly durationTicks: number;
}

export interface ScoreKey {
    /** Tonic spelling as displayed, e.g. "C", "F#", "Bb". */
    readonly tonic: string;
    /** Mode id, e.g. "major", "minor", "dorian", "major-pentatonic". */
    readonly mode: string;
    /** Parent major key signature name for notation (e.g. "Bb" for G minor). */
    readonly signature: string;
}

export interface ScoreSource {
    readonly composer?: string;
    readonly work?: string;
    /** Identification of the exact part (exercise number, measures, ...). */
    readonly locator?: string;
    readonly url?: string;
    /** Rights of BOTH source work and this transcription. */
    readonly rights: string;
    /** What was changed relative to the source, if anything. */
    readonly adaptation?: string;
    /**
     * Semitones from WRITTEN source pitch to sounding pitch that the import
     * already applied (e.g. -12 for explicit guitar-convention input).
     * Renderer/matching still operate on the stored sounding `midi`.
     */
    readonly writtenToSoundingSemitones?: number;
}

export interface Score {
    readonly version: 1;
    readonly id: string;
    readonly title: string;
    readonly meter: { readonly numerator: 3 | 4; readonly denominator: 4 };
    readonly key: ScoreKey;
    readonly measures: ScoreMeasure[];
    /** Exactly one voice in v1. */
    readonly voices: ReadonlyArray<{ readonly id: 'melody'; readonly events: ScoreEvent[] }>;
    /** Optional chord symbol per bar index (0-based), e.g. "C", "Am", "G7".
     *  Rendered above the staff; absent = no symbol for that bar. */
    readonly chordSymbols?: ReadonlyArray<string | null>;
    readonly source?: ScoreSource;
}

export const FULL_MEASURE_TICKS = (meter: { numerator: number }): number =>
    meter.numerator * PPQ;

export function scoreEvents(score: Score): ScoreEvent[] {
    return score.voices[0]?.events ?? [];
}

export function totalDurationTicks(score: Score): number {
    const events = scoreEvents(score);
    if (events.length === 0) return 0;
    const last = events[events.length - 1];
    return last.startTick + last.durationTicks;
}

/**
 * Structural validation. Returns a list of problems (empty = valid).
 * Imported and generated scores both pass through this before use.
 */
export function validateScore(score: Score): string[] {
    const problems: string[] = [];
    const events = scoreEvents(score);
    const full = FULL_MEASURE_TICKS(score.meter);

    if (score.voices.length !== 1) problems.push('expected exactly one voice');
    if (score.measures.length === 0) problems.push('score has no measures');

    let expectedStart = 0;
    for (const e of events) {
        if (!Number.isInteger(e.startTick) || e.startTick < 0) {
            problems.push(`event ${e.id}: invalid startTick ${e.startTick}`);
        }
        if (!Number.isInteger(e.durationTicks) || e.durationTicks <= 0) {
            problems.push(`event ${e.id}: invalid durationTicks ${e.durationTicks}`);
        }
        if (e.startTick !== expectedStart) {
            problems.push(`event ${e.id}: expected start ${expectedStart}, got ${e.startTick} (events must be contiguous)`);
        }
        expectedStart = e.startTick + e.durationTicks;
        if (e.pitch) {
            const { midi, step, alter, octave } = e.pitch;
            if (!Number.isInteger(midi) || midi < 0 || midi > 127) {
                problems.push(`event ${e.id}: midi ${midi} out of range`);
            }
            if (alter < -2 || alter > 2) {
                problems.push(`event ${e.id}: alter ${alter} out of range`);
            }
            const written = 12 * (octave + 1) + (LETTER_PC[STEP_LETTERS.indexOf(step)] + alter);
            if (written % 12 !== ((midi % 12) + 12) % 12) {
                problems.push(`event ${e.id}: spelling does not match midi (${step}${alter || ''} octave ${octave} vs midi ${midi})`);
            }
        }
    }

    for (const m of score.measures) {
        if (!Number.isInteger(m.startTick) || m.startTick < 0) {
            problems.push(`measure ${m.number}: invalid startTick`);
        }
        if (m.startTick % full !== 0 && m.durationTicks >= full) {
            // Only pickups/closers may be misaligned; flagged via duration below.
        }
    }

    // Measure durations: all full, or first+last complement each other.
    if (score.measures.length > 0) {
        const first = score.measures[0];
        const last = score.measures[score.measures.length - 1];
        const others = score.measures.slice(1, -1);
        for (const m of others) {
            if (m.durationTicks !== full) {
                problems.push(`measure ${m.number}: ${m.durationTicks} ticks (expected ${full} for ${score.meter.numerator}/4)`);
            }
        }
        if (score.measures.length === 1 && first.durationTicks !== full) {
            problems.push(`measure ${first.number}: single measure must be full`);
        }
        if (score.measures.length > 1) {
            if (first.durationTicks !== full && last.durationTicks !== full && first.durationTicks + last.durationTicks !== full) {
                problems.push(
                    `pickup/final measures must be full or complement (${first.durationTicks} + ${last.durationTicks} != ${full})`
                );
            }
            if (first.durationTicks === full && last.durationTicks !== full) {
                // A short final bar without a pickup is only valid if it complements... reject.
                problems.push(`final measure ${last.number} is short but there is no pickup measure`);
            }
        }
        // Contiguity of measures.
        let mStart = 0;
        for (const m of score.measures) {
            if (m.startTick !== mStart) {
                problems.push(`measure ${m.number}: expected start ${mStart}, got ${m.startTick}`);
            }
            mStart += m.durationTicks;
        }
        // The last measure must end exactly at the last event's end.
        const endTick = mStart;
        if (events.length > 0 && endTick !== expectedStart) {
            problems.push(`events end at ${expectedStart} but measures end at ${endTick}`);
        }
    }

    // Monophonic by construction (contiguity above covers overlap). Rests-only:
    if (events.length === 0 || events.every(e => e.pitch === null)) {
        problems.push('score contains no playable notes');
    }
    return problems;
}

/**
 * Extract a practice range: measures [startBar, startBar+barCount).
 * Events overlapping the range are clipped and rebased to tick 0; a tie
 * entering the range becomes a fresh attack (its clipped fragment), exactly
 * as specified in the contract. Original bar numbers are preserved.
 */
export function sliceScore(score: Score, startBar: number, barCount: number): Score {
    const total = score.measures.length;
    const from = Math.max(1, Math.min(startBar, total));
    const count = Math.max(1, Math.min(barCount, total - from + 1));
    const measures = score.measures.slice(from - 1, from - 1 + count);
    if (measures.length === 0) return { ...score, measures: [], voices: [{ id: 'melody', events: [] }] };

    const startTick = measures[0].startTick;
    const endTick = measures[measures.length - 1].startTick + measures[measures.length - 1].durationTicks;

    const events: ScoreEvent[] = [];
    for (const e of scoreEvents(score)) {
        const eStart = e.startTick;
        const eEnd = e.startTick + e.durationTicks;
        if (eEnd <= startTick || eStart >= endTick) continue;
        const clippedStart = Math.max(eStart, startTick);
        const clippedEnd = Math.min(eEnd, endTick);
        events.push({
            ...e,
            startTick: clippedStart - startTick,
            durationTicks: clippedEnd - clippedStart,
        });
    }

    return {
        ...score,
        id: `${score.id}:${from}+${count}`,
        measures: measures.map(m => ({ ...m, startTick: m.startTick - startTick })),
        voices: [{ id: 'melody', events }],
    };
}

/** True when every event of `score` lies inside the sorted pitch pool. */
export function scoreFitsPool(score: Score, pool: number[]): boolean {
    const set = new Set(pool);
    return scoreEvents(score).every(e => e.pitch === null || set.has(e.pitch.midi));
}
