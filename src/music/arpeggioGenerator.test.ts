import { describe, it, expect } from 'vitest';
import { generateArpeggio } from './arpeggioGenerator';
import { scoreEvents, validateScore } from '../score/model';

const strings = [40, 45, 50, 55, 59, 64];
const pool: number[] = [];
for (const open of strings) for (let f = 0; f <= 12; f++) pool.push(open + f);

const base = {
    keyTonic: 'C',
    keyMode: 'major' as const,
    meter: { numerator: 4 as const, denominator: 4 as const },
};

describe('generateArpeggio', () => {
    it('builds a C major arpeggio (up, one octave) from the pool', () => {
        const r = generateArpeggio({ ...base, degree: 'I', pattern: 'up', coverage: 'one-octave' }, pool);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        const ev = scoreEvents(r.value);
        // C-E-G-C as eighths (always 240 ticks now) plus a rest fill in the
        // auto-derived bar.
        const midis = ev.filter(e => e.pitch).map(e => e.pitch!.midi);
        expect(midis).toEqual([48, 52, 55, 60]);
        expect(validateScore(r.value)).toEqual([]);
        expect(r.value.title).toContain('Arpeggio');
        expect(r.value.title).toContain('C I');
    });

    it('down pattern reverses the ascending cycle', () => {
        const r = generateArpeggio({ ...base, degree: 'I', pattern: 'down', coverage: 'one-octave' }, pool);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        const midis = scoreEvents(r.value).filter(e => e.pitch).map(e => e.pitch!.midi);
        expect(midis).toEqual([60, 55, 52, 48]);
    });

    it('updown returns to the starting root without duplicating the top', () => {
        const r = generateArpeggio({ ...base, degree: 'I', pattern: 'updown', coverage: 'one-octave' }, pool);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        const midis = scoreEvents(r.value).filter(e => e.pitch).map(e => e.pitch!.midi);
        // ascend C-E-G-C then descend back to C; only one C5 (turning point)
        expect(midis).toEqual([48, 52, 55, 60, 55, 52, 48]);
        expect(midis.filter(m => m === 60)).toHaveLength(1);
    });

    it('1235 pattern ends on the octave of the root', () => {
        const r = generateArpeggio({ ...base, degree: 'I', pattern: '1235', coverage: 'one-octave' }, pool);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        const midis = scoreEvents(r.value).filter(e => e.pitch).map(e => e.pitch!.midi);
        expect(midis).toEqual([48, 52, 55, 60]);
    });

    it('two-octave coverage spans 12 semitones beyond the first cycle', () => {
        const r = generateArpeggio({ ...base, degree: 'I', pattern: 'up', coverage: 'two-octave' }, pool);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        const midis = scoreEvents(r.value).filter(e => e.pitch).map(e => e.pitch!.midi);
        expect(midis).toEqual([48, 52, 55, 60, 64, 67, 72]);
    });
    it('spells the dominant triad G-B-D in C major', () => {
        const r = generateArpeggio({ ...base, degree: 'V', pattern: 'up', coverage: 'one-octave' }, pool);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        const pcs = scoreEvents(r.value).filter(e => e.pitch).map(e => e.pitch!.midi % 12);
        expect(pcs).toEqual([7, 11, 2, 7]); // G B D G
    });

    it('spells the leading-tone dim triad B-D-F in C major', () => {
        const r = generateArpeggio({ ...base, degree: 'vii0', pattern: 'up', coverage: 'one-octave' }, pool);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        const pcs = scoreEvents(r.value).filter(e => e.pitch).map(e => e.pitch!.midi % 12);
        expect(pcs).toEqual([11, 2, 5, 11]); // B D F B
    });

    it('fails cleanly when the pool cannot fit a full triad cycle', () => {
        // Only frets 0-1 on all strings: no complete C-E-G cycle with octave
        const tiny: number[] = [];
        for (const open of strings) for (let f = 0; f <= 1; f++) tiny.push(open + f);
        const r = generateArpeggio({ ...base, degree: 'I', pattern: 'up', coverage: 'one-octave' }, tiny);
        expect(r.ok).toBe(false);
    });

    it('is deterministic for identical configs', () => {
        const a = generateArpeggio({ ...base, degree: 'IV', pattern: 'updown', coverage: 'one-octave' }, pool);
        const b = generateArpeggio({ ...base, degree: 'IV', pattern: 'updown', coverage: 'one-octave' }, pool);
        expect(a).toEqual(b);
    });
});

