/**
 * ABC-notation subset parser for the Sheet Music Trainer's Phrase Mode.
 *
 * Implements the subset specified in docs/PHRASE_MODE_IMPLEMENTATION.md §G and
 * produces the normalized Score model from src/score/model.ts (§B). The parser
 * is pure: no globals, no network, no eval, no I/O.
 *
 * Supported subset:
 * - Headers X, T, C, S, Z, M, L, Q, K; blank lines and %-comments are ignored;
 *   unknown `word:` headers are ignored silently. M: and K: are required
 *   before the tune body; L: defaults to 1/8; X is optional.
 * - M: exactly 3/4 or 4/4; L: exactly 1/4 or 1/8.
 * - K: tonic letter A-G with an optional accidental (prefix ^/_/^^/__, or
 *   suffix #/b) and an optional mode suffix (none/maj = major, m/min = minor,
 *   or ion/dor/phr/lyd/mix/aeo/loc). Unknown keys are rejected — never a
 *   silent fallback to C.
 * - Notes a-g/A-G with octave marks (',' down, "'" up), accidentals, and
 *   duration multipliers (integer, /n, n/m — dots are written as multipliers)
 *   relative to L. Supported resulting durations ONLY: 240 (eighth), 480
 *   (quarter), 720 (dotted quarter), 960 (half), 1440 (dotted half), 1920
 *   (whole) ticks at PPQ=480.
 * - Rests z with the same duration rules -> events with pitch null.
 * - Ties '-' between two notes of the SAME sounding pitch (also across
 *   barlines), merged into ONE ScoreEvent whose duration is the sum.
 * - Barlines '|', '||', '|]'; simple non-nested '|: ... :|' repeats play the
 *   segment twice (expanded); an unmatched ':|' repeats from the beginning of
 *   the body; an unclosed '|:' repeats to the end (standard ABC behaviour).
 * - Accidental carry per (letter, octave) within each measure, seeded at each
 *   new measure from the key signature (all octaves), reset at every barline.
 * - Measure validation: every measure full (numerator × 480), EXCEPT a short
 *   first pickup measure which must be complemented by the final measure
 *   (pickup + final = full). Short middle / overfull measures are errors.
 *
 * Deliberate readings of spec ambiguities (see the task handoff notes):
 * - Durations are standard ABC: multiplier × L ticks. The §G example
 *   "A3/2 with L:1/8 = dotted quarter" is arithmetically inconsistent with
 *   that rule (1.5 × 240 = 360 ticks, a dotted eighth, which is NOT in the
 *   supported table); with L:1/4, A3/2 IS the dotted quarter (720), and with
 *   L:1/8, A3 is the dotted quarter. The absolute supported-ticks table is
 *   authoritative.
 * - Doubled accidentals ^^/__ are SUPPORTED (§G explicitly requires "doubled
 *   accidentals"); "^^F" is therefore valid despite one bullet in the task's
 *   error-test list. Triple or conflicting accidental runs are rejected.
 * - writtenToSoundingSemitones is ADDED to the written midi (§B.6: -12 turns
 *   written E3/52 into sounding E2/40 while keeping the spelling); the task
 *   text's word "subtract" would flip the sign for the same example value.
 * - "C4- | C4 |" (L:1/4) merges into ONE event of 3840 ticks — eight quarter
 *   notes, per §G ("one eight-quarter-note logical event") and the merge-sum
 *   rule; 1920 ticks would contradict both.
 */

import { PPQ, LETTER_PC, STEP_LETTERS, validateScore } from '../score/model';
import type {
    Result,
    Score,
    ScoreMeasure,
    SpelledPitch,
    StepLetter,
} from '../score/model';
import { TONICS, keyFor, spelledPitch } from '../music/scales';
import type { KeyContext, ModeId } from '../music/scales';

