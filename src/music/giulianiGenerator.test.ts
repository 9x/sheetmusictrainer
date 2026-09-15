import { describe, it, expect } from 'vitest';
import { generateGiulianiStudy, type GiulianiPattern } from './giulianiGenerator';
import { scoreEvents, validateScore } from '../score/model';

const strings = [40, 45, 50, 55, 59, 64];
const pool: number[] = [];
for (const open of strings) for (let f = 0; f <= 12; f++) pool.push(open + f);

const base = {
    keyTonic: 'C',
    keyMode: 'major' as const,
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
        // 4 voices → 4/4 auto-derived; eighths: 8 notes per bar
        expect(ev.length).toBe(4 * 8);
        expect(validateScore(r.value)).toEqual([]);
        expect(r.value.title).toContain('Giuliani');
    });

    it('keeps figure notes on distinct strings per repetition (voicing rule)', () => {
        const r = generateGiulianiStudy({ ...base, pattern: 'pima', seed: 3 }, pool);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        // For each repetition of 4 consecutive notes, all midis must differ
        // (distinct cycle positions → distinct pitches within a beat figure)
        const ev = scoreEvents(r.value).filter(e => e.pitch);
        for (let i = 0; i + 3 < ev.length; i += 4) {
            const four = ev.slice(i, i + 4).map(e => e.pitch!.midi);
            expect(new Set(four).size).toBe(4);
        }
    });

    it('six-note figures work (pimamim)', () => {
        const r = generateGiulianiStudy({ ...base, pattern: 'pimamim', seed: 1 }, pool);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        const ev = scoreEvents(r.value).filter(e => e.pitch);
        // 6 voices → 3/4 auto-derived; eighths: 6 notes per bar (one cycle)
        expect(ev.length).toBe(4 * 6);
        expect(ev.every(e => e.durationTicks === 240)).toBe(true);
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

describe('generateGiulianiStudy — always-eighths + new patterns', () => {
    it('all note durations are exactly 240 across every pattern', () => {
        const patterns = ['pim', 'pima', 'pami', 'aim', 'pimamim', 'pmamim', 'piai', 'pmami', 'pimami', 'pimaia', 'pimai', 'pmia', 'pmim'] as const;
        for (const p of patterns) {
            const r = generateGiulianiStudy({ ...base, pattern: p, seed: 1 }, pool);
            expect(r.ok).toBe(true);
            if (!r.ok) continue;
            const ev = scoreEvents(r.value);
            const RENDERABLE = [120, 240, 360, 480, 720, 960, 1440, 1920];
            for (const e of ev.filter(x => x.pitch)) expect(e.durationTicks).toBe(240);
            for (const e of ev.filter(x => x.pitch === null)) expect(RENDERABLE).toContain(e.durationTicks);
            expect(validateScore(r.value)).toEqual([]);
        }
    });

    it('alternating bass puts the fifth degree in the bass on even bars', () => {
        const r = generateGiulianiStudy({ ...base, pattern: 'pima', seed: 4, bars: 4, alternateBass: true }, pool);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        const ev = scoreEvents(r.value).filter(e => e.pitch);
        const full = 4 * 480; // 4/4 bar
        // Even bars (0-indexed): first note of each figure cycle is the bass.
        // Its pc must be the FIFTH of the bar's chord (C major: cycle starts
        // on I or another diatonic chord; verify bass ≠ root and bass = fifth).
        for (let bar = 0; bar < 4; bar += 2) {
            const barEv = ev.filter(e => e.startTick >= bar * full && e.startTick < (bar + 1) * full);
            expect(barEv.length).toBeGreaterThan(0);
            const bassMidi = barEv[0].pitch!.midi;
            const upperPcs = new Set(barEv.slice(1).map(e => e.pitch!.midi % 12));
            // the bass pc must NOT equal any upper-voice root pc check below;
            // direct check: bass pc differs from the plain-root voicing
            const plain = generateGiulianiStudy({ ...base, pattern: 'pima', seed: 4, bars: 4 }, pool);
            expect(plain.ok).toBe(true);
            if (!plain.ok) return;
            const plainEv = scoreEvents(plain.value).filter(e => e.pitch);
            const plainBass = plainEv.filter(e => e.startTick >= bar * full && e.startTick < (bar + 1) * full)[0];
            expect(bassMidi % 12).not.toBe(plainBass.pitch!.midi % 12);
            // and it must be a fifth above the root (7 semitones) — i.e. a
            // chord tone that is neither root nor third of the upper cycle
            const bassPc = bassMidi % 12;
            const rootPc = plainBass.pitch!.midi % 12;
            // fifth of a diatonic triad: +7 semitones (+6 for the dim chord)
            expect([6, 7]).toContain((bassPc - rootPc + 12) % 12);
            void upperPcs;
        }
    });

    it('odd bars keep the root bass when alternating is on', () => {
        const r = generateGiulianiStudy({ ...base, pattern: 'pima', seed: 4, bars: 4, alternateBass: true }, pool);
        const plain = generateGiulianiStudy({ ...base, pattern: 'pima', seed: 4, bars: 4 }, pool);
        expect(r.ok && plain.ok).toBe(true);
        if (!r.ok || !plain.ok) return;
        const ev = scoreEvents(r.value).filter(e => e.pitch);
        const plainEv = scoreEvents(plain.value).filter(e => e.pitch);
        const full = 4 * 480;
        for (let bar = 1; bar < 4; bar += 2) {
            const bass = ev.filter(e => e.startTick >= bar * full && e.startTick < (bar + 1) * full)[0];
            const plainBass = plainEv.filter(e => e.startTick >= bar * full && e.startTick < (bar + 1) * full)[0];
            expect(bass.pitch!.midi % 12).toBe(plainBass.pitch!.midi % 12);
        }
    });

    it('new figure lengths auto-derive the specified meter', () => {
        const cases: [GiulianiPattern, 3 | 4][] = [
            ['pim', 3], ['pima', 4], ['pimamim', 3], ['pimai', 4], ['pmia', 4], ['pmim', 4],
        ];
        for (const [p, num] of cases) {
            const r = generateGiulianiStudy({ ...base, pattern: p, seed: 2 }, pool);
            expect(r.ok).toBe(true);
            if (!r.ok) continue;
            expect(r.value.meter.numerator).toBe(num);
            expect(r.value.meter.denominator).toBe(4);
        }
    });

    it('5-voice figures (pimai) fill 4/4 with a trailing 720-tick rest', () => {
        const r = generateGiulianiStudy({ ...base, pattern: 'pimai', seed: 2, bars: 2 }, pool);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        const ev = scoreEvents(r.value);
        const full = 1920;
        for (let bar = 0; bar < 2; bar++) {
            const barEv = ev.filter(e => e.startTick >= bar * full && e.startTick < (bar + 1) * full);
            const rest = barEv.find(e => e.pitch === null);
            expect(rest).toBeDefined();
            expect(rest!.startTick).toBe(bar * full + 1200);
            expect(rest!.durationTicks).toBe(720);
        }
    });
});
