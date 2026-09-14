/**
 * Multi-bar phrase renderer (contract F).
 *
 * Renders a Score (ties pre-merged) as one or more systems of 1–4 bars.
 * - Preserves source spelling; accidental display is measure-aware per
 *   (step, octave), seeded from the key signature and reset at barlines.
 * - Splits tie-merged events into tied glyphs at barlines (rendering only —
 *   statuses stay per logical event).
 * - Colors: current note = --color-primary (same accent as the existing
 *   fretboard hints) + a caret annotation (non-color cue), matched =
 *   --color-success, missed = --color-error, skipped = muted, rest = text.
 * - Re-renders on note transitions and structural changes only, never at
 *   microphone frame rate.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Renderer, Stave, StaveNote, GhostNote, Accidental, Voice, Formatter, StaveConnector, Beam, StaveTie, Annotation, Dot } from 'vexflow';
import { scoreEvents, type Score } from '../score/model';
import { STEP_LETTERS, type StepLetter } from '../score/model';
import type { NoteStatus } from '../game/PhraseMatcher';
import { keyFor, isMode, spelledPitch } from '../music/scales';

interface PhraseSheetMusicProps {
    score: Score;
    /** Logical event index currently up (-1 = none). */
    currentIdx: number;
    statuses: NoteStatus[];
    clef: 'treble' | 'bass' | 'grand';
    /** Display transpose applied ONCE, at render time (guitar +12 etc.). */
    transpose: number;
    width: number;
    theme?: 'light' | 'dark' | 'auto';
}

interface Fragment {
    note: StaveNote;
    eventIdx: number;
    /** Absolute tick of this fragment's start. */
    start: number;
    /** Fragment duration in ticks. */
    ticks: number;
    isAttack: boolean;
    isEighth: boolean;
    isSixteenth: boolean;
    staveKey: 'treble' | 'bass';
    rest: boolean;
}

// Duration ticks → VexFlow duration code (subset the model guarantees).
function durationCode(ticks: number): string | null {
    switch (ticks) {
        case 120: return '16';
        case 240: return '8';
        case 360: return '8d';
        case 480: return '4';
        case 720: return '4d';
        case 960: return '2';
        case 1440: return '2d';
        case 1920: return 'w';
        default: return null;
    }
}

function accidentalGlyph(alter: number): string | undefined {
    switch (alter) {
        case 1: return '#';
        case -1: return 'b';
        case 2: return '##';
        case -2: return 'bb';
        default: return undefined;
    }
}

function keyString(step: StepLetter, alter: number, octave: number): string {
    const alterStr = alter === 1 ? '#' : alter === -1 ? 'b' : alter === 2 ? '##' : alter === -2 ? 'bb' : '';
    return `${step.toLowerCase()}${alterStr}/${octave}`;
}

function signatureAlterMap(score: Score): Record<string, number> {
    const map: Record<string, number> = {};
    for (const s of STEP_LETTERS) map[s] = 0;
    const mode = isMode(score.key.mode) ? score.key.mode : 'major';
    const key = keyFor(score.key.tonic, mode);
    for (const [step, alter] of Object.entries(key.signatureAlter)) map[step] = alter;
    return map;
}