export interface AbcParseOptions {
    /**
     * Semitones from WRITTEN source pitch to sounding pitch (§B.6), e.g. -12
     * for written guitar/bass material. The parser adds this value to the
     * written midi while keeping the spelling (recomputing the octave).
     * Must be an integer multiple of 12 in this subset. Default 0 (concert
     * pitch).
     */
    writtenToSoundingSemitones?: number;
}

/** Input/measure/event bounds (§G), enforced during parsing, not after. */
const MAX_INPUT_CHARS = 256 * 1024;
const MAX_MEASURES = 256;
const MAX_EVENTS = 4096;

/** The only note lengths the subset supports (ticks at PPQ = 480). */
const SUPPORTED_DURATION_TICKS: readonly number[] = [240, 480, 720, 960, 1440, 1920];

interface Pos {
    readonly line: number;
    readonly col: number;
}

/** A parse failure; when no position applies the message stands alone. */
const fail = (message: string, pos?: Pos): { ok: false; error: string } => ({
    ok: false,
    error: pos ? `${message} (line ${pos.line}, column ${pos.col})` : message,
});

/** One note or rest as written in the body (pitch already resolved). */
interface NoteSpec {
    readonly isRest: boolean;
    readonly pitch: SpelledPitch | null;
    readonly durationTicks: number;
    /** True when a '-' tie follows this note (checked/merged at build time). */
    tieToNext: boolean;
    readonly pos: Pos;
}

/** Names for rejected syntax, used in error messages. */
const UNSUPPORTED_NOTATION: Record<string, string> = {
    '[': 'chords and inline fields (e.g. [CEG] or [K:...])',
    '(': 'tuplets and slurs (e.g. (3)',
    '{': 'grace notes',
    '"': 'lyrics and annotations',
    '!': 'decorations (e.g. !trill!)',
    '+': 'decorations (e.g. +accent+)',
    '&': 'voice overlays',
};

const describePitch = (p: SpelledPitch): string => {
    const acc = p.alter === 2 ? '##' : p.alter === 1 ? '#' : p.alter === -2 ? 'bb' : p.alter === -1 ? 'b' : '';
    return `${p.step}${acc}${p.octave}`;
};

