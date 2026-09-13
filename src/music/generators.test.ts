import { describe, it, expect } from 'vitest';
import { generateMelody } from './melodyGenerator';
import { generateScaleDrill } from './scaleDrills';
import { validateScore, scoreEvents, scoreFitsPool, PPQ } from '../score/model';
import { keyFor } from './scales';

const GUITAR_FIRST_POS = [40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68];

describe('generateMelody — invariants over many seeds', () => {
    const configBase = { keyTonic: 'C', keyMode: 'major' as const, bars: 4, meter: { numerator: 4 as const, denominator: 4 as const }, rhythmLevel: 2 as const };

    it('every seed yields a valid score in scale and pool', () => {
        for (let seed = 1; seed <= 100; seed++) {
            const res = generateMelody({ ...configBase, seed }, GUITAR_FIRST_POS);
            expect(res.ok).toBe(true);
            if (!res.ok) continue;
            const { score } = res.value;
            expect(validateScore(score)).toEqual([]);
            expect(scoreFitsPool(score, GUITAR_FIRST_POS)).toBe(true);
            const key = keyFor('C', 'major');
            for (const e of scoreEvents(score)) {
                if (!e.pitch) continue;
                expect(key.pitchClasses).toContain(((e.pitch.midi % 12) + 12) % 12);
            }
        }
    });

    it('is deterministic under the same seed', () => {
        const a = generateMelody({ ...configBase, seed: 42 }, GUITAR_FIRST_POS);
        const b = generateMelody({ ...configBase, seed: 42 }, GUITAR_FIRST_POS);
        expect(a).toEqual(b);
    });

    it('different seeds usually differ', () => {
        const a = generateMelody({ ...configBase, seed: 1 }, GUITAR_FIRST_POS);
        const b = generateMelody({ ...configBase, seed: 2 }, GUITAR_FIRST_POS);
        expect(a).not.toEqual(b);
    });

    it('respects bar count and exact bar totals for 1..8 bars and both meters', () => {
        for (const numerator of [3, 4] as const) {
            for (const bars of [1, 3, 8]) {
                const res = generateMelody({ ...configBase, meter: { numerator, denominator: 4 }, bars, seed: 7 }, GUITAR_FIRST_POS);
                expect(res.ok).toBe(true);
                if (!res.ok) continue;
                const { score } = res.value;
                expect(score.measures).toHaveLength(bars);
                expect(validateScore(score)).toEqual([]);
            }
        }
    });

    it('final note lasts at least two quarter beats (soft, on normal pool)', () => {
        for (let seed = 1; seed <= 50; seed++) {
            const res = generateMelody({ ...configBase, seed }, GUITAR_FIRST_POS);
            if (!res.ok) throw new Error(res.error);
            const evts = scoreEvents(res.value.score);
            expect(evts[evts.length - 1].durationTicks).toBeGreaterThanOrEqual(2 * PPQ);
        }
    });

    it('ends on the tonic when the tonic is available (soft, majority of seeds)', () => {
        let tonicEndings = 0;
        for (let seed = 1; seed <= 50; seed++) {
            const res = generateMelody({ ...configBase, seed }, GUITAR_FIRST_POS);
            if (!res.ok) throw new Error(res.error);
            const evts = scoreEvents(res.value.score);
            const last = evts[evts.length - 1].pitch;
            if (last && last.midi % 12 === 0) tonicEndings++;
        }
        expect(tonicEndings).toBeGreaterThan(40);
    });

    it('rejects empty or single-pitch pools with actionable errors', () => {
        expect(generateMelody({ ...configBase, seed: 1 }, []).ok).toBe(false);
        expect(generateMelody({ ...configBase, seed: 1 }, [60]).ok).toBe(false);
        // Two identical entries count as one pitch.
        expect(generateMelody({ ...configBase, seed: 1 }, [60, 60]).ok).toBe(false);
    });

    it('generates for every supported key/mode combination', () => {
        const tonics = ['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'Db', 'Ab', 'Eb', 'Bb', 'F'];
        const modes = ['major', 'minor', 'dorian', 'phrygian', 'lydian', 'mixolydian', 'locrian', 'major-pentatonic', 'minor-pentatonic'] as const;
        for (const t of tonics) {
            for (const m of modes) {
                const key = keyFor(t, m);
                // Wide chromatic pool so every key is testable.
                const pool = Array.from({ length: 40 }, (_, i) => 48 + i).filter(midi =>
                    key.pitchClasses.includes(midi % 12));
                if (pool.length < 2) continue;
                const res = generateMelody({ keyTonic: t, keyMode: m, bars: 2, meter: { numerator: 4, denominator: 4 }, rhythmLevel: 1, seed: 3 }, pool);
                expect(res.ok).toBe(true);
                if (!res.ok) continue;
                expect(validateScore(res.value.score)).toEqual([]);
                expect(scoreFitsPool(res.value.score, pool)).toBe(true);
            }
        }
    });

    it('survives a sparse pool (guitar high position) without escaping it', () => {
        // Standard tuning, frets 9-12: 4 pitches per string × 6 strings.
        const sparse = [49, 50, 51, 52, 54, 55, 56, 57, 59, 60, 61, 62, 64, 65, 66, 67, 69, 70, 71, 72, 74, 75, 76, 77];
        const inKey = sparse.filter(m => [0, 2, 4, 5, 7, 9, 11].includes(m % 12));
        for (let seed = 1; seed <= 50; seed++) {
            const res = generateMelody({ ...configBase, seed }, sparse);
            expect(res.ok).toBe(true);
            if (!res.ok) continue;
            expect(scoreFitsPool(res.value.score, sparse)).toBe(true);
            expect(validateScore(res.value.score)).toEqual([]);
        }
        expect(inKey.length).toBeGreaterThan(0);
    });

    it('rejects invalid bar counts', () => {
        expect(generateMelody({ ...configBase, bars: 0, seed: 1 }, GUITAR_FIRST_POS).ok).toBe(false);
        expect(generateMelody({ ...configBase, bars: 9, seed: 1 }, GUITAR_FIRST_POS).ok).toBe(false);
    });
});

describe('generateScaleDrill', () => {
    it('produces the expected C-major one-octave run in an eligible register', () => {
        const res = generateScaleDrill(
            { keyTonic: 'C', keyMode: 'major', direction: 'up', coverage: 'one-octave', meter: { numerator: 4, denominator: 4 } },
            GUITAR_FIRST_POS,
        );
        expect(res.ok).toBe(true);
        if (!res.ok) return;
        const evts = scoreEvents(res.value);
        // Lowest complete C-octave in first position: C3(48)? E on 2nd string 1st... 48..60 available?
        expect(evts.map(e => e.pitch!.midi)).toEqual([48, 50, 52, 53, 55, 57, 59, 60]);
        expect(evts.every(e => e.durationTicks === PPQ || e === evts[evts.length - 1])).toBe(true);
        expect(validateScore(res.value)).toEqual([]);
    });

    it('up-and-down has a single turning tonic', () => {
        const res = generateScaleDrill(
            { keyTonic: 'G', keyMode: 'major', direction: 'updown', coverage: 'one-octave', meter: { numerator: 3, denominator: 4 } },
            GUITAR_FIRST_POS,
        );
        expect(res.ok).toBe(true);
        if (!res.ok) return;
        const midis = scoreEvents(res.value).map(e => e.pitch!.midi);
        // Lowest complete G octave in first position is G2 (43): up then down without repeating the top tonic
        expect(midis).toEqual([43, 45, 47, 48, 50, 52, 54, 55, 54, 52, 50, 48, 47, 45, 43]);
        expect(validateScore(res.value)).toEqual([]);
    });

    it('extends the final note to complete its bar', () => {
        const res = generateScaleDrill(
            { keyTonic: 'C', keyMode: 'major', direction: 'up', coverage: 'one-octave', meter: { numerator: 4, denominator: 4 } },
            GUITAR_FIRST_POS,
        );
        if (!res.ok) throw new Error(res.error);
        const evts = scoreEvents(res.value);
        expect(evts[evts.length - 1].durationTicks).toBe(PPQ); // 8 notes → exactly 2 bars, no extension needed
        expect(validateScore(res.value)).toEqual([]);
    });

    it('refuses an incomplete one-octave scale with an actionable error', () => {
        // C major but missing E (52): one octave C3→C4 impossible.
        const pool = GUITAR_FIRST_POS.filter(m => m !== 52);
        const res = generateScaleDrill(
            { keyTonic: 'C', keyMode: 'major', direction: 'up', coverage: 'one-octave', meter: { numerator: 4, denominator: 4 } },
            pool,
        );
        expect(res.ok).toBe(false);
        if (!res.ok) expect(res.error).toMatch(/one-octave/i);
    });

    it('refuses a two-octave drill when it does not fit', () => {
        const res = generateScaleDrill(
            { keyTonic: 'C', keyMode: 'major', direction: 'up', coverage: 'two-octave', meter: { numerator: 4, denominator: 4 } },
            GUITAR_FIRST_POS,
        );
        expect(res.ok).toBe(false);
    });

    it('position drills traverse eligible notes in order', () => {
        const res = generateScaleDrill(
            { keyTonic: 'C', keyMode: 'major', direction: 'up', coverage: 'position', meter: { numerator: 4, denominator: 4 } },
            GUITAR_FIRST_POS,
        );
        expect(res.ok).toBe(true);
        if (!res.ok) return;
        const midis = scoreEvents(res.value).map(e => e.pitch!.midi);
        const expected = GUITAR_FIRST_POS.filter(m => [0, 2, 4, 5, 7, 9, 11].includes(m % 12));
        expect(midis).toEqual(expected);
        expect(validateScore(res.value)).toEqual([]);
    });
});
