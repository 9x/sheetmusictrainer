import { describe, it, expect } from 'vitest';
import { computeTargetPool } from './targetPool';

const base = {
    instrumentId: 'guitar',
    difficulty: 'custom',
    tuningId: 'standard',
    customMinFret: 0,
    customMaxFret: 12,
    keyEnabled: false,
    keyTonic: 'C',
    keyMode: 'major',
    strings: [],
    fretWindowEnabled: false,
    fretMin: 0,
    fretMax: 4,
};

describe('computeTargetPool', () => {
    it('returns the base playable range when no filters are active', () => {
        const pool = computeTargetPool(base);
        expect(pool).toContain(40); // low E
        expect(pool).toContain(64); // high e (12th fret)
        expect(pool.length).toBeGreaterThan(30);
    });

    it('applies the fret window when enabled', () => {
        const pool = computeTargetPool({ ...base, fretWindowEnabled: true, fretMin: 0, fretMax: 4 });
        // guitar standard: open strings 40,45,50,55,59,64; window adds up to +4
        const lo = Math.min(...pool);
        const hi = Math.max(...pool);
        expect(lo).toBe(40);
        expect(hi).toBe(68); // 64 + 4
        expect(pool).toContain(59); // open g
        expect(pool).not.toContain(69);
    });

    it('restricts to pitch classes of the key when key filter is on', () => {
        const pool = computeTargetPool({ ...base, keyEnabled: true, keyTonic: 'C', keyMode: 'major' });
        const pcs = new Set([0, 2, 4, 5, 7, 9, 11]); // C major
        for (const midi of pool) {
            expect(pcs.has(((midi % 12) + 12) % 12)).toBe(true);
        }
        // chromatic notes excluded
        expect(pool).not.toContain(61); // C# within range
    });

    it('combines fret window and key filter', () => {
        const pool = computeTargetPool({ ...base, fretWindowEnabled: true, fretMin: 0, fretMax: 5, keyEnabled: true, keyTonic: 'E', keyMode: 'minor' });
        const pcs = new Set([4, 6, 7, 9, 11, 0, 2]); // E minor natural: E F# G A B C D
        expect(pool.length).toBeGreaterThan(0);
        for (const midi of pool) {
            expect(pcs.has(((midi % 12) + 12) % 12)).toBe(true);
        }
        // F (pc 5) and F# (pc 6 is in E minor; F natural is not) — F natural excluded
        expect(pool.some(m => ((m % 12) + 12) % 12 === 5)).toBe(false);
    });

    it('supports modes beyond the single-note key signatures (dorian)', () => {
        const pool = computeTargetPool({ ...base, keyEnabled: true, keyTonic: 'D', keyMode: 'dorian' });
        const pcs = new Set([2, 4, 5, 7, 9, 11, 0]); // D dorian: D E F G A B C
        expect(pool.length).toBeGreaterThan(0);
        for (const midi of pool) {
            expect(pcs.has(((midi % 12) + 12) % 12)).toBe(true);
        }
    });

    it('falls back to major for an invalid mode id', () => {
        const a = computeTargetPool({ ...base, keyEnabled: true, keyTonic: 'C', keyMode: 'major' });
        const b = computeTargetPool({ ...base, keyEnabled: true, keyTonic: 'C', keyMode: 'bogus' as string });
        expect(b).toEqual(a);
    });

    it('returns an empty pool rather than crashing for a non-fretted window request', () => {
        const pool = computeTargetPool({ ...base, instrumentId: 'piano', fretWindowEnabled: true });
        // piano has no fret window: window is ignored, base pool returned
        expect(pool.length).toBeGreaterThan(0);
    });
});

describe('computeTargetPool — string selection', () => {
    it('restricts to a single string when selected', () => {
        // String index 5 = high E (open midi 64)
        const pool = computeTargetPool({ ...base, strings: [5] });
        expect(pool).toContain(64); // open high E
        expect(pool).toContain(65); // fret 1
        expect(pool).not.toContain(45); // open A (string 1) — different string
        // all notes come from one string
        expect(pool.every(m => m >= 64)).toBe(true);
    });

    it('combines strings + fret window', () => {
        // String index 1 (open A = 45), frets 0..2
        const pool = computeTargetPool({ ...base, strings: [1], fretWindowEnabled: true, fretMin: 0, fretMax: 2 });
        expect(pool).toEqual([45, 46, 47]);
    });

    it('combines strings + fret window + key filter', () => {
        // Low E string (index 0), frets 0..4, C major → only natural notes in that range
        const pool = computeTargetPool({ ...base, strings: [0], fretWindowEnabled: true, fretMin: 0, fretMax: 4, keyEnabled: true, keyTonic: 'C', keyMode: 'major' });
        // Low E string frets 0-4: E(40) F(41) F#(42) G(43) G#(44); C major pcs: C D E F G A B
        expect(pool).toEqual([40, 41, 43]); // E, F, G (F#, G# excluded)
    });

    it('treats empty strings array as all strings', () => {
        const a = computeTargetPool({ ...base, strings: [] });
        const b = computeTargetPool({ ...base, strings: [0, 1, 2, 3, 4, 5] });
        expect(a).toEqual(b);
    });
});
