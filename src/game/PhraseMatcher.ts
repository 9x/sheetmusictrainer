/**
 * Phrase-mode note matcher (contract D).
 *
 * Extends the single-note MatchTracker philosophy to sequences:
 * - Per-logical-note one-way LATCHED results (a note can only resolve once).
 * - "Episode" tracking: one sustained sounding pitch cannot earn credit for a
 *   later note on the same pitch. After a note with pitch P is (attempted)
 *   sounded, a following note with the same pitch stays BLOCKED until the
 *   user provides release evidence: >= 80 ms of fresh null frames, or a
 *   genuinely different pitch (2-frame stable), which establishes a new
 *   attack/episode.
 * - Flicker tolerance: single-frame dropouts neither re-arm nor unblock; a
 *   sample gap > 100 ms resets the hold timer and release accumulation.
 * - Exact octave matching, reusing the existing MatchTracker (50 ms hold,
 *   150 ms grace) for hold confirmation.
 *
 * Virtual (on-screen) taps are handled by the trainer as discrete attacks,
 * not through feed(): each tap is its own episode and may match immediately.
 */
import { MatchTracker } from './MatchTracker';
import { NOTE_MATCH_GRACE_MS, NOTE_MATCH_THRESHOLD_MS } from '../AppConfig';

export type NoteStatus = 'pending' | 'matched' | 'missed' | 'skipped' | 'rest';

/** Freshness window: frames older than this reset the hold timer. */
export const FRAME_GAP_RESET_MS = 100;
/** Release evidence: sustained null frames needed to re-arm a repeated pitch. */
export const RELEASE_EVIDENCE_MS = 80;
/** A different pitch must persist this many frames to establish a new episode. */
const EPISODE_STABLE_FRAMES = 2;

export interface FeedOutcome {
    /** Index of the note that just got matched (latched). */
    readonly matched: number;
}

export class PhraseMatcher {
    private readonly targetMidis: (number | null)[];
    private readonly statuses: NoteStatus[];
    private readonly tracker = new MatchTracker(NOTE_MATCH_THRESHOLD_MS, NOTE_MATCH_GRACE_MS);

    private lastFrameAt = 0;
    private nullAccumMs = 0;
    /** Pitch of the user's current sounding episode (null = released). */
    private episodePitch: number | null = null;
    private candidatePitch: number | null = null;
    private candidateFrames = 0;
    /** True while the current note needs release evidence (repeated pitch). */
    private blocked = false;
    private currentIndex = -1;

    constructor(targetMidis: (number | null)[]) {
        this.targetMidis = [...targetMidis];
        this.statuses = targetMidis.map(midi => (midi === null ? 'rest' : 'pending'));
    }

    reset(): void {
        this.statuses.fill('pending');
        for (let i = 0; i < this.statuses.length; i++) {
            if (this.targetMidis[i] === null) this.statuses[i] = 'rest';
        }
        this.tracker.reset();
        this.lastFrameAt = 0;
        this.nullAccumMs = 0;
        this.episodePitch = null;
        this.candidatePitch = null;
        this.candidateFrames = 0;
        this.blocked = false;
        this.currentIndex = -1;
    }

    status(idx: number): NoteStatus {
        return this.statuses[idx] ?? 'pending';
    }

    /** Snapshot of all statuses (for React state mirroring). */
    allStatuses(): NoteStatus[] {
        return [...this.statuses];
    }

    setStatus(idx: number, status: NoteStatus): void {
        // One-way latch: a resolved note never changes.
        if (this.statuses[idx] === 'pending' || this.statuses[idx] === 'rest') {
            this.statuses[idx] = status;
        }
    }

    get firstPending(): number {
        for (let i = 0; i < this.statuses.length; i++) {
            if (this.statuses[i] === 'pending') return i;
        }
        return -1;
    }

    summary(): { total: number; matched: number; missed: number; skipped: number; rest: number } {
        let matched = 0, missed = 0, skipped = 0, rest = 0, total = 0;
        for (let i = 0; i < this.statuses.length; i++) {
            if (this.targetMidis[i] === null) { rest++; continue; }
            total++;
            if (this.statuses[i] === 'matched') matched++;
            else if (this.statuses[i] === 'missed') missed++;
            else if (this.statuses[i] === 'skipped') skipped++;
        }
        return { total, matched, missed, skipped, rest };
    }

