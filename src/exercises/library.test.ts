import { describe, it, expect } from 'vitest';
import { EXERCISES, findExercise, loadExercise } from './library';
import { validateScore, scoreEvents } from '../score/model';

describe('bundled exercise library', () => {
    it('has a non-empty, uniquely-id\'d catalog', () => {
        expect(EXERCISES.length).toBeGreaterThanOrEqual(4);
        const ids = new Set(EXERCISES.map(e => e.id));
        expect(ids.size).toBe(EXERCISES.length);
        for (const ex of EXERCISES) {
            expect(ex.label.length).toBeGreaterThan(0);
            expect(ex.abc.length).toBeGreaterThan(0);
        }
    });

    it('every bundled file parses and validates', () => {
        for (const ex of EXERCISES) {
            const res = loadExercise(ex.id);
            expect(res.ok, `${ex.id}: ${res.ok ? '' : res.error}`).toBe(true);
            if (!res.ok) continue;
            const problems = validateScore(res.value);
            expect(problems, `${ex.id}: ${problems.join('; ')}`).toEqual([]);
            expect(scoreEvents(res.value).length).toBeGreaterThan(0);
            expect(res.value.title.length).toBeGreaterThan(0);
            expect(res.value.source).toBeDefined();
            expect(res.value.source!.rights.length).toBeGreaterThan(0);
        }
    });

    it('exercise sources declare provenance (composer or original)', () => {
        for (const ex of EXERCISES) {
            const res = loadExercise(ex.id);
            if (!res.ok) continue;
            const src = res.value.source!;
            expect(src.composer || '').toBeTruthy();
            expect(src.rights).toBeTruthy();
        }
    });

    it('Ode to Joy theme has the expected note count and midis', () => {
        const res = loadExercise('ode-to-joy');
        expect(res.ok).toBe(true);
        if (!res.ok) return;
        const evts = scoreEvents(res.value);
        expect(evts).toHaveLength(30); // two 4-bar phrases
        expect(res.value.measures).toHaveLength(8);
        // First phrase: E E F G G F E D C C D E
        expect(evts.slice(0, 12).map(e => e.pitch!.midi)).toEqual([64, 64, 65, 67, 67, 65, 64, 62, 60, 60, 62, 64]);
        // Bar 4 dotted rhythm: E3/2 D/2 D2 → 720, 240, 960
        expect(evts[12].durationTicks).toBe(720);
        expect(evts[13].durationTicks).toBe(240);
        expect(evts[14].durationTicks).toBe(960);
    });

    it('unknown exercise ids fail cleanly', () => {
        expect(loadExercise('nope').ok).toBe(false);
        expect(findExercise('nope')).toBeUndefined();
        expect(findExercise('ode-to-joy')?.id).toBe('ode-to-joy');
    });
});
