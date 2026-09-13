import { describe, it, expect } from 'vitest';
import { MatchTracker } from './MatchTracker';

const THRESHOLD = 50;
const GRACE = 150;

describe('MatchTracker', () => {
    it('does not trigger before the threshold', () => {
        const t = new MatchTracker(THRESHOLD, GRACE);
        expect(t.update(true, 0)).toBe(false);
        expect(t.update(true, 49)).toBe(false);
    });

    it('triggers once the threshold is reached', () => {
        const t = new MatchTracker(THRESHOLD, GRACE);
        expect(t.update(true, 0)).toBe(false);
        expect(t.update(true, 50)).toBe(true);
    });

    it('triggers exactly once, then starts fresh', () => {
        const t = new MatchTracker(THRESHOLD, GRACE);
        t.update(true, 0);
        expect(t.update(true, 60)).toBe(true);
        // After triggering, tracker is reset: next frame must not re-trigger
        expect(t.update(true, 70)).toBe(false);
    });

    it('survives a brief dropout within the grace period', () => {
        const t = new MatchTracker(THRESHOLD, GRACE);
        t.update(true, 0);          // start matching
        t.update(false, 30);        // one flickered frame
        expect(t.update(true, 60)).toBe(true); // 60ms elapsed > 50ms threshold
    });

    it('survives several short dropouts', () => {
        const t = new MatchTracker(THRESHOLD, GRACE);
        t.update(true, 0);
        t.update(false, 16);
        t.update(true, 32);
        t.update(false, 48);
        expect(t.update(true, 64)).toBe(true);
    });

    it('resets when the interruption exceeds the grace period', () => {
        const t = new MatchTracker(THRESHOLD, GRACE);
        t.update(true, 0);
        t.update(false, 10);
        // 200ms of silence later the user plays the note again:
        // must NOT inherit the 200ms-old start time (that would fire instantly)
        expect(t.update(true, 210)).toBe(false);
        expect(t.update(true, 259)).toBe(false);
        expect(t.update(true, 260)).toBe(true);
    });

    it('resets when a wrong note persists beyond grace', () => {
        const t = new MatchTracker(THRESHOLD, GRACE);
        t.update(true, 0);
        t.update(false, 20);
        t.update(false, 200);       // wrong note held: grace exceeded
        expect(t.update(true, 210)).toBe(false); // restart from ~210
        expect(t.update(true, 261)).toBe(true);
    });

    it('never triggers on non-matching frames alone', () => {
        const t = new MatchTracker(THRESHOLD, GRACE);
        expect(t.update(false, 0)).toBe(false);
        expect(t.update(false, 1000)).toBe(false);
    });

    it('handles frames arriving long after the last one (throttled tab)', () => {
        const t = new MatchTracker(THRESHOLD, GRACE);
        // No frames for a while, then a single matching frame: fresh start.
        expect(t.update(true, 5000)).toBe(false);
    });

    it('reset() clears accumulated progress', () => {
        const t = new MatchTracker(THRESHOLD, GRACE);
        t.update(true, 0);
        t.update(true, 40);
        t.reset();
        expect(t.update(true, 50)).toBe(false); // restarted at 50
        expect(t.update(true, 100)).toBe(true);
    });
});