    /**
     * Announce which note is currently "up" (cursor). Recomputes the
     * repeated-pitch block from the current episode.
     */
    setCurrent(idx: number): void {
        if (idx === this.currentIndex) return;
        this.currentIndex = idx;
        this.tracker.reset();
        this.updateBlock();
    }

    private updateBlock(): void {
        const target = this.currentIndex >= 0 ? this.targetMidis[this.currentIndex] : null;
        // Blocked when the target pitch was ALREADY sounding when the note
        // became current: a repeated pitch needs release/re-attack evidence.
        // (A fresh attack of the target is handled by the episode logic below,
        // which clears the block when a new episode establishes.)
        this.blocked =
            this.currentIndex >= 0 &&
            target !== null &&
            this.episodePitch === target;
    }

    /**
     * Feed one FRESH raw detection frame (caller must exclude gated/blanked
     * frames — speaker output and metronome clicks).
     *
     * @param midi raw detected pitch (null = silence/unpitched)
     * @param atMs frame arrival time (performance clock, ms)
     * @param currentIdx the note currently up
     * @returns match outcome when a note latched, else null
     */
    feed(midi: number | null, atMs: number, currentIdx: number): FeedOutcome | null {
        if (currentIdx !== this.currentIndex) this.setCurrent(currentIdx);

        const gap = this.lastFrameAt === 0 ? 0 : atMs - this.lastFrameAt;
        this.lastFrameAt = atMs;
        if (gap > FRAME_GAP_RESET_MS) {
            // Processing gap (throttled tab, gated period): forget the hold
            // timer and accumulated release evidence.
            this.tracker.reset();
            this.nullAccumMs = 0;
        }

        if (midi === null) {
            this.nullAccumMs += Math.max(0, gap);
            if (this.nullAccumMs >= RELEASE_EVIDENCE_MS) {
                this.episodePitch = null;
                this.candidatePitch = null;
                this.candidateFrames = 0;
                this.blocked = false; // released → re-attack allowed
            }
            this.tracker.update(false, atMs);
            return null;
        }

        this.nullAccumMs = 0;

        if (midi === this.episodePitch) {
            this.candidatePitch = null;
            this.candidateFrames = 0;
        } else if (midi === this.candidatePitch) {
            if (++this.candidateFrames >= EPISODE_STABLE_FRAMES) {
                // A genuinely different pitch establishes a new episode —
                // both an attack of another note and a re-attack after a
                // quick pitch change. A new episode is a new attack: any
                // pending repeated-pitch block is cleared.
                this.episodePitch = midi;
                this.candidatePitch = null;
                this.candidateFrames = 0;
                this.blocked = false;
            }
        } else {
            this.candidatePitch = midi;
            this.candidateFrames = 1;
        }

        const target = this.currentIndex >= 0 ? this.targetMidis[this.currentIndex] : null;
        if (target === null || this.statuses[this.currentIndex] !== 'pending' || this.blocked) {
            this.tracker.update(false, atMs);
            return null;
        }

        const matching = midi === target;
        if (this.tracker.update(matching, atMs)) {
            this.statuses[this.currentIndex] = 'matched';
            return { matched: this.currentIndex };
        }
        return null;
    }

    /** Virtual input: a discrete attack (tap). May match immediately. */
    tap(midi: number, currentIdx: number): FeedOutcome | null {
        this.setCurrent(currentIdx);
        // Every tap is a fresh attack/episode.
        this.episodePitch = midi;
        this.candidatePitch = null;
        this.candidateFrames = 0;
        this.nullAccumMs = 0;
        const target = this.currentIndex >= 0 ? this.targetMidis[this.currentIndex] : null;
        if (target === midi && this.statuses[this.currentIndex] === 'pending') {
            this.statuses[this.currentIndex] = 'matched';
            this.tracker.reset();
            return { matched: this.currentIndex };
        }
        return null;
    }

    /** Tempo mode: resolve an expired window (call at each event end). */
    expireWindow(idx: number): void {
        if (this.statuses[idx] === 'pending') {
            this.statuses[idx] = this.targetMidis[idx] === null ? 'rest' : 'missed';
        }
    }
}
