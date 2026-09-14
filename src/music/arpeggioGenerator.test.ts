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
        // C-E-G-C: 4 notes, quarter each (plus final extension)
        const midis = ev.map(e => e.pitch!.midi);
        expect(midis).toEqual([48, 52, 55, 60]);
        expect(validateScore(r.value)).toEqual([]);
        expect(r.value.title).toContain('Arpeggio');
        expect(r.value.title).toContain('C I');
    });

    it('down pattern reverses the ascending cycle', () => {
        const r = generateArpeggio({ ...base, degree: 'I', pattern: 'down', coverage: 'one-octave' }, pool);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        const midis = scoreEvents(r.value).map(e => e.pitch!.midi);
        expect(midis).toEqual([60, 55, 52, 48]);
    });

    it('updown returns to the starting root without duplicating the top', () => {
        const r = generateArpeggio({ ...base, degree: 'I', pattern: 'updown', coverage: 'one-octave' }, pool);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        const midis = scoreEvents(r.value).map(e => e.pitch!.midi);
        // ascend C-E-G-C then descend back to C; only one C5 (turning point)
        expect(midis).toEqual([48, 52, 55, 60, 55, 52, 48]);
        expect(midis.filter(m => m === 60)).toHaveLength(1);
    });

    it('1235 pattern ends on the octave of the root', () => {
        const r = generateArpeggio({ ...base, degree: 'I', pattern: '1235', coverage: 'one-octave' }, pool);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        const midis = scoreEvents(r.value).map(e => e.pitch!.midi);
        expect(midis).toEqual([48, 52, 55, 60]);
    });

    it('two-octave coverage spans 12 semitones beyond the first cycle', () => {
        const r = generateArpeggio({ ...base, degree: 'I', pattern: 'up', coverage: 'two-octave' }, pool);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        const midis = scoreEvents(r.value).map(e => e.pitch!.midi);
        expect(midis).toEqual([48, 52, 55, 60, 64, 67, 72]);
    });
    it('spells the dominant triad G-B-D in C major', () => {
        const r = generateArpeggio({ ...base, degree: 'V', pattern: 'up', coverage: 'one-octave' }, pool);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        const pcs = scoreEvents(r.value).map(e => e.pitch!.midi % 12);
        expect(pcs).toEqual([7, 11, 2, 7]); // G B D G
    });

    it('spells the leading-tone dim triad B-D-F in C major', () => {
        const r = generateArpeggio({ ...base, degree: 'vii0', pattern: 'up', coverage: 'one-octave' }, pool);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        const pcs = scoreEvents(r.value).map(e => e.pitch!.midi % 12);
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
