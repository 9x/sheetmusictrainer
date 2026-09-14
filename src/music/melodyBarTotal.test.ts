import { describe, it, expect } from 'vitest';
import { generateMelody } from './melodyGenerator';
import { scoreEvents, validateScore } from '../score/model';

// Reproduce user report: "bei 4/4 manchmal 5 Viertel in bar 2"
describe('melody generator bar totals (4/4, level 2)', () => {
    const strings = [40, 45, 50, 55, 59, 64];
    const pool: number[] = [];
    for (const open of strings) for (let f = 0; f <= 12; f++) pool.push(open + f);

    it('bar 2 always totals exactly one bar', () => {
        let checked = 0;
        for (let seed = 1; seed <= 500; seed++) {
            const r = generateMelody(
                { keyTonic: 'C', keyMode: 'major', bars: 2, meter: { numerator: 4, denominator: 4 }, rhythmLevel: 2, seed },
                pool,
            );
            if (!r.ok) continue;
            checked++;
            const ev = scoreEvents(r.value.score);
            const problems = validateScore(r.value.score);
            expect(problems, `seed ${seed}`).toEqual([]);
            const bar2 = ev.filter(e => e.startTick >= 1920 && e.startTick < 3840);
            const bar2Len = bar2.reduce((a, e) => a + e.durationTicks, 0);
            expect(bar2Len, `seed ${seed} bar2 ticks`).toBe(1920);
        }
        expect(checked).toBeGreaterThan(400);
    });
});
