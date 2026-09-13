import { describe, it, expect } from 'vitest';
import { parseAbc, type AbcParseOptions } from './abcParser';
import { PPQ, validateScore, scoreEvents, scoreFitsPool, type Score } from '../score/model';

/** The §G concert-pitch fixture. */
const FIRST_STEPS = [
    'X:1',
    'T:First steps',
    'C:Original exercise',
    'M:4/4',
    'L:1/4',
    'Q:1/4=60',
    'K:C',
    'C D E F | G2 E C |]',
].join('\n');

/** Full header block (M: 4/4, L: 1/4, K: C by default); body starts at line 3. */
const HEADERS = 'M:4/4\nL:1/4\nK:C';
const tune = (body: string, headers: string = HEADERS) => `X:1\n${headers}\n${body}`;
const tuneWithKey = (key: string) => tune('C D E F |', `M:4/4\nL:1/4\nK:${key}`);

function mustParse(text: string, options?: AbcParseOptions): Score {
    const result = parseAbc(text, options);
    if (!result.ok) throw new Error(`expected successful parse, got: ${result.error}`);
    return result.value;
}

function mustFail(text: string, pattern: RegExp, options?: AbcParseOptions): void {
    const result = parseAbc(text, options);
    if (result.ok) {
        throw new Error(`expected parse failure matching ${pattern}, but parsing succeeded`);
    }
    expect(result.error).toMatch(pattern);
}

const midis = (score: Score) => scoreEvents(score).map(e => e.pitch?.midi ?? null);
const durations = (score: Score) => scoreEvents(score).map(e => e.durationTicks);

describe('parseAbc — §G concert-pitch fixture', () => {
    it('parses the fixture with the exact expected pitches and ticks', () => {
        const score = mustParse(FIRST_STEPS);
        expect(midis(score)).toEqual([60, 62, 64, 65, 67, 64, 60]);
        expect(durations(score)).toEqual([480, 480, 480, 480, 960, 480, 480]);
        expect(score.measures).toHaveLength(2);
        expect(score.measures.map(m => m.durationTicks)).toEqual([4 * PPQ, 4 * PPQ]);
        expect(validateScore(score)).toEqual([]);
    });

    it('carries full metadata from the headers', () => {
        const score = mustParse(FIRST_STEPS);
        expect(score.version).toBe(1);
        expect(score.id).toBe('1');
        expect(score.title).toBe('First steps');
        expect(score.meter).toEqual({ numerator: 4, denominator: 4 });
        expect(score.key).toEqual({ tonic: 'C', mode: 'major', signature: 'C' });
        expect(score.voices).toHaveLength(1);
        expect(score.voices[0].id).toBe('melody');
        expect(score.source?.composer).toBe('Original exercise');
        expect(score.source?.rights).toContain('CC0');
        expect(score.source?.rights).toContain('Original exercise');
        expect(score.source?.writtenToSoundingSemitones).toBe(0);
    });

    it('fits the pitch pool of its own notes', () => {
        const score = mustParse(FIRST_STEPS);
        expect(scoreFitsPool(score, [60, 62, 64, 65, 67])).toBe(true);
        expect(scoreFitsPool(score, [60, 62, 64])).toBe(false);
    });
});

