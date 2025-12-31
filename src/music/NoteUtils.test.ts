import { describe, it, expect } from 'vitest';
import {
    frequencyToMidi,
    midiToFrequency,
    getNoteDetails,
    getRandomNote,
    getNoteInKey
} from './NoteUtils';

describe('NoteUtils', () => {
    describe('frequencyToMidi', () => {
        it('should correctly convert A4 (440Hz) to MIDI 69', () => {
            expect(frequencyToMidi(440)).toBe(69);
        });

        it('should correctly convert C4 (approx 261.63Hz) to MIDI 60', () => {
            // C4 is 261.625...
            expect(frequencyToMidi(261.63)).toBe(60);
        });

        it('should return 0 for 0 or negative frequency', () => {
            expect(frequencyToMidi(0)).toBe(0);
            expect(frequencyToMidi(-100)).toBe(0);
        });
    });

    describe('midiToFrequency', () => {
        it('should correctly convert MIDI 69 to 440Hz', () => {
            expect(midiToFrequency(69)).toBe(440);
        });

        it('should correctly convert MIDI 60 to C4 frequency', () => {
            const freq = midiToFrequency(60);
            expect(freq).toBeCloseTo(261.625565);
        });
    });

    describe('getNoteDetails', () => {
        it('should return correct details for C4 (60)', () => {
            const details = getNoteDetails(60);
            expect(details.name).toBe('C');
            expect(details.octave).toBe(4);
            expect(details.scientific).toBe('C4');
        });

        it('should return correct details for A4 (69)', () => {
            const details = getNoteDetails(69);
            expect(details.name).toBe('A');
            expect(details.octave).toBe(4);
            expect(details.scientific).toBe('A4');
        });

        it('should return correct details for F#4 (66)', () => {
            const details = getNoteDetails(66);
            expect(details.name).toBe('F#');
            expect(details.octave).toBe(4);
            expect(details.scientific).toBe('F#4');
        });
    });

    describe('getRandomNote', () => {
        it('should return a note within range', () => {
            for (let i = 0; i < 100; i++) {
                const note = getRandomNote(60, 72);
                expect(note).toBeGreaterThanOrEqual(60);
                expect(note).toBeLessThanOrEqual(72);
            }
        });

        it('should verify min and max bounds are inclusive', () => {
            // Statistically probable to hit bounds with enough iterations if range is small
            const results = new Set<number>();
            for (let i = 0; i < 50; i++) {
                results.add(getRandomNote(60, 61));
            }
            expect(results.has(60)).toBe(true);
            expect(results.has(61)).toBe(true);
        });

        it('should return a note from validNotes list if provided', () => {
            const valid = [60, 64, 67]; // C major triad
            for (let i = 0; i < 50; i++) {
                const note = getRandomNote(0, 100, valid);
                expect(valid).toContain(note);
            }
        });
    });

    describe('getNoteInKey', () => {
        it('should return simple note for C Major', () => {
            // C4 in C Major -> c/4
            const spec = getNoteInKey(60, 'C');
            expect(spec.keys[0]).toBe('c/4');
            expect(spec.accidental).toBeUndefined();
        });

        it('should implies accidental if in key signature (F# in G Major)', () => {
            // F#4 (66) in G Major (which has F#) -> f#/4, no accidental shown
            const spec = getNoteInKey(66, 'G');
            expect(spec.keys[0]).toBe('f#/4');
            expect(spec.accidental).toBeUndefined();
        });

        it('should show accidental if outside key signature (F# in C Major)', () => {
            // F#4 (66) in C Major -> f#/4, show #
            const spec = getNoteInKey(66, 'C');
            expect(spec.keys[0]).toBe('f#/4');
            expect(spec.accidental).toBe('#');
        });

        it('should show natural if key has accidental but note is natural (F in G Major)', () => {
            // F4 (65) in G Major (expects F#) -> f/4, show natural
            const spec = getNoteInKey(65, 'G');
            // rawName for 65 is F.
            expect(spec.keys[0]).toBe('f/4'); // "f/4"
            expect(spec.accidental).toBe('n');
        });
    });
});
