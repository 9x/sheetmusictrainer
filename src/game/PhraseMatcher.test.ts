import { describe, it, expect } from 'vitest';
import { PhraseMatcher, RELEASE_EVIDENCE_MS, FRAME_GAP_RESET_MS } from './PhraseMatcher';
import { buildSchedule, sanitizeBpm, tickToAudioTime } from './PhraseTransport';
import { generateMelody } from '../music/melodyGenerator';

// Frame cadence of the real detector: ~16.7 ms at 60 fps.
const DT = 16.7;

function frames(matcher: PhraseMatcher, midis: (number | null)[], from: number, idx: number) {
    let t = from;
    for (const m of midis) {
        matcher.feed(m, t, idx);
        t += DT;
    }
    return t;
}

describe('PhraseMatcher — at-your-pace behavior', () => {
    it('C–D–E advances only in order; wrong notes wait', () => {
        const m = new PhraseMatcher([60, 62, 64]);
        // Play E first — nothing happens.
        let out = m.feed(64, 100, 0);
        expect(out).toBeNull();
        frames(m, [64, 64, 64, 64, 64], 116, 0);
        expect(m.status(0)).toBe('pending');
        // Play C → matches note 0 after ~50ms hold.
        let t = 100;
        for (let i = 0; i < 8; i++) {
            out = m.feed(60, t, 0);
            t += DT;
            if (out) break;
        }
        expect(out).toEqual({ matched: 0 });
        expect(m.status(0)).toBe('matched');
        // D next.
        for (let i = 0; i < 8; i++) {
            out = m.feed(62, t, 1);
            t += DT;
            if (out) break;
        }
        expect(out).toEqual({ matched: 1 });
    });

    it('a single stale frame cannot satisfy the hold', () => {
        const m = new PhraseMatcher([60]);
        expect(m.feed(60, 100, 0)).toBeNull();
        expect(m.status(0)).toBe('pending');
    });

    it('repeated C–C: held note does not score twice; release + replay does', () => {
        const m = new PhraseMatcher([60, 60]);
        let t = 100;
        for (let i = 0; i < 6; i++) { m.feed(60, t, 0); t += DT; }
        expect(m.status(0)).toBe('matched');
        // Switch to note 1 (same pitch) and keep holding.
        m.setCurrent(1);
        let out = m.feed(60, t, 1);
        expect(out).toBeNull(); // blocked: same sounding episode
        t = frames(m, [60, 60, 60, 60, 60, 60], t + DT, 1);
        expect(m.status(1)).toBe('pending');
        // Release: >=80ms of fresh null frames.
        t = frames(m, [null, null, null, null, null, null], t + DT, 1);
        // Replay C: fresh attack → match.
        for (let i = 0; i < 6 && !out; i++) { out = m.feed(60, t + DT * i, 1); }
        expect(out).toEqual({ matched: 1 });
        expect(m.status(1)).toBe('matched');
    });

    it('a 20ms dropout does not re-arm; 80ms release does (contract D)', () => {
        const m = new PhraseMatcher([60, 60]);
        let t = 100;
        for (let i = 0; i < 6; i++) { m.feed(60, t, 0); t += DT; }
        expect(m.status(0)).toBe('matched');
        m.setCurrent(1);
        // 1-frame dropout (17ms) — flicker, still blocked.
        m.feed(null, t, 1);
        t += DT;
        let out = m.feed(60, t, 1);
        expect(out).toBeNull();
        t = frames(m, [60, 60, 60, 60, 60], t + DT, 1);
        expect(m.status(1)).toBe('pending');
        // Now a real 85ms release.
        t = frames(m, [null, null, null, null, null, null], t + DT, 1); // ~100ms null
        for (let i = 0; i < 6 && !out; i++) { out = m.feed(60, t + DT * i, 1); }
        expect(out).toEqual({ matched: 1 });
    });

    it('a sample gap >100ms resets hold and release evidence', () => {
        const m = new PhraseMatcher([60]);
        // Hold progress, then a processing gap of 500ms.
        m.feed(60, 100, 0);
        m.feed(60, 116, 0);
        m.feed(60, 116 + 500, 0); // gap → reset, fresh start
        expect(m.status(0)).toBe('pending');
        // 50ms of hold after the gap is required again.
        let matched = false;
        let t = 616;
        for (let i = 0; i < 8; i++) { matched = matched || m.feed(60, t, 0) !== null; t += DT; }
        expect(matched).toBe(true);
    });

    it('a genuinely different pitch establishes a new episode (fast P–Q–P)', () => {
        const m = new PhraseMatcher([60, 60]);
        let t = 100;
        for (let i = 0; i < 6; i++) { m.feed(60, t, 0); t += DT; }
        expect(m.status(0)).toBe('matched');
        m.setCurrent(1);
        // Play Q (64) for 3+ frames: new episode → unblocked.
        t = frames(m, [64, 64, 64], t, 1);
        // Now play C: fresh attack → should match.
        let out: { matched: number } | null = null;
        for (let i = 0; i < 6 && !out; i++) { out = m.feed(60, t + DT * i, 1); }
        expect(out).toEqual({ matched: 1 });
    });

    it('a one-frame flicker to a wrong pitch does not unblock', () => {
        const m = new PhraseMatcher([60, 60]);
        let t = 100;
        for (let i = 0; i < 6; i++) { m.feed(60, t, 0); t += DT; }
        expect(m.status(0)).toBe('matched');
        m.setCurrent(1);
        // Single flicker frame at 64 — must not establish a new episode.
        m.feed(64, t, 1);
        m.feed(60, t + DT, 1);
        t = frames(m, [60, 60, 60, 60, 60], t + 2 * DT, 1);
        expect(m.status(1)).toBe('pending'); // still blocked
    });

    it('virtual taps: repeated taps match repeated notes, no hold needed', () => {
        const m = new PhraseMatcher([60, 60, 67]);
        expect(m.tap(62, 0)).toBeNull(); // wrong pitch
        expect(m.tap(60, 0)).toEqual({ matched: 0 });
        expect(m.tap(60, 1)).toEqual({ matched: 1 }); // re-tap works immediately
        expect(m.tap(67, 2)).toEqual({ matched: 2 });
    });

    it('latched results never change; skip is not a hit', () => {
        const m = new PhraseMatcher([60, 62]);
        m.setStatus(0, 'skipped');
        m.setStatus(0, 'matched'); // ignored — skip is final
        expect(m.status(0)).toBe('skipped');
        expect(m.summary()).toEqual({ total: 2, matched: 0, missed: 0, skipped: 1, rest: 0 });
    });

    it('rests auto-resolve and are excluded from the summary', () => {
        const m = new PhraseMatcher([60, null, 62]);
        expect(m.status(1)).toBe('rest');
        expect(m.summary().total).toBe(2);
    });
});