describe('parseAbc — headers', () => {
    it('defaults L to 1/8 when absent', () => {
        const score = mustParse('X:1\nM:4/4\nK:C\nC D E F G A B c | C D E F G A B c |');
        expect(durations(score)).toEqual(Array(16).fill(240));
        expect(score.measures.map(m => m.durationTicks)).toEqual([4 * PPQ, 4 * PPQ]);
    });

    it('ignores unknown headers, comments and blank lines silently', () => {
        const text = [
            'X:1',
            '% a full-line comment',
            'Y:unknown header ignored',
            'w:lyrics line ignored',
            '',
            'M:4/4',
            'L:1/4',
            'K:C',
            'C D E F | G2 E C | % trailing comment',
        ].join('\n');
        const score = mustParse(text);
        expect(midis(score)).toEqual([60, 62, 64, 65, 67, 64, 60]);
    });

    it('uses the Q: header as metadata only (ignored)', () => {
        const score = mustParse(`${FIRST_STEPS}\n`);
        expect(score).toBeDefined(); // Q: did not break parsing (covered by fixture)
    });

    it('requires M: and K: before the body', () => {
        mustFail('X:1\nK:C\nC D E F |', /M:/);
        mustFail('X:1\nM:4/4\nC D E F |', /K:/);
    });

    it('rejects unsupported meters and unit lengths', () => {
        mustFail(tune('C D E F |', 'M:6/8\nL:1/4\nK:C'), /6\/8|meter/i);
        mustFail(tune('C D E F |', 'M:C\nL:1/4\nK:C'), /meter/i);
        mustFail(tune('C D E F |', 'M:4/4\nL:1/16\nK:C'), /unit|1\/16/i);
    });

    it('rejects duplicate M:/K: (no changes mid-tune) and a second X:', () => {
        mustFail('X:1\nM:4/4\nL:1/4\nK:C\nC D E F |\nM:3/4\nC D E |', /M:/);
        mustFail('X:1\nM:4/4\nL:1/4\nK:C\nC D E F |\nK:G\nC D E F |', /K:/);
        mustFail('X:1\nM:4/4\nL:1/4\nK:C\nC D E F |\nX:2', /multiple tunes|X:/i);
    });
});

describe('parseAbc — key signatures', () => {
    it('resolves tonic, mode and parent signature', () => {
        expect(mustParse(tuneWithKey('Am')).key).toEqual({ tonic: 'A', mode: 'minor', signature: 'C' });
        expect(mustParse(tuneWithKey('Ddor')).key).toEqual({ tonic: 'D', mode: 'dorian', signature: 'C' });
        expect(mustParse(tuneWithKey('Gmix')).key).toEqual({ tonic: 'G', mode: 'mixolydian', signature: 'C' });
        expect(mustParse(tuneWithKey('Eb')).key).toEqual({ tonic: 'Eb', mode: 'major', signature: 'Eb' });
        expect(mustParse(tuneWithKey('F#')).key).toEqual({ tonic: 'F#', mode: 'major', signature: 'F#' });
        expect(mustParse(tuneWithKey('Bb')).key).toEqual({ tonic: 'Bb', mode: 'major', signature: 'Bb' });
        expect(mustParse(tuneWithKey('_B')).key).toEqual({ tonic: 'Bb', mode: 'major', signature: 'Bb' });
        expect(mustParse(tuneWithKey('Gmaj')).key.mode).toBe('major');
        expect(mustParse(tuneWithKey('Amin')).key.mode).toBe('minor');
        expect(mustParse(tuneWithKey('Eaeo')).key.mode).toBe('minor');
    });

    it('rejects unknown keys and never falls back to C', () => {
        mustFail(tuneWithKey('H'), /unrecognized key/i);
        mustFail(tuneWithKey('Fb'), /unrecognized key/i);
        mustFail(tuneWithKey(''), /unrecognized key/i);
        mustFail(tuneWithKey('Gbmin7'), /unrecognized key/i);
        mustFail(tuneWithKey('C##'), /unrecognized key/i);
    });
});

describe('parseAbc — notes, octaves, accidentals', () => {
    it('applies ABC octave conventions (C = C4 = 60)', () => {
        const score = mustParse(tune('C,, C, C c | c\' c\'\' C c |'));
        expect(midis(score)).toEqual([36, 48, 60, 72, 84, 96, 60, 72]);
        expect(scoreEvents(score)[2].pitch?.step).toBe('C');
        expect(scoreEvents(score)[2].pitch?.octave).toBe(4);
    });

    it('carries accidentals per (letter, octave) within a measure, seeded from the key', () => {
        // §F example: K:G, L:1/4 — signature sharpens F; "=F" naturals it, carry
        // keeps F natural, "^F" sharpens it again; next bar starts sharp.
        const score = mustParse('X:1\nM:4/4\nL:1/4\nK:G\n=F F ^F F | F4 |');
        expect(midis(score)).toEqual([65, 65, 66, 66, 66]);
        expect(validateScore(score)).toEqual([]);
    });

    it('keeps accidentals letter- and octave-specific within the measure', () => {
        // ^f is F5 (78); c is C5 (72) — the sharp must not affect the C
        const score = mustParse(tune('^f c ^f c |'));
        expect(midis(score)).toEqual([78, 72, 78, 72]);
    });

    it('supports doubled accidentals (^^ / __) per §G', () => {
        // Note: the task's error-test bullet lists "^^F" as an error, but §G
        // explicitly requires doubled accidentals; spec wins, "^^F" is alter +2.
        const sharp = mustParse(tune('^^F F F F |'));
        expect(sharp.voices[0].events[0].pitch?.alter).toBe(2);
        expect(midis(sharp)).toEqual([67, 67, 67, 67]);
        const flat = mustParse(tune('__B B B B |'));
        expect(flat.voices[0].events[0].pitch?.alter).toBe(-2);
        expect(midis(flat)).toEqual([69, 69, 69, 69]);
    });

    it('rejects triple and conflicting accidental runs', () => {
        mustFail(tune('^^^F C D E |'), /unsupported accidental/i);
        mustFail(tune('^_F C D E |'), /conflicting accidentals/i);
        mustFail(tune('=^F C D E |'), /conflicting accidentals/i);
    });

    it('rejects stray accidentals and accidentals on rests', () => {
        mustFail(tune('^ C D E F |'), /stray accidental/i);
        mustFail(tune('C D E ^z |'), /rest/i);
    });
});

