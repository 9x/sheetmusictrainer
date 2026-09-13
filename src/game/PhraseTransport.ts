/**
 * Pure schedule math for phrase tempo practice (contract E).
 *
 * The trainer hook builds a Schedule once per run (from the audio-clock
 * start time) and processes it in lookahead order. Scheduling sounds early
 * (lookahead) is fine, but state transitions fire only when the clock
 * reaches the boundary — this module produces those boundaries.
 */
import { PPQ, scoreEvents, type Score } from '../score/model';

export type ScheduleEntryKind = 'count-in-beat' | 'beat' | 'note-end' | 'done';

export interface ScheduleEntry {
    readonly kind: ScheduleEntryKind;
    /** Absolute time on the transport AudioContext clock (seconds). */
    readonly at: number;
    /** Beat number within the count-in (count-in-beat only). */
    readonly beat?: number;
    /** Event index (note-end only). */
    readonly index?: number;
}

export const MIN_PHRASE_BPM = 30;
export const MAX_PHRASE_BPM = 180;

export function sanitizeBpm(bpm: number): number {
    if (!Number.isFinite(bpm)) return 60;
    return Math.max(MIN_PHRASE_BPM, Math.min(MAX_PHRASE_BPM, Math.round(bpm)));
}

/**
 * Build the transport schedule for a run.
 *
 * @param score        the practice slice
 * @param bpm          quarter-note tempo
 * @param startAt      audio-clock time at which the count-in begins
 * @param countInBeats full measure of count-in beats (0 = no count-in)
 */
export function buildSchedule(score: Score, bpm: number, startAt: number, countInBeats: number): ScheduleEntry[] {
    const spb = 60 / sanitizeBpm(bpm); // seconds per quarter beat
    const entries: ScheduleEntry[] = [];

    for (let i = 0; i < countInBeats; i++) {
        entries.push({ kind: 'count-in-beat', at: startAt + i * spb, beat: i });
    }

    const scoreStart = startAt + countInBeats * spb;
    const totalTicks = score.measures.reduce((a, m) => a + m.durationTicks, 0);
    if (totalTicks === 0) return entries;

    // Quarter-note beats while playing (downbeat accent at bar starts).
    const beatCount = Math.floor(totalTicks / PPQ);
    const barTicks = score.meter.numerator * PPQ;
    for (let i = 0; i < beatCount; i++) {
        const tick = i * PPQ;
        entries.push({ kind: 'beat', at: scoreStart + (tick / PPQ) * spb, beat: (tick % barTicks === 0) ? i : undefined, index: i });
    }

    scoreEvents(score).forEach((e, i) => {
        entries.push({
            kind: 'note-end',
            at: scoreStart + ((e.startTick + e.durationTicks) / PPQ) * spb,
            index: i,
        });
    });

    entries.push({ kind: 'done', at: scoreStart + (totalTicks / PPQ) * spb });
    entries.sort((a, b) => a.at - b.at);
    return entries;
}

/** Audio-clock time at which a tick would sound (for tests and the trainer). */
export function tickToAudioTime(tick: number, bpm: number, scoreStart: number): number {
    const spb = 60 / sanitizeBpm(bpm);
    return scoreStart + (tick / PPQ) * spb;
}