describe('PhraseMatcher — tempo behavior', () => {
    it('expireWindow marks pending notes missed, keeps latched matches, resolves rests', () => {
        const m = new PhraseMatcher([60, null, 62]);
        // User plays 62 during window 0: no early match.
        m.feed(62, 100, 0);
        m.expireWindow(0);
        expect(m.status(0)).toBe('missed');
        m.expireWindow(1);
        expect(m.status(1)).toBe('rest');
        // Play 62 → match window 2 before it expires.
        let hit = false;
        for (let i = 0; i < 5; i++) { hit = hit || m.feed(62, 200 + 16 * i, 2) !== null; }
        m.expireWindow(2);
        expect(m.status(2)).toBe('matched');
    });

    it('a held C cannot score C–rest–C twice (contract D.3)', () => {
        const m = new PhraseMatcher([60, null, 60]);
        // Sustain C across all three windows.
        let t = 100;
        for (let i = 0; i < 6; i++) { m.feed(60, t, 0); t += DT; }
        expect(m.status(0)).toBe('matched');
        m.setCurrent(1); // rest window: frames continue
        t = frames(m, [60, 60, 60, 60, 60, 60, 60, 60], t, 1);
        m.setCurrent(2);
        const out = m.feed(60, t, 2);
        expect(out).toBeNull(); // blocked — still the same sounding episode
        t = frames(m, [60, 60, 60, 60, 60, 60], t + DT, 2);
        expect(m.status(2)).toBe('pending');
    });

    it('early match latches before the window ends (tempo)', () => {
        const m = new PhraseMatcher([64]);
        let out: { matched: number } | null = null;
        let t = 100;
        for (let i = 0; i < 6 && !out; i++) { out = m.feed(64, t, 0); t += DT; }
        expect(out).toEqual({ matched: 0 });
        m.expireWindow(0);
        expect(m.status(0)).toBe('matched'); // not overwritten by the miss pass
    });
});

