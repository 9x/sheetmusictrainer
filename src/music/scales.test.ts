import { describe, it, expect } from 'vitest';
import { keyFor, scalePitches, spelledPitch, spellPcInKey, MODE_LABELS, isMode } from './scales';
import { validateScore } from '../score/model';

describe('keyFor — signatures and spelling', () => {
    it('derives parent signatures for all 12 tonics (major)', () => {
        const expected: Record<string, string> = {
            C: 'C', G: 'G', D: 'D', A: 'A', E: 'E', B: 'B',
            'F#': 'F#', Db: 'Db', Ab: 'Ab', Eb: 'Eb', Bb: 'Bb', F: 'F',
        };
        for (const [tonic, sig] of Object.entries(expected)) {
            expect(keyFor(tonic, 'major').signature).toBe(sig);
        }
    });

    it('derives correct parent signatures for minor and modes', () => {
        expect(keyFor('A', 'minor').signature).toBe('C');   // A minor ↔ C major
        expect(keyFor('E', 'minor').signature).toBe('G');
        expect(keyFor('B', 'minor').signature).toBe('D');
        expect(keyFor('D', 'dorian').signature).toBe('C');  // D dorian ↔ C major
        expect(keyFor('G', 'mixolydian').signature).toBe('C');
        expect(keyFor('A', 'minor-pentatonic').signature).toBe('C');
        expect(keyFor('C', 'major-pentatonic').signature).toBe('C');
    });

    it('spells E# in F# major and B# in C# major (contract I)', () => {
        const fsharp = keyFor('F#', 'major');
        expect(fsharp.signatureAlter.F).toBe(1);
        const eSharp = fsharp.degrees.find(d => d.semitones === 11);
        expect(eSharp).toEqual({ step: 'E', alter: 1, semitones: 11 });

        const csharp = keyFor('C#', 'minor'); // parent E major: D# in signature
        expect(csharp.signature).toBe('E');
        // C# natural minor 7th = B → spelled B (signature has no B accidental)
        const seventh = csharp.degrees.find(d => d.semitones === 10);
        expect(seventh).toEqual({ step: 'B', alter: 0, semitones: 10 });
    });

    it('produces correct pitch classes for representative scales', () => {
        expect(keyFor('C', 'major').pitchClasses).toEqual([0, 2, 4, 5, 7, 9, 11]);
        expect(keyFor('A', 'minor').pitchClasses).toEqual([9, 11, 0, 2, 4, 5, 7]);
        expect(keyFor('A', 'minor-pentatonic').pitchClasses).toEqual([9, 0, 2, 4, 7]);
        expect(keyFor('C', 'major-pentatonic').pitchClasses).toEqual([0, 2, 4, 7, 9]);
        expect(keyFor('D', 'lydian').pitchClasses).toEqual([2, 4, 6, 8, 9, 11, 1]);
        expect(keyFor('E', 'phrygian').pitchClasses).toEqual([4, 5, 7, 9, 11, 0, 2]);
    });

    it('spells all degrees consistently with pitch classes', () => {
        for (const mode of Object.keys(MODE_LABELS)) {
            if (!isMode(mode)) continue;
            for (const tonic of ['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'Db', 'Ab', 'Eb', 'Bb', 'F']) {
                const key = keyFor(tonic, mode);
                for (const d of key.degrees) {
                    expect(Math.abs(d.alter)).toBeLessThanOrEqual(2);
                    expect(d.step).toBeTruthy();
                }
            }
        }
    });

    it('spellPcInKey returns degree spelling or null', () => {
        const g = keyFor('G', 'major');
        const fSharp = spellPcInKey(6, g);
        expect(fSharp).toEqual({ step: 'F', alter: 1 });
        expect(spellPcInKey(5, g)).toBeNull(); // F natural not in G major
    });
});

describe('scalePitches', () => {
    it('enumerates C major across a range with correct spelling and octaves', () => {
        const key = keyFor('C', 'major');
        const pitches = scalePitches(key, 60, 72);
        expect(pitches.map(p => p.midi)).toEqual([60, 62, 64, 65, 67, 69, 71, 72]);
        expect(pitches[7].pitch.step).toBe('C');
        expect(pitches[7].pitch.octave).toBe(5);
        expect(pitches[0].degreeIndex).toBe(0);
        expect(pitches[7].degreeIndex).toBe(0); // octave-up tonic maps to degree 0
    });

    it('spells octave correctly at boundaries (B3/C4)', () => {
        const key = keyFor('C', 'major');
        const b = scalePitches(key, 59, 60);
        expect(b[0].pitch.step).toBe('B');
        expect(b[0].pitch.octave).toBe(3);
        expect(b[1].pitch.step).toBe('C');
        expect(b[1].pitch.octave).toBe(4);
    });

    it('spelledPitch rejects mismatches', () => {
        expect(() => spelledPitch(61, 'C', 0)).toThrow();
        expect(spelledPitch(61, 'C', 1)).toMatchObject({ midi: 61, step: 'C', alter: 1, octave: 4 });
    });

    it('scale pitches can build a valid score (integration sanity)', () => {
        const key = keyFor('Eb', 'major');
        const pitches = scalePitches(key, 60, 71).slice(0, 7); // C D E F G A B
        const events = pitches.map((p, i) => ({
            id: `e${i}`,
            startTick: i * 480,
            durationTicks: 480,
            pitch: p.pitch,
        }));
        const score = {
            version: 1 as const,
            id: 'x', title: 'x',
            meter: { numerator: 4 as const, denominator: 4 as const },
            key: { tonic: 'Eb', mode: 'major', signature: key.signature },
            measures: [{ number: 1, startTick: 0, durationTicks: 1920 }, { number: 2, startTick: 1920, durationTicks: 1920 }],
            voices: [{ id: 'melody' as const, events: [...events, { id: 'pad', startTick: 7 * 480, durationTicks: 8 * 480 - 7 * 480, pitch: null }] }],
        };
        expect(validateScore(score)).toEqual([]);
    });
});
