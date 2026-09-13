import { describe, it, expect } from 'vitest';
import { PPQ, validateScore, sliceScore, scoreFitsPool, type Score, type ScoreMeasure, type ScoreEvent } from './model';
import { spelledPitch } from '../music/scales';

const C = (octave: number, alter = 0) => spelledPitch(12 * (octave + 1) + alter, 'C', alter);

function simpleScore(): Score {
    // 4/4, two full bars of quarters: C4 D4 E4 F4 | G4 (half) A4 (half)
    return {
        version: 1,
        id: 'test',
        title: 'Test',
        meter: { numerator: 4, denominator: 4 },
        key: { tonic: 'C', mode: 'major', signature: 'C' },
        measures: [
            { number: 1, startTick: 0, durationTicks: 4 * PPQ },
            { number: 2, startTick: 4 * PPQ, durationTicks: 4 * PPQ },
        ],
        voices: [{
            id: 'melody',
            events: [
                { id: 'a', startTick: 0, durationTicks: PPQ, pitch: C(4) },
                { id: 'b', startTick: PPQ, durationTicks: PPQ, pitch: C(4) },
                { id: 'c', startTick: 2 * PPQ, durationTicks: PPQ, pitch: C(4) },
                { id: 'd', startTick: 3 * PPQ, durationTicks: PPQ, pitch: C(4) },
                { id: 'e', startTick: 4 * PPQ, durationTicks: 2 * PPQ, pitch: C(5) },
                { id: 'f', startTick: 6 * PPQ, durationTicks: 2 * PPQ, pitch: C(5) },
            ],
        }],
    };
}

describe('validateScore', () => {
    it('accepts a well-formed score', () => {
        expect(validateScore(simpleScore())).toEqual([]);
    });

    it('rejects non-contiguous events', () => {
        const s = simpleScore();
        s.voices[0].events[1] = { ...s.voices[0].events[1], startTick: 3 * PPQ };
        expect(validateScore(s).length).toBeGreaterThan(0);
    });

    it('rejects empty and all-rest scores', () => {
        const s = simpleScore();
        const rests = s.voices[0].events.map((e, i) => ({ ...e, id: `r${i}`, pitch: null }));
        const allRests: Score = { ...s, voices: [{ id: 'melody', events: rests }] };
        expect(validateScore(allRests).length).toBeGreaterThan(0);
        expect(validateScore({ ...s, voices: [{ id: 'melody', events: [] }] }).length).toBeGreaterThan(0);
    });

    it('rejects short middle measures', () => {
        const s: Score = { ...simpleScore() };
        (s as { measures: ScoreMeasure[] }).measures = [
            { number: 1, startTick: 0, durationTicks: 4 * PPQ },
            { number: 2, startTick: 4 * PPQ, durationTicks: 3 * PPQ },
        ];
        expect(validateScore(s).some(p => p.includes('measure 2'))).toBe(true);
    });

    it('accepts pickup + complementary final measure', () => {
        const s: Score = { ...simpleScore() };
        // 1-beat pickup, final bar 3 beats. Measures: 1 + 4 + 3 = 8 beats.
        (s as { measures: ScoreMeasure[] }).measures = [
            { number: 1, startTick: 0, durationTicks: PPQ },
            { number: 2, startTick: PPQ, durationTicks: 4 * PPQ },
            { number: 3, startTick: 5 * PPQ, durationTicks: 3 * PPQ },
        ];
        expect(validateScore(s)).toEqual([]);
    });

    it('rejects a short final measure without pickup', () => {
        const s: Score = { ...simpleScore() };
        (s as { measures: ScoreMeasure[] }).measures = [
            { number: 1, startTick: 0, durationTicks: 4 * PPQ },
            { number: 2, startTick: 4 * PPQ, durationTicks: 3 * PPQ },
        ];
        expect(validateScore(s).some(p => p.includes('final measure'))).toBe(true);
    });
});

describe('sliceScore', () => {
    it('keeps the whole score and rebases tick 0', () => {
        const sliced = sliceScore(simpleScore(), 1, 2);
        expect(sliced.measures).toHaveLength(2);
        expect(sliced.measures[0].startTick).toBe(0);
        expect(sliced.measures[1].startTick).toBe(4 * PPQ);
        expect(sliceScore(simpleScore(), 1, 2).voices[0].events).toHaveLength(6);
    });

    it('slices a single middle bar and clips overlapping events', () => {
        const sliced = sliceScore(simpleScore(), 2, 1);
        expect(sliced.measures).toHaveLength(1);
        expect(sliced.measures[0].number).toBe(2);
        const evts = sliced.voices[0].events;
        // Bar 2 originally: half G4 (clip to 2 beats? no: slice keeps whole bar) + half A4
        expect(evts).toHaveLength(2);
        expect(evts[0].startTick).toBe(0);
        expect(evts[0].durationTicks).toBe(2 * PPQ);
    });

    it('turns a tie entering the slice into a fresh attack at tick 0', () => {
        // One event spanning both bars (a merged tie), slice bar 2.
        const s: Score = { ...simpleScore() };
        (s.voices[0] as { events: ScoreEvent[] }).events = [
            { id: 'long', startTick: 0, durationTicks: 8 * PPQ, pitch: C(4) },
        ];
        const sliced = sliceScore(s, 2, 1);
        expect(sliced.voices[0].events).toHaveLength(1);
        expect(sliced.voices[0].events[0].startTick).toBe(0);
        expect(sliced.voices[0].events[0].durationTicks).toBe(4 * PPQ);
    });

    it('preserves bar numbers and id suffix', () => {
        const sliced = sliceScore(simpleScore(), 2, 1);
        expect(sliced.id).toContain(':2+1');
        expect(sliced.measures[0].number).toBe(2);
    });
});

describe('scoreFitsPool', () => {
    it('detects out-of-pool pitches', () => {
        const s = simpleScore();
        expect(scoreFitsPool(s, [60, 62, 64, 65, 67, 69, 72])).toBe(true);
        expect(scoreFitsPool(s, [60])).toBe(false);
    });
});