describe('generateArpeggio — sequence mode', () => {
    it('generates one chord per bar with functional progression', () => {
        const r = generateArpeggio({ ...base, degree: 'I', pattern: 'up', coverage: 'one-octave', bars: 4, progression: 'functional', seed: 7 }, pool);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.value.measures.length).toBe(4);
        expect(r.value.chordSymbols?.length).toBe(4);
        expect(r.value.chordSymbols?.[0]).toBe('C'); // starts on I
        // bar boundaries: each bar starts on a chord root? (not enforced) — but ticks align
        const ev = scoreEvents(r.value);
        expect(validateScore(r.value)).toEqual([]);
        // Auto meter from a 4-note path (960 ticks): 3/4 wins (remainder 480
        // vs 960 in 4/4) → 6 eighths per bar × 4 bars = 24
        expect(ev.length).toBe(24);
        // deterministic
        const r2 = generateArpeggio({ ...base, degree: 'I', pattern: 'up', coverage: 'one-octave', bars: 4, progression: 'functional', seed: 7 }, pool);
        expect(r2.ok && JSON.stringify(scoreEvents(r2.value)) === JSON.stringify(ev)).toBe(true);
    });

    it('diatonic cycle walks I ii iii IV V vi vii', () => {
        const r = generateArpeggio({ ...base, degree: 'I', pattern: 'up', coverage: 'one-octave', bars: 7, progression: 'diatonic-cycle', seed: 1 }, pool);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        const syms = r.value.chordSymbols!;
        expect(syms).toEqual(['C', 'Dm', 'Em', 'F', 'G', 'Am', 'Bdim']);
    });

    it('eighths fill each bar (always-eighths rhythm)', () => {
        const r = generateArpeggio({ ...base, degree: 'I', pattern: 'up', coverage: 'one-octave', bars: 2, progression: 'functional', seed: 3 }, pool);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        const ev = scoreEvents(r.value);
        // Auto meter from a 4-note path: 3/4 → 6 eighths per bar × 2 bars
        expect(ev.length).toBe(12);
        expect(ev[0].durationTicks).toBe(240);
        expect(validateScore(r.value)).toEqual([]);
    });

    it('random avoids repeating the same chord back-to-back', () => {
        const r = generateArpeggio({ ...base, degree: 'I', pattern: 'up', coverage: 'one-octave', bars: 6, progression: 'random', seed: 11 }, pool);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        const syms = r.value.chordSymbols!;
        for (let i = 1; i < syms.length; i++) {
            expect(syms[i]).not.toBe(syms[i - 1]);
        }
    });
});