export function parseAbc(text: string, options: AbcParseOptions = {}): Result<Score> {
    const shift = options.writtenToSoundingSemitones ?? 0;
    if (!Number.isInteger(shift) || ((shift % 12) + 12) % 12 !== 0) {
        return fail(
            `writtenToSoundingSemitones must be an integer multiple of 12 (spelling-preserving octave shift), got ${shift}`,
        );
    }
    if (text.length > MAX_INPUT_CHARS) {
        return fail(`ABC input is too large (${text.length} characters; the limit is 256 KiB)`);
    }

    // ---------------------------------------------------------------- headers
    const h = {
        x: null as string | null,
        t: null as string | null,
        c: null as string | null,
        s: null as string | null,
        z: null as string | null,
        q: null as string | null,
        meterNumerator: 0 as 0 | 3 | 4,
        unitTicks: 240, // default L:1/8
        key: null as KeyContext | null,
        seen: new Set<string>(),
    };

    const parseKeyHeader = (value: string, pos: Pos): { ok: false; error: string } | null => {
        const spec = value.trim();
        let i = 0;
        let prefixAlter = 0;
        while (i < spec.length && (spec[i] === '^' || spec[i] === '_')) {
            prefixAlter += spec[i] === '^' ? 1 : -1;
            i++;
        }
        if (i >= spec.length || !/^[A-G]$/.test(spec[i])) {
            return fail(
                `unrecognized key "${value}" — expected a tonic letter A-G with an optional accidental and mode suffix (e.g. K:G, K:F#, K:Am, K:Ddor, K:Eb)`,
                pos,
            );
        }
        const letter = spec[i].toUpperCase();
        i++;
        let suffixAlter = 0;
        while (i < spec.length && (spec[i] === '#' || spec[i] === 'b')) {
            suffixAlter += spec[i] === '#' ? 1 : -1;
            i++;
        }
        if (prefixAlter !== 0 && suffixAlter !== 0) {
            return fail(`unrecognized key "${value}" — mixing prefix and suffix accidentals`, pos);
        }
        const totalAlter = prefixAlter + suffixAlter;
        if (Math.abs(totalAlter) > 1) {
            return fail(`unrecognized key "${value}" — double accidentals are not supported in key signatures`, pos);
        }
        const modeWord = spec.slice(i).trim().toLowerCase();
        const MODE_MAP: Record<string, ModeId> = {
            '': 'major', maj: 'major', ion: 'major',
            m: 'minor', min: 'minor', aeo: 'minor',
            dor: 'dorian', phr: 'phrygian', lyd: 'lydian',
            mix: 'mixolydian', loc: 'locrian',
        };
        const mode = MODE_MAP[modeWord];
        if (!mode) {
            return fail(
                `unrecognized key "${value}" — unknown mode suffix "${modeWord}" (supported: none, maj, m, min, ion, dor, phr, lyd, mix, aeo, loc)`,
                pos,
            );
        }
        const tonicName = totalAlter === 1 ? `${letter}#` : totalAlter === -1 ? `${letter}b` : letter;
        if (!(tonicName in TONICS)) {
            return fail(`unrecognized key "${value}" — no conventional signature for tonic "${tonicName}"`, pos);
        }
        h.key = keyFor(tonicName, mode);
        return null;
    };

    const handleHeader = (letter: string, value: string, pos: Pos): { ok: false; error: string } | null => {
        switch (letter) {
            case 'x':
                if (h.seen.has('x')) {
                    return fail('multiple tunes are not supported (second "X:" header)', pos);
                }
                h.seen.add('x');
                h.x = value;
                return null;
            case 'm': {
                if (h.seen.has('m')) {
                    return fail('duplicate "M:" header (meter changes mid-tune are not supported)', pos);
                }
                h.seen.add('m');
                const match = /^([34])\/4$/.exec(value);
                if (!match) {
                    return fail(`unsupported meter "${value || '(empty)'}" — only M:3/4 and M:4/4 are supported`, pos);
                }
                h.meterNumerator = Number(match[1]) as 3 | 4;
                return null;
            }
            case 'l': {
                if (h.seen.has('l')) return fail('duplicate "L:" header', pos);
                h.seen.add('l');
                const match = /^1\/([48])$/.exec(value);
                if (!match) {
                    return fail(`unsupported unit length "${value || '(empty)'}" — only L:1/4 and L:1/8 are supported`, pos);
                }
                h.unitTicks = Number(match[1]) === 4 ? PPQ : PPQ / 2;
                return null;
            }
            case 'k': {
                if (h.seen.has('k')) {
                    return fail('duplicate "K:" header (key changes mid-tune are not supported)', pos);
                }
                h.seen.add('k');
                return parseKeyHeader(value, pos);
            }
            case 't':
            case 'c':
            case 's':
            case 'z':
            case 'q': {
                // Metadata: the first occurrence wins, later ones are ignored.
                if (!h.seen.has(letter)) {
                    h.seen.add(letter);
                    h[letter] = value;
                }
                return null;
            }
            default:
                return null; // unknown header: ignored silently (§G)
        }
    };

    // ------------------------------------------------------------------ body
    /** Accidental carry per (letter, octave) within the current measure. */
    let carry = new Map<string, number>();
    let cur: NoteSpec[] = [];
    const measures: NoteSpec[][] = [];
    let repeatStart: number | null = null;
    let bodySeen = false;

    const pushMeasure = (pos: Pos): { ok: false; error: string } | null => {
        if (cur.length === 0) return null; // redundant/leading barline: no measure
        if (measures.length >= MAX_MEASURES) {
            return fail(`too many measures (limit ${MAX_MEASURES})`, pos);
        }
        measures.push(cur);
        cur = [];
        carry = new Map(); // accidental carry resets at every barline
        return null;
    };

    const closeRepeat = (pos: Pos): { ok: false; error: string } | null => {
        const pushed = pushMeasure(pos);
        if (pushed) return pushed;
        const start = repeatStart ?? 0; // unmatched ":|" repeats from the body start
        const segment = measures.slice(start);
        if (segment.length === 0) return fail('empty repeat section', pos);
        for (const segmentMeasure of segment) {
            if (measures.length >= MAX_MEASURES) {
                return fail(`too many measures after repeat expansion (limit ${MAX_MEASURES})`, pos);
            }
            measures.push(segmentMeasure);
        }
        repeatStart = null;
        return null;
    };

    const parseDuration = (
        raw: string,
        start: number,
        pos: Pos,
    ): { ok: true; nextIndex: number; ticks: number } | { ok: false; error: string } => {
        let i = start;
        const n = raw.length;
        let numStr = '';
        while (i < n && raw[i] >= '0' && raw[i] <= '9') {
            numStr += raw[i];
            i++;
        }
        let hasSlash = false;
        let denStr = '';
        if (i < n && raw[i] === '/') {
            hasSlash = true;
            i++;
            while (i < n && raw[i] >= '0' && raw[i] <= '9') {
                denStr += raw[i];
                i++;
            }
        }
        if (numStr.length === 0 && !hasSlash) {
            return { ok: true, nextIndex: start, ticks: h.unitTicks };
        }
        if (numStr.length > 6 || denStr.length > 6) {
            return fail(`duration "${raw.slice(start, i)}" is out of range`, pos);
        }
        const num = numStr.length > 0 ? Number(numStr) : 1;
        const den = hasSlash ? (denStr.length > 0 ? Number(denStr) : 2) : 1;
        if (num === 0) return fail(`zero duration "${raw.slice(start, i)}"`, pos);
        const product = num * h.unitTicks;
        if (product % den !== 0) {
            return fail(`unsupported duration "${raw.slice(start, i)}" — it does not resolve to whole ticks`, pos);
        }
        const ticks = product / den;
        if (!SUPPORTED_DURATION_TICKS.includes(ticks)) {
            return fail(
                `unsupported duration "${raw.slice(start, i)}" = ${ticks} ticks — supported: eighth 240, quarter 480, dotted quarter 720, half 960, dotted half 1440, whole 1920`,
                pos,
            );
        }
        return { ok: true, nextIndex: i, ticks };
    };

    const parseNoteToken = (
        raw: string,
        start: number,
        line: number,
        key: KeyContext,
    ): { ok: true; nextIndex: number } | { ok: false; error: string } => {
        let i = start;
        const n = raw.length;
        const pos = (): Pos => ({ line, col: start + 1 });

        // Optional accidental prefix: ^ ^^ __ _ = (no mixing of kinds).
        let explicitAlter: number | null = null;
        if (raw[i] === '^' || raw[i] === '_' || raw[i] === '=') {
            let sharps = 0;
            let flats = 0;
            let naturals = 0;
            while (i < n && (raw[i] === '^' || raw[i] === '_' || raw[i] === '=')) {
                if (raw[i] === '^') sharps++;
                else if (raw[i] === '_') flats++;
                else naturals++;
                i++;
            }
            if (naturals > 0 && (sharps > 0 || flats > 0)) {
                return fail('conflicting accidentals — "=" cannot be combined with "^" or "_"', pos());
            }
            if (sharps > 0 && flats > 0) {
                return fail('conflicting accidentals — "^" and "_" cannot be combined', pos());
            }
            if (naturals > 1) return fail('repeated "=" accidental', pos());
            if (sharps > 2 || flats > 2) {
                return fail('unsupported accidental — at most doubled ("^^" or "__")', pos());
            }
            explicitAlter = sharps - flats;
        }

        if (i >= n || !/[a-zA-Z]/.test(raw[i])) {
            if (explicitAlter !== null) {
                return fail('stray accidental — expected a note letter after the accidental', pos());
            }
            return fail(`unexpected character "${raw[i] ?? ''}"`, pos());
        }
        const ch = raw[i];

        if (ch === 'z') {
            if (explicitAlter !== null) {
                return fail('accidentals apply to notes, not rests', pos());
            }
            const dur = parseDuration(raw, i + 1, pos());
            if (!dur.ok) return dur;
            cur.push({ isRest: true, pitch: null, durationTicks: dur.ticks, tieToNext: false, pos: pos() });
            return { ok: true, nextIndex: dur.nextIndex };
        }

        if (!/^[a-gA-G]$/.test(ch)) {
            return fail(`unsupported note letter "${ch}" — only A-G/a-g (and rests z) are supported`, pos());
        }

        const isLower = ch >= 'a' && ch <= 'g';
        const letter = (isLower ? ch.toUpperCase() : ch) as StepLetter;
        let octave = isLower ? 5 : 4; // ABC: C = C4 (midi 60), c = C5 (72)
        i++;
        while (i < n && (raw[i] === ',' || raw[i] === "'")) {
            octave += raw[i] === ',' ? -1 : 1;
            i++;
        }
        const dur = parseDuration(raw, i, { line, col: i + 1 });
        if (!dur.ok) return dur;

        // Accidental carry: explicit accidental wins, else this measure's
        // carried value for (letter, octave), else the key signature.
        const carryKey = `${letter}${octave}`;
        const alter = explicitAlter ?? carry.get(carryKey) ?? key.signatureAlter[letter];
        const writtenMidi = 12 * (octave + 1) + LETTER_PC[STEP_LETTERS.indexOf(letter)] + alter;
        const soundingMidi = writtenMidi + shift;
        if (soundingMidi < 0 || soundingMidi > 127) {
            return fail(`note "${raw.slice(start, i)}" resolves to MIDI ${soundingMidi}, outside the range 0-127`, pos());
        }
        let pitch: SpelledPitch;
        try {
            pitch = spelledPitch(soundingMidi, letter, alter);
        } catch {
            return fail(`internal spelling error for "${raw.slice(start, i)}"`, pos());
        }
        if (explicitAlter !== null) carry.set(carryKey, explicitAlter);
        cur.push({ isRest: false, pitch, durationTicks: dur.ticks, tieToNext: false, pos: pos() });
        return { ok: true, nextIndex: dur.nextIndex };
    };

    const tokenizeLine = (raw: string, line: number): { ok: false; error: string } | null => {
        let i = 0;
        const n = raw.length;
        while (i < n) {
            const ch = raw[i];
            const col = i + 1;
            if (ch === ' ' || ch === '\t') {
                i++;
                continue;
            }
            if (ch === '%') break; // comment to end of line
            if (!bodySeen) {
                if (h.meterNumerator === 0) {
                    return fail('missing "M:" header before the tune body', { line, col });
                }
                if (!h.key) {
                    return fail('missing "K:" header before the tune body', { line, col });
                }
                bodySeen = true;
            }
            const here: Pos = { line, col };

            if (ch === '|') {
                const next = raw[i + 1] ?? '';
                if (next === '|' || next === ']') {
                    const pushed = pushMeasure(here);
                    if (pushed) return pushed;
                    i += 2;
                    continue;
                }
                if (next === ':') {
                    if (repeatStart !== null) {
                        return fail('nested repeats are not supported', here);
                    }
                    const pushed = pushMeasure(here);
                    if (pushed) return pushed;
                    repeatStart = measures.length;
                    i += 2;
                    continue;
                }
                if (next >= '0' && next <= '9') {
                    return fail('alternate endings (|1, |2) are not supported', here);
                }
                const pushed = pushMeasure(here);
                if (pushed) return pushed;
                i++;
                continue;
            }
            if (ch === ':') {
                if (raw[i + 1] === '|') {
                    let j = i + 2;
                    if (raw[j] === ']') j++; // ":|]" = repeat close + final barline
                    if (repeatStart === null && measures.length === 0 && cur.length === 0) {
                        return fail('repeat close ":|" with no music before it', here);
                    }
                    const closed = closeRepeat(here);
                    if (closed) return closed;
                    i = j;
                    continue;
                }
                return fail('unexpected ":" — only ":|" repeat closes are supported', here);
            }
            if (ch === '-') {
                const last = cur.length > 0 ? cur[cur.length - 1] : null;
                if (!last || last.isRest) {
                    return fail('unexpected "-" — ties connect two notes', here);
                }
                if (last.tieToNext) {
                    return fail('unexpected "-" — this note is already tied', here);
                }
                last.tieToNext = true;
                i++;
                continue;
            }
            if (/[a-gA-Gz^_=]/.test(ch)) {
                const key = h.key; // non-null: bodySeen was checked above
                if (!key) return fail('missing "K:" header before the tune body', here);
                const parsed = parseNoteToken(raw, i, line, key);
                if (!parsed.ok) return parsed;
                i = parsed.nextIndex;
                continue;
            }
            const named = UNSUPPORTED_NOTATION[ch];
            if (named) {
                return fail(`unsupported syntax "${ch}" — ${named} are not supported in this subset`, here);
            }
            if (/^[a-zA-Z]$/.test(ch)) {
                return fail(`unsupported note letter "${ch}" — only A-G/a-g (and rests z) are supported`, here);
            }
            return fail(`unsupported syntax "${ch}" — this character is not supported in this subset`, here);
        }
        return null;
    };

    const lines = text.split(/\r?\n/);
    for (let li = 0; li < lines.length; li++) {
        const raw = lines[li];
        const line = li + 1;
        const trimmed = raw.trim();
        if (trimmed.length === 0 || trimmed.startsWith('%')) continue; // blank/comment

        const headerMatch = /^\s*([A-Za-z]+):(.*)$/.exec(raw);
        if (headerMatch) {
            const letter = headerMatch[1].toLowerCase();
            const value = headerMatch[2].trim();
            const pos: Pos = { line, col: raw.indexOf(':') + 2 };
            const err = handleHeader(letter, value, pos);
            if (err) return err;
            continue;
        }
        const err = tokenizeLine(raw, line);
        if (err) return err;
    }

    // ------------------------------------------------- finalize / expansion
    const endPos: Pos = { line: lines.length, col: 1 };
    if (repeatStart !== null) {
        // Unclosed "|:" repeats to the end of the tune (standard ABC).
        const pushed = pushMeasure(endPos);
        if (pushed) return pushed;
        const segment = measures.slice(repeatStart);
        if (segment.length === 0) return fail('empty repeat section');
        for (const segmentMeasure of segment) {
            if (measures.length >= MAX_MEASURES) {
                return fail(`too many measures after repeat expansion (limit ${MAX_MEASURES})`, endPos);
            }
            measures.push(segmentMeasure);
        }
        repeatStart = null;
    } else {
        const pushed = pushMeasure(endPos);
        if (pushed) return pushed;
    }

    if (measures.length === 0) {
        return fail('the tune contains no notes (empty body)');
    }

    // ------------------------------------------------------ measure checks
    const numMeasures = measures.length;
    const full = h.meterNumerator * PPQ;
    const sums = measures.map(ms => ms.reduce((total, note) => total + note.durationTicks, 0));

    for (let m = 0; m < numMeasures; m++) {
        if (sums[m] > full) {
            return fail(
                `measure ${m + 1} is overfull: ${sums[m]} ticks (expected ${full} for ${h.meterNumerator}/4)`,
            );
        }
    }
    if (numMeasures === 1) {
        if (sums[0] !== full) {
            return fail(`measure 1 is short: ${sums[0]} ticks (expected ${full} for ${h.meterNumerator}/4)`);
        }
    } else {
        for (let m = 1; m < numMeasures; m++) {
            const mayComplement = m === numMeasures - 1 && sums[0] < full;
            if (sums[m] < full && !mayComplement) {
                return fail(
                    `measure ${m + 1} is short: ${sums[m]} ticks (expected ${full} for ${h.meterNumerator}/4)`,
                );
            }
        }
        if (sums[0] < full && sums[0] + sums[numMeasures - 1] !== full) {
            return fail(
                `pickup measure is not complemented: measure 1 (${sums[0]}) + final measure (${sums[numMeasures - 1]}) != ${full} ticks`,
            );
        }
    }

    // ------------------------------------------------------- event building
    interface MutableEvent {
        id: string;
        startTick: number;
        durationTicks: number;
        pitch: SpelledPitch | null;
    }
    const events: MutableEvent[] = [];
    let tick = 0;
    let eventSeq = 0;
    let tieOpen: NoteSpec | null = null;

    for (let m = 0; m < numMeasures; m++) {
        for (const note of measures[m]) {
            if (tieOpen) {
                if (!note.pitch || !tieOpen.pitch) {
                    return fail('a tie must connect two notes, but a rest follows the tied note', note.pos);
                }
                if (tieOpen.pitch.midi !== note.pitch.midi) {
                    return fail(
                        `tie connects different sounding pitches (${describePitch(tieOpen.pitch)} != ${describePitch(note.pitch)})`,
                        note.pos,
                    );
                }
                const merged = events[events.length - 1];
                merged.durationTicks += note.durationTicks;
                tieOpen = note.tieToNext ? note : null;
            } else {
                if (events.length >= MAX_EVENTS) {
                    return fail(`too many events (limit ${MAX_EVENTS})`, note.pos);
                }
                eventSeq++;
                events.push({
                    id: `ev${eventSeq}`,
                    startTick: tick,
                    durationTicks: note.durationTicks,
                    pitch: note.pitch,
                });
                if (note.tieToNext) tieOpen = note;
            }
            tick += note.durationTicks;
        }
    }
    if (tieOpen) {
        return fail('dangling tie: no note follows the tied note', tieOpen.pos);
    }
    if (events.every(e => e.pitch === null)) {
        return fail('the tune contains no notes (only rests)');
    }

    const outMeasures: ScoreMeasure[] = [];
    let measureStart = 0;
    for (let m = 0; m < numMeasures; m++) {
        outMeasures.push({ number: m + 1, startTick: measureStart, durationTicks: sums[m] });
        measureStart += sums[m];
    }

    if (!h.key) {
        // Unreachable when measures exist (the body cannot start without K:),
        // but keeps the type checker honest.
        return fail('missing "K:" header before the tune body');
    }

    const score: Score = {
        version: 1,
        id: h.x !== null && h.x.length > 0 ? h.x : 'abc-untitled',
        title: h.t !== null && h.t.length > 0 ? h.t : 'Untitled',
        meter: { numerator: h.meterNumerator as 3 | 4, denominator: 4 },
        key: { tonic: h.key.tonic, mode: h.key.mode, signature: h.key.signature },
        measures: outMeasures,
        voices: [{ id: 'melody', events }],
        source: {
            rights: `Transcription by project contributor (CC0); source: ${h.s || h.c || 'unspecified'}`,
            writtenToSoundingSemitones: shift,
            ...(h.c ? { composer: h.c } : {}),
            ...(h.z ? { adaptation: h.z } : {}),
        },
    };

    const problems = validateScore(score);
    if (problems.length > 0) {
        return fail(`parsed tune failed score validation: ${problems.join('; ')}`);
    }
    return { ok: true, value: score };
}