describe('PhraseTransport — schedule math', () => {
    const pool = Array.from({ length: 25 }, (_, i) => 48 + i);
    const meter = { numerator: 4 as const, denominator: 4 as const };

    it('at 60 BPM a 4/4 count-in starts the score exactly at +4s', () => {
        const res = generateMelody({ keyTonic: 'C', keyMode: 'major', bars: 2, meter, rhythmLevel: 1, seed: 1 }, pool);
        if (!res.ok) throw new Error(res.error);
        const schedule = buildSchedule(res.value.score, 60, 0, 4);
        const countIns = schedule.filter(e => e.kind === 'count-in-beat');
        expect(countIns.map(e => e.at)).toEqual([0, 1, 2, 3]);
        const firstNoteEnd = schedule.find(e => e.kind === 'note-end')!;
        // First note starts at score start = 4s; ends at 4s + dur.
        const firstEvent = res.value.score.voices[0].events[0];
        expect(firstNoteEnd.at).toBeCloseTo(4 + (firstEvent.durationTicks / 480), 5);
    });

    it('schedules every note end and a done entry at the score end', () => {
        const res = generateMelody({ keyTonic: 'C', keyMode: 'major', bars: 4, meter, rhythmLevel: 1, seed: 5 }, pool);
        if (!res.ok) throw new Error(res.error);
        const schedule = buildSchedule(res.value.score, 90, 10, 0);
        const noteEnds = schedule.filter(e => e.kind === 'note-end');
        expect(noteEnds).toHaveLength(res.value.score.voices[0].events.length);
        const done = schedule.find(e => e.kind === 'done')!;
        expect(done.at).toBeCloseTo(10 + (16 * 480 / 480) * (60 / 90), 5); // 4 bars = 16 beats
    });

    it('no count-in beats when countInBeats = 0', () => {
        const res = generateMelody({ keyTonic: 'C', keyMode: 'major', bars: 1, meter, rhythmLevel: 1, seed: 1 }, pool);
        if (!res.ok) throw new Error(res.error);
        expect(buildSchedule(res.value.score, 60, 0, 0).filter(e => e.kind === 'count-in-beat')).toHaveLength(0);
    });

    it('schedule is sorted and beats cover the whole score', () => {
        const res = generateMelody({ keyTonic: 'C', keyMode: 'major', bars: 2, meter, rhythmLevel: 2, seed: 9 }, pool);
        if (!res.ok) throw new Error(res.error);
        const schedule = buildSchedule(res.value.score, 120, 0, 3);
        for (let i = 1; i < schedule.length; i++) expect(schedule[i].at).toBeGreaterThanOrEqual(schedule[i - 1].at);
        const beats = schedule.filter(e => e.kind === 'beat');
        expect(beats).toHaveLength(8); // 2 bars × 4 beats
    });

    it('sanitizeBpm clamps nonsense', () => {
        expect(sanitizeBpm(NaN)).toBe(60);
        expect(sanitizeBpm(10)).toBe(30);
        expect(sanitizeBpm(999)).toBe(180);
        expect(tickToAudioTime(480, 60, 0)).toBe(1);
    });
});

describe('PhraseMatcher — timing constants are as specified', () => {
    it('uses the contract values', () => {
        expect(RELEASE_EVIDENCE_MS).toBe(80);
        expect(FRAME_GAP_RESET_MS).toBe(100);
    });
});
