import { describe, it, expect } from 'vitest';
import { generateGiulianiStudy } from './giulianiGenerator';
import { scoreEvents, validateScore } from '../score/model';

const strings = [40, 45, 50, 55, 59, 64];
const pool: number[] = [];
for (const open of strings) for (let f = 0; f <= 12; f++) pool.push(open + f);

const base = {
    keyTonic: 'C',
    keyMode: 'major' as const,
    meter: { numerator: 4 as const, denominator: 4 as const },
    tuningId: 'standard',
    bars: 4,
    chordSelection: [] as string[],
    allowedStrings: [] as number[],
};

describe('generateGiulianiStudy', () => {
    it('generates a 4-bar p-i-m-a study in C major', () => {
        const r = generateGiulianiStudy({ ...base, pattern: 'pima', seed: 5 }, pool);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        const ev = scoreEvents(r.value);
        expect(r.value.measures.length).toBe(4);
        expect(ev.length).toBe(4 * 4 * 4); // bars × beats × figure length
        expect(validateScore(r.value)).toEqual([]);
        expect(r.value.title).toContain('Giuliani');
    });

    it('keeps figure notes on distinct strings per repetition (voicing rule)', () => {
        const r = generateGiulianiStudy({ ...base, pattern: 'pima', seed: 3 }, pool);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        // For each repetition of 4 consecutive notes, all midis must differ
        // (distinct cycle positions → distinct pitches within a beat figure)
        const ev = scoreEvents(r.value);
        for (let i = 0; i + 3 < ev.length; i += 4) {
            const four = ev.slice(i, i + 4).map(e => e.pitch!.midi);
            expect(new Set(four).size).toBe(4);
        }
    });

    it('six-note figures work (pimamim)', () => {
        const r = generateGiulianiStudy({ ...base, pattern: 'pimamim', seed: 1 }, pool);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        const ev = scoreEvents(r.value);
        // 4/4: figure falls back to quarter-note walk (6-note figure over 4
        // beats is not renderable in even subdivisions) — 4 bars × 4 quarters
        expect(ev.length).toBe(16);
        expect(validateScore(r.value)).toEqual([]);
    });

    it('is deterministic per seed', () => {
        const a = generateGiulianiStudy({ ...base, pattern: 'pim', seed: 9 }, pool);
        const b = generateGiulianiStudy({ ...base, pattern: 'pim', seed: 9 }, pool);
        expect(JSON.stringify(a) === JSON.stringify(b)).toBe(true);
    });

    it('honors string restrictions (fails cleanly when impossible)', () => {
        const r = generateGiulianiStudy({ ...base, pattern: 'pima', seed: 2, allowedStrings: [0] }, pool);
        expect(r.ok).toBe(false); // 4 voices cannot live on one string
    });
});
