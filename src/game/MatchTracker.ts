/**
 * Tracks whether a target note has been held long enough to count as a match.
 *
 * Pitch detection flickers: YIN regularly drops a frame or reports a wrong
 * octave for 1-2 frames during note attacks and decays. A naive "consecutive
 * frames" timer resets on every flicker, so the note display shows green
 * while the match timer keeps restarting and success never fires.
 *
 * This tracker instead tolerates mismatches/dropouts up to `graceMs`:
 * progress survives short interruptions, but an interruption longer than
 * the grace period resets the timer. The timer only *advances* on matching
 * frames, so success can never fire during silence or a wrong note.
 */
export class MatchTracker {
    private readonly thresholdMs: number;
    private readonly graceMs: number;
    private matchStart: number | null = null;
    private mismatchSince: number | null = null;

    constructor(thresholdMs: number, graceMs: number) {
        this.thresholdMs = thresholdMs;
        this.graceMs = graceMs;
    }

    /**
     * Feed one detection frame.
     *
     * @param matching whether the detected pitch currently equals the target
     * @param now      timestamp in ms (e.g. Date.now())
     * @returns true exactly once when the note has been held for thresholdMs
     */
    update(matching: boolean, now: number): boolean {
        if (matching) {
            const interruptedTooLong =
                this.mismatchSince !== null && now - this.mismatchSince > this.graceMs;

            if (this.matchStart === null || interruptedTooLong) {
                this.matchStart = now;
            }
            this.mismatchSince = null;

            if (now - this.matchStart >= this.thresholdMs) {
                this.reset();
                return true;
            }
        } else if (this.matchStart !== null && this.mismatchSince === null) {
            // Start of a potential interruption. Whether it is fatal is decided
            // lazily on the next matching frame, so no timer callback is needed
            // when no frames arrive at all.
            this.mismatchSince = now;
        }
        return false;
    }

    /** Forget all accumulated progress (e.g. when the target note changes). */
    reset(): void {
        this.matchStart = null;
        this.mismatchSince = null;
    }
}