describe('parseAbc — durations', () => {
    it('supports the exact allowed resulting durations with L:1/4', () => {
        // eighth 240, quarter 480, dotted quarter 720, half 960, dotted half 1440,
        // whole 1920 — every measure exactly full (4/4 = 1920 ticks)
        const score = mustParse(tune('A/2 A A3/2 A | A2 A A | A3 A | A4 |'));
        expect(durations(score)).toEqual([240, 480, 720, 480, 960, 480, 480, 1440, 480, 1920]);
        expect(validateScore(score)).toEqual([]);
    });

    it('writes dotted quarters with L:1/8 via multiplier 3 ("A3" = 720)', () => {
        const score = mustParse('X:1\nM:4/4\nL:1/8\nK:C\nA3 A A A A A |');
        expect(durations(score)).toEqual([720, 240, 240, 240, 240, 240]);
    });

    it('rejects resulting durations outside the supported table', () => {
        // "A3/2" with L:1/8 = 360 ticks (dotted eighth) — not in the supported
        // table; the §G example calling it a "dotted quarter" is inconsistent
        // with the "multiplier × L ticks" rule, which is authoritative here.
        mustFail('X:1\nM:4/4\nL:1/8\nK:C\nA3/2 A A A A A A |', /360|unsupported duration/i);
        mustFail(tune('C/4 C D E F |'), /120|unsupported duration/i);
        mustFail(tune('A6 A B C D |'), /2880|unsupported duration/i);
        mustFail(tune('A0 C D E F |'), /zero duration/i);
    });

    it('supports rests z with the same duration rules', () => {
        const score = mustParse(tune('C z D z |'));
        expect(midis(score)).toEqual([60, null, 62, null]);
        expect(durations(score)).toEqual([480, 480, 480, 480]);
        expect(validateScore(score)).toEqual([]);
    });
});

describe('parseAbc — ties', () => {
    it('merges a tie across a barline into ONE logical event', () => {
        // §G: "one eight-quarter-note logical event" (each C4 = 4 quarters,
        // sum = 8 quarters = 3840 ticks; the task bullet's "1920" contradicts
        // the merge-sum rule and the contract text).
        const score = mustParse(tune('C4- | C4 |'));
        expect(scoreEvents(score)).toHaveLength(1);
        expect(scoreEvents(score)[0].durationTicks).toBe(8 * PPQ);
        expect(scoreEvents(score)[0].startTick).toBe(0);
        expect(score.measures.map(m => m.durationTicks)).toEqual([4 * PPQ, 4 * PPQ]);
        expect(validateScore(score)).toEqual([]);
    });

    it('merges a tie chain inside one measure', () => {
        const score = mustParse('X:1\nM:4/4\nL:1/8\nK:C\nC2- C2- C4 |');
        expect(scoreEvents(score)).toHaveLength(1);
        expect(scoreEvents(score)[0].durationTicks).toBe(4 * PPQ);
        expect(validateScore(score)).toEqual([]);
    });

    it('rejects dangling ties and ties to rests', () => {
        mustFail(tune('C D E F- |'), /dangling tie|no note follows/i);
        mustFail(tune('C4-'), /dangling tie|no note follows/i);
        mustFail(tune('C2 D2- | z2 F2 |'), /tie must connect two notes|rest/i);
    });

    it('rejects ties between different sounding pitches', () => {
        mustFail(tune('C2 D2- | E2 F2 |'), /different sounding pitches/i);
        mustFail(tune('F4- | ^F4 |'), /different sounding pitches/i);
    });

    it('rejects a doubled tie marker', () => {
        mustFail(tune('C2- -C2 D2 E2 |'), /already tied|unexpected "-"/i);
    });
});

