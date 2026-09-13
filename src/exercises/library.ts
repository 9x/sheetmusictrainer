/**
 * Bundled exercise library (contract G).
 *
 * Files live in src/exercises/library/*.abc and are parsed at runtime by the
 * ABC subset parser. Every file is validated by a unit test. Provenance and
 * adaptation notes are embedded in the files themselves and mirrored in
 * SOURCES.md. Content policy: verified public-domain melodies + original
 * technical exercises only — nothing is attributed to a historical composer
 * without a verifiable source (see docs/PHRASE_MODE_IMPLEMENTATION.md).
 */
import { parseAbc, type AbcParseOptions } from './abcParser';
import type { Result } from '../score/model';
import type { Score } from '../score/model';

import odeRaw from './library/ode-to-joy.abc?raw';
import twinkleRaw from './library/twinkle.abc?raw';
import firstPositionRaw from './library/first-position-study.abc?raw';
import eMinorRaw from './library/e-minor-study.abc?raw';
import dottedRaw from './library/dotted-rhythm-study.abc?raw';
import brokenChordRaw from './library/broken-chord-study.abc?raw';

export interface ExerciseInfo {
    readonly id: string;
    readonly label: string;
    /** Difficulty hint shown in the picker. */
    readonly level: 'beginner' | 'intermediate';
    readonly abc: string;
}

export const EXERCISES: ExerciseInfo[] = [
    { id: 'ode-to-joy', label: 'Ode to Joy (Theme)', level: 'beginner', abc: odeRaw },
    { id: 'twinkle', label: 'Ah! vous dirai-je, maman', level: 'beginner', abc: twinkleRaw },
    { id: 'first-position-study', label: 'First Position Study', level: 'beginner', abc: firstPositionRaw },
    { id: 'e-minor-study', label: 'E Minor Study', level: 'intermediate', abc: eMinorRaw },
    { id: 'dotted-rhythm-study', label: 'Dotted Rhythm Study', level: 'intermediate', abc: dottedRaw },
    { id: 'broken-chord-study', label: 'Broken Chord Study', level: 'intermediate', abc: brokenChordRaw },
];

export function findExercise(id: string): ExerciseInfo | undefined {
    return EXERCISES.find(e => e.id === id);
}

const cache = new Map<string, Result<Score>>();

/** Parse a bundled exercise (memoized; failures are cached too). */
export function loadExercise(id: string, options?: AbcParseOptions): Result<Score> {
    const key = id + (options?.writtenToSoundingSemitones ?? 0);
    const hit = cache.get(key);
    if (hit) return hit;
    const info = findExercise(id);
    const result = info ? parseAbc(info.abc, options) : { ok: false as const, error: `Unknown exercise: ${id}` };
    cache.set(key, result);
    return result;
}
