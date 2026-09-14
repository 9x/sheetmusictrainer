/**
 * Scale drill generator (Phrase Mode) — required material, contract C4.
 *
 * Produces scale runs (up / down / up-and-down) as quarter notes with the
 * final note extended (with ties if needed) to complete its bar. One- and
 * two-octave drills require the COMPLETE scale path to fit the playable
 * pool — an incomplete "one-octave scale" is never emitted; a clear,
 * actionable error is returned instead.
 */
import { PPQ, validateScore, type Result, type Score, type ScoreEvent } from '../score/model';
import { keyFor, scalePitches, type KeyContext, type ModeId } from './scales';

export type DrillDirection = 'up' | 'down' | 'updown';
export type DrillCoverage = 'one-octave' | 'two-octave' | 'position';
export type DrillRhythm = 'quarters' | 'eighths';

export interface DrillConfig {
    readonly keyTonic: string;
    readonly keyMode: ModeId;
    readonly direction: DrillDirection;
    readonly coverage: DrillCoverage;
    readonly meter: { readonly numerator: 3 | 4; readonly denominator: 4 };
    /** Note duration: quarters (default) or eighths. */
    readonly rhythm?: DrillRhythm;
}

/** Complete ascending scale path from a starting tonic, if it fits the pool. */
function octavePath(key: KeyContext, pool: number[], octaves: number, startMidi: number): number[] | null {
    const set = new Set(pool);
    const path: number[] = [startMidi];
    let cur = startMidi;
    for (let o = 0; o < octaves; o++) {
        // Skip the tonic at the start of each octave (it is already in `path`).
        for (let i = (o === 0 ? 1 : 0); i < key.pitchClasses.length; i++) {
            const pc = key.pitchClasses[i];
            const offset = ((pc - (cur % 12)) + 12) % 12;
            const candidate = cur + (offset === 0 ? 12 : offset);
            if (!set.has(candidate)) return null;
            path.push(candidate);
            cur = candidate;
        }
    }
    // Top tonic completes the requested octave span.
    if (!set.has(startMidi + 12 * octaves)) return null;
    path.push(startMidi + 12 * octaves);
    return path;
}

export function generateScaleDrill(
    config: DrillConfig,
    eligiblePitches: number[],
): Result<Score> {
    const key = keyFor(config.keyTonic, config.keyMode);
    const pool = Array.from(new Set(eligiblePitches.filter(m => Number.isInteger(m)))).sort((a, b) => a - b);
    if (pool.length === 0) return { ok: false, error: 'No playable notes in the selected range — widen the note set.' };

    const scaleInPool = scalePitches(key, pool[0], pool[pool.length - 1]).filter(p => pool.includes(p.midi));
    if (scaleInPool.length === 0) return { ok: false, error: 'The selected key has no notes in the playable range — widen the range or change the key.' };

    let path: number[];

    if (config.coverage === 'position') {
        // Traverse the eligible scale notes in order (may start/end away from
        // the tonic — labeled as such in the UI, not a conventional fingering).
        const asc = scaleInPool.map(p => p.midi);
        if (asc.length < 2) return { ok: false, error: 'The selected position contains fewer than two scale notes — widen the fret window or change the key.' };
        if (config.direction === 'up') path = asc;
        else if (config.direction === 'down') path = [...asc].reverse();
        else path = [...asc, ...[...asc].reverse().slice(1)]; // up-down, no duplicate top
    } else {
        const octaves = config.coverage === 'one-octave' ? 1 : 2;
        // Find the lowest tonic start whose complete path fits the pool.
        const tonics = scaleInPool.filter(p => p.pitch.midi % 12 === key.pitchClasses[0]).map(p => p.midi);
        let found: number[] | null = null;
        for (const t of tonics) {
            found = octavePath(key, pool, octaves, t);
            if (found) break;
        }
        if (!found) {
            return {
                ok: false,
                error: octaves === 1
                    ? 'The complete one-octave scale does not fit the playable range — widen the range, or use the "within position" drill.'
                    : 'The complete two-octave scale does not fit the playable range — use one octave or widen the range.',
            };
        }
        const up = found;
        if (config.direction === 'up') path = up;
        else if (config.direction === 'down') path = [...up].reverse();
        else path = [...up, ...[...up].reverse().slice(1)]; // no duplicate turning tonic
    }

    // ---- Rhythm: quarters (default) or eighths; final note extended ---------
    const noteDur = config.rhythm === 'eighths' ? PPQ / 2 : PPQ;
    const full = config.meter.numerator * PPQ;
    if (path.length * noteDur > 8 * full) {
        return { ok: false, error: 'This drill is longer than 8 bars — reduce the coverage, direction or note duration.' };
    }
    const barCount = Math.max(1, Math.ceil((path.length * noteDur) / full));
    const totalTicks = barCount * full;
    const lastDuration = noteDur + (totalTicks - path.length * noteDur);

    const events: ScoreEvent[] = [];
    let cursor = 0;
    const spellFor = (midi: number) => {
        const sp = scalePitches(key, midi, midi);
        const found = sp.find(p => p.midi === midi && pool.includes(p.midi));
        return found ? found.pitch : sp[0]?.pitch ?? null;
    };
    for (let i = 0; i < path.length; i++) {
        const dur = i === path.length - 1 ? lastDuration : noteDur;
        const pitch = spellFor(path[i]);
        if (!pitch) return { ok: false, error: 'Internal error spelling drill pitch.' };
        events.push({ id: `s${i}`, startTick: cursor, durationTicks: dur, pitch });
        cursor += dur;
    }

    const score: Score = {
        version: 1,
        id: `scale-${config.keyTonic}-${config.keyMode}-${config.coverage}-${config.direction}-${config.rhythm ?? 'quarters'}-${config.meter.numerator}4`,
        title: `${key.tonic} scale — ${config.coverage === 'position' ? 'within position' : config.coverage} ${config.direction}`,
        meter: config.meter,
        key: { tonic: config.keyTonic, mode: config.keyMode, signature: key.signature },
        measures: Array.from({ length: barCount }, (_, i) => ({
            number: i + 1,
            startTick: i * full,
            durationTicks: full,
        })),
        voices: [{ id: 'melody', events }],
    };
    const problems = validateScore(score);
    if (problems.length > 0) return { ok: false, error: `Internal drill error: ${problems[0]}` };
    return { ok: true, value: score };
}