describe('parseAbc — repeats', () => {
    it('expands |: ... :| so the segment sounds twice', () => {
        const score = mustParse(tune('C D E F |: G A B c :| C D E F |'));
        expect(midis(score)).toEqual([
            60, 62, 64, 65, 67, 69, 71, 72, 67, 69, 71, 72, 60, 62, 64, 65,
        ]);
        expect(score.measures).toHaveLength(4);
        expect(validateScore(score)).toEqual([]);
    });

    it('repeats from the beginning of the body for an unmatched ":|"', () => {
        const score = mustParse(tune('C D E F :|'));
        expect(midis(score)).toEqual([60, 62, 64, 65, 60, 62, 64, 65]);
        expect(score.measures).toHaveLength(2);
    });

    it('treats an unclosed "|:" as repeating to the end', () => {
        const score = mustParse(tune('C D E F |: G A B c |'));
        expect(midis(score)).toEqual([60, 62, 64, 65, 67, 69, 71, 72, 67, 69, 71, 72]);
        expect(score.measures).toHaveLength(3);
    });

    it('rejects nested repeats and alternate endings', () => {
        mustFail(tune('C D E F |: G A B c |: C D E F :|'), /nested repeats/i);
        mustFail(tune('C D E F |1 G A B c :|2 C D E F |'), /alternate endings/i);
    });

    it('supports ||, |] and :|]', () => {
        const a = mustParse(tune('C D E F || G A B c |]'));
        expect(a.measures).toHaveLength(2);
        // ":|]": repeat close + final barline; unmatched close repeats from start
        const b = mustParse(tune('C D E F :|]'));
        expect(b.measures).toHaveLength(2);
        expect(midis(b)).toEqual([60, 62, 64, 65, 60, 62, 64, 65]);
    });
});

describe('parseAbc — pickups and measure validation', () => {
    it('accepts a pickup complemented by the final measure', () => {
        const score = mustParse(tune('G | C D E F | G3 |'));
        expect(score.measures).toHaveLength(3);
        expect(score.measures.map(m => m.durationTicks)).toEqual([480, 4 * PPQ, 3 * PPQ]);
        expect(midis(score)).toEqual([67, 60, 62, 64, 65, 67]); // "G3" = dotted half G4
        expect(validateScore(score)).toEqual([]);
    });

    it('rejects short middle measures with the measure number', () => {
        mustFail(tune('C D E F | C D E | C D E F |'), /measure 2/);
    });

    it('rejects overfull measures', () => {
        mustFail(tune('C D E F G | C D E F |'), /overfull|measure 1/);
    });

    it('rejects a short final measure without a pickup', () => {
        mustFail(tune('C D E F | G3 |'), /short|measure 2/);
    });

    it('rejects a single short measure and a pickup without complement', () => {
        mustFail(tune('C D E |'), /measure 1 is short/);
        mustFail(tune('G | C D E F | G A B C |'), /not complemented/i);
    });

    it('supports 3/4 meter end to end', () => {
        const score = mustParse('X:1\nM:3/4\nL:1/4\nK:C\nC D E | C D E |');
        expect(score.meter.numerator).toBe(3);
        expect(score.measures.map(m => m.durationTicks)).toEqual([3 * PPQ, 3 * PPQ]);
        expect(validateScore(score)).toEqual([]);
    });
});

