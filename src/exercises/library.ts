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
import jingleRaw from './library/jingle-bells.abc?raw';
import maryRaw from './library/mary-had-a-little-lamb.abc?raw';
import londonRaw from './library/london-bridge.abc?raw';
import cMajorRunRaw from './library/c-major-run.abc?raw';
import thirdsRaw from './library/thirds-study.abc?raw';
import aMinorArpRaw from './library/a-minor-arpeggio-study.abc?raw';
import waltzRaw from './library/waltz-study.abc?raw';
import eMinorPentRaw from './library/e-minor-pentatonic-run.abc?raw';
import dottedEighthRaw from './library/dotted-eighth-study.abc?raw';
import mixedRhythmRaw from './library/mixed-rhythm-study.abc?raw';
import fMajorRaw from './library/f-major-study.abc?raw';
import bbMajorRaw from './library/bb-major-study.abc?raw';
import descendingRaw from './library/descending-study.abc?raw';

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
    { id: 'jingle-bells', label: 'Jingle Bells (Opening)', level: 'beginner', abc: jingleRaw },
    { id: 'mary-had-a-little-lamb', label: 'Mary Had a Little Lamb', level: 'beginner', abc: maryRaw },
    { id: 'london-bridge', label: 'London Bridge (First Phrase)', level: 'beginner', abc: londonRaw },
    { id: 'first-position-study', label: 'First Position Study', level: 'beginner', abc: firstPositionRaw },
    { id: 'c-major-run', label: 'C Major Run', level: 'beginner', abc: cMajorRunRaw },
    { id: 'thirds-study', label: 'Thirds Study', level: 'beginner', abc: thirdsRaw },
    { id: 'waltz-study', label: 'Waltz Study (3/4)', level: 'beginner', abc: waltzRaw },
    { id: 'e-minor-study', label: 'E Minor Study', level: 'intermediate', abc: eMinorRaw },
    { id: 'e-minor-pentatonic-run', label: 'E Minor Pentatonic Run', level: 'intermediate', abc: eMinorPentRaw },
    { id: 'dotted-rhythm-study', label: 'Dotted Rhythm Study', level: 'intermediate', abc: dottedRaw },
    { id: 'dotted-eighth-study', label: 'Dotted Eighth Study', level: 'intermediate', abc: dottedEighthRaw },
    { id: 'mixed-rhythm-study', label: 'Mixed Rhythm Study', level: 'intermediate', abc: mixedRhythmRaw },
    { id: 'f-major-study', label: 'F Major Study', level: 'intermediate', abc: fMajorRaw },
    { id: 'bb-major-study', label: 'Bb Major Study', level: 'intermediate', abc: bbMajorRaw },
    { id: 'a-minor-arpeggio-study', label: 'A Minor Arpeggio Study', level: 'intermediate', abc: aMinorArpRaw },
    { id: 'descending-study', label: 'Descending Study', level: 'intermediate', abc: descendingRaw },
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