export const PhraseSheetMusic: React.FC<PhraseSheetMusicProps> = ({
    score,
    currentIdx,
    statuses,
    clef,
    transpose,
    width,
    theme = 'auto',
}) => {
    const containerRef = useRef<HTMLDivElement>(null);

    const [schemeVersion, setSchemeVersion] = useState(0);
    useEffect(() => {
        const mq = window.matchMedia('(prefers-color-scheme: dark)');
        const onChange = () => setSchemeVersion(v => v + 1);
        mq.addEventListener('change', onChange);
        return () => mq.removeEventListener('change', onChange);
    }, []);

    const events = scoreEvents(score);
    const totalBars = score.measures.length;
    const barsPerRow = Math.max(1, Math.min(4, Math.floor((width - 40) / 210)));
    const rowCount = Math.max(1, Math.ceil(totalBars / barsPerRow));
    const isGrand = clef === 'grand';
    const rowHeight = isGrand ? 250 : 140;
    const height = rowCount * rowHeight + 30;

    useEffect(() => {
        const container = containerRef.current;
        if (!container || events.length === 0) return;

        container.innerHTML = '';
        const renderer = new Renderer(container, Renderer.Backends.SVG);
        renderer.resize(width, height);
        const context = renderer.getContext();

        const css = getComputedStyle(document.documentElement);
        const resolve = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
        const textColor = resolve('--color-text-main', '#333333');
        // --color-primary is near-black in light mode — invisible as a highlight.
        // Use the warm accent that reads clearly in both themes.
        const currentColor = resolve('--color-warning', '#f59e0b');
        const successColor = resolve('--color-success', '#22c55e');
        const errorColor = resolve('--color-error', '#ef4444');
        const mutedColor = resolve('--color-text-muted', '#888888');

        context.setFillStyle(textColor);
        context.setStrokeStyle(textColor);
        const ledgerStyle = { strokeStyle: textColor, lineWidth: 2 };
        const sigAlter = signatureAlterMap(score);
        const mode = isMode(score.key.mode) ? score.key.mode : 'major';
        let vexKeySpec = 'C';
        try { vexKeySpec = keyFor(score.key.tonic, mode).signature; } catch { /* default */ }

        const pad = 10;
        const usable = width - 2 * pad;
        const barWidth = usable / Math.min(barsPerRow, Math.max(1, totalBars));

        // Per-row drawing data, built first so ties can connect across bars.
        const rowFragmentList: Fragment[][] = [];

        for (let m = 0; m < totalBars; m++) {
            const rowIdx = Math.floor(m / barsPerRow);
            while (rowFragmentList.length <= rowIdx) rowFragmentList.push([]);
            const measure = score.measures[m];
            const measureStart = measure.startTick;
            const measureEnd = measureStart + measure.durationTicks;
            const measureState: Record<string, number> = {};

            for (let e = 0; e < events.length; e++) {
                const ev = events[e];
                const evStart = ev.startTick;
                const evEnd = evStart + ev.durationTicks;
                if (evEnd <= measureStart || evStart >= measureEnd) continue;

                let cursor = Math.max(evStart, measureStart);
                while (cursor < Math.min(evEnd, measureEnd)) {
                    const fragEnd = Math.min(evEnd, measureEnd);
                    const ticks = fragEnd - cursor;
                    const code = durationCode(ticks);
                    if (!code) { cursor = fragEnd; continue; }
                    // 'd' suffix encodes a dotted duration; the visible dot is
                    // a modifier that must be added explicitly (VexFlow only
                    // reads the base duration for spacing otherwise).
                    const isDotted = code.endsWith('d');
                    const baseCode = isDotted ? code.slice(0, -1) : code;

                    const rest = ev.pitch === null;
                    const staveKey: 'treble' | 'bass' = rest
                        ? (isGrand ? 'treble' : (clef as 'treble' | 'bass'))
                        : (isGrand ? (ev.pitch!.midi + transpose >= 60 ? 'treble' : 'bass') : (clef as 'treble' | 'bass'));
                    const isAttack = cursor === evStart;

                    let note: StaveNote;
                    if (rest) {
                        note = new StaveNote({ keys: ['b/4'], duration: `${baseCode}r`, clef: staveKey });
                    } else {
                        const p = ev.pitch!;
                        // WRITTEN pitch for the staff: sounding midi + display
                        // transpose, octave recomputed via the shared helper —
                        // the same sounding+transpose semantics as single-note
                        // SheetMusic (guitar reads an octave above sounding).
                        let written: { step: StepLetter; alter: number; octave: number };
                        try {
                            written = spelledPitch(p.midi + transpose, p.step, p.alter);
                        } catch {
                            // Non-octave transposes would need respelling; all
                            // configured transposes are octave multiples.
                            written = { step: p.step, alter: p.alter, octave: p.octave + Math.round(transpose / 12) };
                        }
                        const stateKey = `${written.step}${written.octave}`;
                        const expected = measureState[stateKey] ?? sigAlter[written.step];
                        const glyph = written.alter !== expected ? accidentalGlyph(written.alter) : undefined;
                        measureState[stateKey] = written.alter;
                        note = new StaveNote({
                            keys: [keyString(written.step, written.alter, written.octave)],
                            duration: baseCode,
                            clef: staveKey,
                        });
                        if (isDotted) Dot.buildAndAttach([note]);
                        if (glyph) note.addModifier(new Accidental(glyph));
                    }

                    const status = statuses[e] ?? 'pending';
                    const isCurrent = e === currentIdx;
                    let color = textColor;
                    if (isCurrent) color = currentColor;
                    else if (status === 'matched') color = successColor;
                    else if (status === 'missed') color = errorColor;
                    else if (status === 'skipped') color = mutedColor;

                    note.setStyle({ fillStyle: color, strokeStyle: color });
                    if (isCurrent && !rest) {
                        try {
                            note.addModifier(
                                new Annotation('▲')
                                    .setVerticalJustification(Annotation.VerticalJustify.TOP)
                                    .setStyle({ fillStyle: color, strokeStyle: color }),
                            );
                        } catch {
                            // Caret is a courtesy cue; color still marks the note.
                        }
                    }

                    rowFragmentList[rowIdx].push({
                        note,
                        eventIdx: e,
                        start: cursor,
                        ticks,
                        isAttack,
                        isEighth: code === '8' && !rest,
                        isSixteenth: code === '16' && !rest,
                        staveKey,
                        rest,
                    });
                    cursor = fragEnd;
                }
            }
        }

        // ---- Staves, voices, formatting, drawing -----------------------------
        for (let r = 0; r < rowFragmentList.length; r++) {
            // VexFlow draws stave lines ~40.5px below the constructor y —
            // center the staff in the row and leave ledger headroom below.
            const y = r * rowHeight + 9;
            const rowMeasureNumbers: number[] = [];
            for (let b = 0; b < barsPerRow; b++) {
                const m = r * barsPerRow + b;
                if (m < totalBars) rowMeasureNumbers.push(m);
            }

            for (const m of rowMeasureNumbers) {
                const b = m % barsPerRow;
                const measure = score.measures[m];
                const measureStart = measure.startTick;
                const measureEnd = measureStart + measure.durationTicks;
                const x = pad + b * barWidth;
                const isFirstOfRow = b === 0;
                const frags = rowFragmentList[r].filter(f => f.start >= measureStart && f.start < measureEnd);

                // --- Staves ---
                const treble = new Stave(x, y, barWidth);
                treble.setDefaultLedgerLineStyle(ledgerStyle);
                if (isFirstOfRow) {
                    treble.addClef('treble').addKeySignature(vexKeySpec);
                    if (r === 0) treble.addTimeSignature(`${score.meter.numerator}/${score.meter.denominator}`);
                    treble.setMeasure(measure.number);
                }
                // Chord symbol above the staff (bar-indexed), drawn via the
                // stave's annotation area so it shifts with the clef offset.
                const chordSym = score.chordSymbols?.[m];
                if (chordSym) {
                    try {
                        treble.setSection(chordSym, 0);
                    } catch { /* courtesy label — never fatal */ }
                }
                let bass: Stave | null = null;
                if (isGrand) {
                    bass = new Stave(x, y + 130, barWidth);
                    bass.setDefaultLedgerLineStyle(ledgerStyle);
                    if (isFirstOfRow) {
                        bass.addClef('bass').addKeySignature(vexKeySpec);
                        if (r === 0) bass.addTimeSignature(`${score.meter.numerator}/${score.meter.denominator}`);
                    }
                }

                // --- Voices (grand: split per stave with ghost placeholders) ---
                const buildVoice = (stave: Stave, sel: (f: Fragment) => boolean): { voice: Voice; stave: Stave } => {
                    const voice = new Voice({ numBeats: score.meter.numerator, beatValue: 4 });
                    voice.setMode(Voice.Mode.SOFT); // pickups/closers are validated in the model
                    const all = frags.filter(sel).sort((a, b2) => a.start - b2.start);
                    let cursor = measureStart;
                    for (const f of all) {
                        if (f.start > cursor) {
                            const gapCode = durationCode(f.start - cursor);
                            if (gapCode) voice.addTickable(new GhostNote({ duration: gapCode }));
                        }
                        voice.addTickable(f.note);
                        cursor = f.start + f.ticks;
                    }
                    if (measureEnd > cursor) {
                        const tailCode = durationCode(measureEnd - cursor);
                        if (tailCode) voice.addTickable(new GhostNote({ duration: tailCode }));
                    }
                    return { voice, stave };
                };

                const voices: { voice: Voice; stave: Stave }[] = [];
                if (isGrand) {
                    voices.push(buildVoice(treble, f => f.staveKey === 'treble'));
                    voices.push(buildVoice(bass!, f => f.staveKey === 'bass'));
                } else {
                    voices.push(buildVoice(treble, () => true));
                }

                const formatWidth = Math.max(60, barWidth - (isFirstOfRow ? 92 : 16));
                const formatter = new Formatter();
                formatter.joinVoices(voices.map(v => v.voice));
                formatter.format(voices.map(v => v.voice), formatWidth);

                treble.setContext(context).draw();
                if (bass) bass.setContext(context).draw();
                for (const { voice, stave } of voices) voice.draw(context, stave);

                if (isGrand && isFirstOfRow) {
                    const brace = new StaveConnector(treble, bass!);
                    brace.setType(StaveConnector.type.BRACE);
                    brace.setContext(context).draw();
                    const line = new StaveConnector(treble, bass!);
                    line.setType(StaveConnector.type.SINGLE_LEFT);
                    line.setContext(context).draw();
                }

                // --- Beams: consecutive eighth/16th pairs within one beat ---
                // Note: the Beam must be registered on each note via setBeam,
                // otherwise VexFlow still draws flags (beam === undefined in
                // shouldDrawFlag) and you get BOTH flag and beam.
                const beamed = frags.filter(f => (f.isEighth || f.isSixteenth) && f.note instanceof StaveNote);
                for (let i = 0; i + 1 < beamed.length; i++) {
                    const a = beamed[i], b2 = beamed[i + 1];
                    if (a.staveKey !== b2.staveKey) continue;
                    // consecutive within the same beat, same subdivision size
                    const step = a.isSixteenth ? 120 : 240;
                    if (b2.start - a.start !== step) continue;
                    if ((a.ticks !== step) || (b2.ticks !== step)) continue;
                    const beatA = Math.floor((a.start - measureStart) / 480);
                    const beatB = Math.floor((b2.start - measureStart) / 480);
                    if (beatA === beatB) {
                        const beam = new Beam([a.note, b2.note], false);
                        a.note.setBeam(beam);
                        b2.note.setBeam(beam);
                        beam.setContext(context).draw();
                    }
                }
            }

            // --- Ties between consecutive fragments of one event (this row) ---
            const rowFrags = [...rowFragmentList[r]].sort((a, b) => a.start - b.start);
            for (let i = 0; i + 1 < rowFrags.length; i++) {
                const a = rowFrags[i], b = rowFrags[i + 1];
                if (a.eventIdx === b.eventIdx && a.staveKey === b.staveKey && !a.rest && !b.rest) {
                    const tie = new StaveTie({ firstNote: a.note, lastNote: b.note });
                    tie.setContext(context).draw();
                }
            }
        }
    }, [score, currentIdx, statuses, clef, transpose, width, theme, schemeVersion, events, barsPerRow, rowCount, rowHeight, height, isGrand, totalBars]);

    return (
        <div
            ref={containerRef}
            className="sheet-music-container phrase-sheet"
            style={{ width: '100%', minHeight: 60 }}
            role="img"
            aria-label={`Notation: ${score.title}, ${score.measures.length} bars, key of ${score.key.tonic}`}
        />
    );
};

export default PhraseSheetMusic;