describe('parseAbc — rejections of unsupported syntax', () => {
    it('rejects chords, inline fields, tuplets, grace notes, decorations, lyrics, overlays', () => {
        mustFail(tune('[CEG] C D E F |'), /chord|inline field/i);
        mustFail(tune('[K:G] C D E F |'), /chord|inline field/i);
        mustFail(tune('(3 C D E F |'), /tuplet/i);
        mustFail(tune('{g} C D E F |'), /grace/i);
        mustFail(tune('!trill! C D E F |'), /decoration/i);
        mustFail(tune('+accent+ C D E F |'), /decoration/i);
        mustFail(tune('C D "words" E F |'), /lyrics/i);
        mustFail(tune('C & D E F G |'), /overlay|unsupported/i);
    });

    it('rejects unsupported characters and stray tokens', () => {
        mustFail(tune('C D E H |'), /unsupported note letter/i);
        mustFail(tune('C D E Z |'), /unsupported note letter/i);
        mustFail(tune('| 3 C D E F |'), /unsupported/i);
        mustFail(tune('C2, D E F |'), /unsupported/i);
    });

    it('reports line and column for body errors', () => {
        const result = parseAbc('X:1\nM:4/4\nL:1/4\nK:C\n[CEG] C D E F |');
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error).toMatch(/\(line 5, column 1\)/);
            expect(result.error).toMatch(/chord|inline field/i);
        }
        const result2 = parseAbc('X:1\nM:4/4\nL:1/4\nK:C\nC D E F | G [CEG] |\n');
        expect(result2.ok).toBe(false);
        if (!result2.ok) {
            // '[' at column 13 of line 5
            expect(result2.error).toMatch(/\(line 5, column 13\)/);
        }
    });
});

describe('parseAbc — bounds', () => {
    it('rejects oversized input before parsing', () => {
        mustFail('C '.repeat(200 * 1024), /too large|256/i);
    });

    it('rejects more than 256 measures', () => {
        mustFail(`X:1\nM:4/4\nL:1/4\nK:C\n${'C D E F | '.repeat(300)}`, /too many measures/i);
    });
});

describe('parseAbc — writtenToSoundingSemitones', () => {
    it('applies an octave transposition while preserving the spelling (§B.6)', () => {
        const score = mustParse(tune('E, A, C E |'), { writtenToSoundingSemitones: -12 });
        // written E3/A3/C4/E4 (52, 57, 60, 64) sounds an octave lower
        expect(midis(score)).toEqual([40, 45, 48, 52]);
        expect(scoreEvents(score).map(e => [e.pitch?.step, e.pitch?.octave])).toEqual([
            ['E', 2], ['A', 2], ['C', 3], ['E', 3],
        ]);
        expect(score.source?.writtenToSoundingSemitones).toBe(-12);
        expect(validateScore(score)).toEqual([]);
    });

    it('rejects non-octave transpositions (spelling cannot be preserved)', () => {
        mustFail(tune('C D E F |'), /multiple of 12/i, { writtenToSoundingSemitones: -1 });
    });
});

describe('parseAbc — source metadata', () => {
    it('collects C, S, Z into the source record', () => {
        const text = [
            'X:5',
            'T:Test tune',
            'C:Jane Composer',
            'S:Public domain collection',
            'Z:Simplified from the original',
            'M:3/4',
            'L:1/4',
            'K:G',
            'G B d | G B d |',
        ].join('\n');
        const score = mustParse(text);
        expect(score.id).toBe('5');
        expect(score.title).toBe('Test tune');
        expect(score.source?.composer).toBe('Jane Composer');
        expect(score.source?.rights).toContain('Public domain collection');
        expect(score.source?.adaptation).toBe('Simplified from the original');
    });

    it('falls back to a placeholder source when neither S: nor C: is given', () => {
        const score = mustParse('X:1\nM:4/4\nL:1/4\nK:C\nC D E F |');
        expect(score.source?.rights).toContain('unspecified');
        expect(score.id).toBe('1');
    });

    it('uses the abc-untitled fallback id when X: is absent', () => {
        const score = mustParse('M:4/4\nL:1/4\nK:C\nC D E F |');
        expect(score.id).toBe('abc-untitled');
        expect(score.title).toBe('Untitled');
    });

    it('rejects an empty body (headers only) and rest-only tunes', () => {
        mustFail('X:1\nM:4/4\nL:1/4\nK:C\n', /no notes|empty body/i);
        mustFail(tune('z z z z |'), /only rests|no notes/i);
    });

    it('rejects a repeat close before any music', () => {
        mustFail(tune(':| C D E F |'), /no music before it/i);
    });
});
