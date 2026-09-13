/**
 * Minimal pub/sub for RAW pitch-detection frames (contract D1).
 *
 * The detector's rAF loop emits one frame per analysis tick — including
 * silence (midi === null) — which is what phrase matching needs. The
 * smoothed React state (pitchData) is display-only and keeps its 200 ms
 * hold; it must never be used as a release signal.
 *
 * A tiny module-level bus is appropriate here: exactly one detector and at
 * most one trainer exist at any time.
 */

export interface RawPitchFrame {
    /** Raw detected midi (no smoothing, no hysteresis), or null. */
    readonly midi: number | null;
    /** performance.now() at frame emission. */
    readonly at: number;
}

type Listener = (frame: RawPitchFrame) => void;

const listeners = new Set<Listener>();
let emitCount = 0;

export function emitRawFrame(frame: RawPitchFrame): void {
    emitCount++;
    for (const l of listeners) l(frame);
}

/** Total frames emitted since load (diagnostics). */
export function rawFrameCount(): number {
    return emitCount;
}

export function subscribeRawFrames(listener: Listener): () => void {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}