describe('generateArpeggio — always-eighths + custom pattern', () => {
    it('auto-derives 3/4 for a 4-note path (remainder 480 < 960)', () => {
        const r = generateArpeggio({ ...base, degree: 'I', pattern: 'up', coverage: 'one-octave' }, pool);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.value.meter).toEqual({ numerator: 3, denominator: 4 });
        const ev = scoreEvents(r.value);
        for (const e of ev.filter(x => x.pitch)) expect(e.durationTicks).toBe(240);
        // 4 notes fill 960 of the 1440-tick bar; remainder is a 480 rest
        const rest = ev.find(e => e.pitch === null);
        expect(rest).toBeDefined();
        expect(rest!.durationTicks).toBe(480);
        expect(rest!.startTick).toBe(960);
    });

    it('auto-derives 4/4 for a 6-note path (remainder 480 < 480? no — 6×240=1440 fits 3/4)', () => {
        // 1321 figure → 4 notes; use 121321 → 6 notes = 1440 ticks = 3/4 exact
        const r = generateArpeggio({ ...base, degree: 'I', pattern: '121321', coverage: 'one-octave' }, pool);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.value.meter).toEqual({ numerator: 3, denominator: 4 });
        const ev = scoreEvents(r.value).filter(e => e.pitch);
        expect(ev.length).toBe(6);
        expect(ev.every(e => e.durationTicks === 240)).toBe(true);
    });

    it('never stretches the last note (the old 2880-tick crash)', () => {
        const ev = scoreEvents(
            (generateArpeggio({ ...base, degree: 'I', pattern: 'updown', coverage: 'two-octave' }, pool) as { ok: true; value: import('../score/model').Score }).value
        );
        const RENDERABLE = [120, 240, 360, 480, 720, 960, 1440, 1920];
        for (const e of ev) expect(RENDERABLE).toContain(e.durationTicks);
    });

    it('builds a custom pattern from digits (1321 = root-fifth-third-root)', () => {
        const r = generateArpeggio({ ...base, degree: 'I', pattern: 'custom', customPattern: '1321', coverage: 'one-octave' }, pool);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        const midis = scoreEvents(r.value).filter(e => e.pitch).map(e => e.pitch!.midi);
        expect(midis).toEqual([48, 55, 52, 48]); // C G E C
    });

    it('digit 5 reaches the fifth above the octave', () => {
        const r = generateArpeggio({ ...base, degree: 'I', pattern: 'custom', customPattern: '15', coverage: 'one-octave' }, pool);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        const midis = scoreEvents(r.value).filter(e => e.pitch).map(e => e.pitch!.midi);
        expect(midis).toEqual([48, 67]); // C + G above the octave C
    });

    it('rejects invalid custom patterns cleanly', () => {
        const empty = generateArpeggio({ ...base, degree: 'I', pattern: 'custom', coverage: 'one-octave' }, pool);
        expect(empty.ok).toBe(false);
        const bad = generateArpeggio({ ...base, degree: 'I', pattern: 'custom', customPattern: '179', coverage: 'one-octave' }, pool);
        expect(bad.ok).toBe(false);
    });

    it('random pattern resolves to a valid broken-chord figure per seed', () => {
        const RENDERABLE = [120, 240, 360, 480, 720, 960, 1440, 1920];
        const seen = new Set<string>();
        for (let seed = 0; seed < 30; seed++) {
            const r = generateArpeggio({ ...base, degree: 'I', pattern: 'random', coverage: 'one-octave', seed }, pool);
            expect(r.ok).toBe(true);
            if (!r.ok) continue;
            for (const e of scoreEvents(r.value)) expect(RENDERABLE).toContain(e.durationTicks);
            expect(validateScore(r.value)).toEqual([]);
            // The title reveals the resolved figure label
            const match = r.value.title.match(/\(([^)]+)\,/);
            if (match) seen.add(match[1]);
        }
        // Across seeds more than one distinct figure should appear
        expect(seen.size).toBeGreaterThan(1);
    });

    it('random pattern is deterministic per seed', () => {
        const a = generateArpeggio({ ...base, degree: 'I', pattern: 'random', coverage: 'two-octave', seed: 42 }, pool);
        const b = generateArpeggio({ ...base, degree: 'I', pattern: 'random', coverage: 'two-octave', seed: 42 }, pool);
        expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    });

    it('sweep: every pattern × degree × coverage produces only renderable ticks', () => {
        const RENDERABLE = [120, 240, 360, 480, 720, 960, 1440, 1920];
        const patterns = ['up', 'down', 'updown', '1235', '1321', '1325', '1535', '12353', '121321', '1353', '15453', '132532'] as const;
        const degrees = ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii0'] as const;
        for (const pattern of patterns) {
            for (const degree of degrees) {
                for (const coverage of ['one-octave', 'two-octave'] as const) {
                    const r = generateArpeggio({ ...base, degree, pattern, coverage }, pool);
                    expect(r.ok).toBe(true);
                    if (!r.ok) continue;
                    const ev = scoreEvents(r.value);
                    expect(ev.length).toBeGreaterThan(0);
                    for (const e of ev) expect(RENDERABLE).toContain(e.durationTicks);
                    expect(validateScore(r.value)).toEqual([]);
                }
            }
        }
    });
});
