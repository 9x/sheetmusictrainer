/**
 * Tiny always-visible staff showing the currently DETECTED note (the same
 * display pipeline as the single-note "played note" measure): written pitch
 * (sounding + display transpose), active key signature, theme-aware.
 *
 * The box matches the mic button (64px) and is vertically centered with it.
 * Notes outside the staff's comfortable range are drawn one octave in with a
 * standard 8va/8vb marker instead of clipping or reserving whitespace —
 * the same convention real notation uses for out-of-range passages. Extreme
 * cases still overflow the box slightly (CSS overflow: visible).
 */
import React, { useEffect, useRef, useState } from 'react';
import { Renderer, Stave, StaveNote, Accidental, Voice, Formatter, Annotation } from 'vexflow';
import { getNoteInKey } from '../music/NoteUtils';

interface LiveNoteStaffProps {
    midi: number | null;
    transpose: number;
    keySignature: string;
    /** Force a clef (e.g. the instrument's usual clef). When omitted the
     *  clef auto-switches treble/bass around middle C (piano-style). */
    clef?: 'treble' | 'bass';
    width?: number;
    /** Box height. 64px matches the mic bar; larger boxes (e.g. 88px in
     *  Assist mode) give ledger lines room inside instead of being clipped
     *  by the parent's overflow: hidden. Ignored when `range` is set. */
    height?: number;
    /** Written-pitch range the box must fit WITHOUT octave shifting.
     *  When set, notes render at their true staff position with real ledger
     *  lines (no 8va/8vb marker) and the box height is computed from the
     *  range so every note in it stays inside the box. */
    range?: { min: number; max: number };
    theme?: 'light' | 'dark' | 'auto';
}

const BOX_H = 64;   // mic button height — vertical centering via the bar
// VexFlow draws the first stave line ~40.5px BELOW the constructor y
// (default space_above_staff_ln = 4 line-spaces). To center the ~38px staff
// in a box of height h the constructor y must be negative. For h = 64 this
// yields -27.5 ≈ -28 (the original hardcoded value).
const staveYFor = (h: number) => (h - 38) / 2 - 40.5;

// Diatonic index (C0 = 0, one step per letter name) for ledger-line math.
const DI_STEP = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const diFromMidi = (m: number) => Math.floor(m / 12 - 1) * 7 + DI_STEP[m % 12];
// Top/bottom staff-line diatonic index per clef (treble F5/E4, bass A3/G2).
const CLEF_LINES: Record<'treble' | 'bass', { top: number; bottom: number }> = {
    treble: { top: 38, bottom: 30 },
    bass: { top: 26, bottom: 18 },
};
// One diatonic step = half a staff space = 5px (standard 10px spaces).
// Box that fits a whole written range: staff anchored below the top
// headroom so the highest note has room for its ledger lines, lowest note
// the same at the bottom.
const rangeLayout = (range: { min: number; max: number }, clef: 'treble' | 'bass') => {
    const lines = CLEF_LINES[clef];
    const aboveLines = Math.max(0, Math.ceil((diFromMidi(range.max) - lines.top) / 2));
    const belowLines = Math.max(0, Math.ceil((lines.bottom - diFromMidi(range.min)) / 2));
    const abovePx = aboveLines * 10 + 10;   // + notehead margin
    const belowPx = belowLines * 10 + 10;
    return { height: abovePx + 38 + belowPx, y: abovePx - 40.5 };
};

export const LiveNoteStaff: React.FC<LiveNoteStaffProps> = ({
    midi,
    transpose = 0,
    keySignature = 'C',
    clef: clefOverride,
    width = 130,
    height = BOX_H,
    range,
    theme = 'auto',
}) => {
    const containerRef = useRef<HTMLDivElement>(null);

    // Box geometry: range-fit wins over the fixed height prop.
    const fit = range
        ? rangeLayout(range, clefOverride ?? 'treble')
        : { height, y: staveYFor(height) };
    const boxH = fit.height;
    const staveY = fit.y;
    const [schemeVersion, setSchemeVersion] = useState(0);
    useEffect(() => {
        const mq = window.matchMedia('(prefers-color-scheme: dark)');
        const onChange = () => setSchemeVersion(v => v + 1);
        mq.addEventListener('change', onChange);
        return () => mq.removeEventListener('change', onChange);
    }, []);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;
        container.innerHTML = '';

        const renderer = new Renderer(container, Renderer.Backends.SVG);
        renderer.resize(width, boxH);
        const context = renderer.getContext();

        const resolvedColor =
            getComputedStyle(document.documentElement)
                .getPropertyValue('--color-text-main')
                .trim() || '#333333';
        context.setFillStyle(resolvedColor);
        context.setStrokeStyle(resolvedColor);

        const stave = new Stave(0, staveY, width - 2);
        stave.setDefaultLedgerLineStyle({ strokeStyle: resolvedColor, lineWidth: 2 });
        const written0 = midi !== null ? midi + transpose : null;
        // Instrument-fixed clef when provided (guitar always treble, bass
        // always bass); otherwise piano-style split at middle C.
        const clef: 'treble' | 'bass' = clefOverride ?? (written0 !== null && written0 < 60 ? 'bass' : 'treble');
        stave.addClef(clef);
        if (keySignature) stave.addKeySignature(keySignature);
        stave.setContext(context).draw();

        if (midi !== null) {
            // Normalize into the staff with a standard 8va/8vb marker so the
            // note is always visible in the compact box:
            //   treble: staff E4..F5 (+ up to two ledger lines each way)
            //   bass:   staff G2..A3 (+ up to two ledger lines each way)
            let written = written0!;
            // Range-fit mode renders the TRUE written position with real
            // ledger lines — no 8va/8vb shifting.
            let octaveMark: '8va' | '8vb' | null = null;
            if (!range) {
                if (clef === 'treble') {
                    while (written < 58) { written += 12; octaveMark = '8vb'; }
                    while (written > 81) { written -= 12; octaveMark = '8va'; }
                } else {
                    while (written < 40) { written += 12; octaveMark = '8vb'; }
                    while (written > 61) { written -= 12; octaveMark = '8va'; }
                }
            }

            const spec = getNoteInKey(written, keySignature);
            const note = new StaveNote({
                keys: spec.keys,
                duration: 'w',
                clef,
            });
            note.setStyle({ fillStyle: resolvedColor, strokeStyle: resolvedColor });
            if (spec.accidental) note.addModifier(new Accidental(spec.accidental));
            if (octaveMark) {
                try {
                    note.addModifier(
                        new Annotation(octaveMark)
                            .setVerticalJustification(Annotation.VerticalJustify.CENTER)
                            .setStyle({ fillStyle: resolvedColor, strokeStyle: resolvedColor }),
                    );
                } catch {
                    // Marker is a courtesy cue.
                }
            }
            const voice = new Voice({ numBeats: 4, beatValue: 4 });
            voice.setMode(Voice.Mode.SOFT);
            voice.addTickable(note);
            new Formatter().joinVoices([voice]).format([voice], width - 40);
            voice.draw(context, stave);
        }
    }, [midi, transpose, keySignature, clefOverride, width, boxH, staveY, range, theme, schemeVersion]);

    return (
        <div
            ref={containerRef}
            className="live-note-staff"
            style={{ width, height: boxH }}
            role="img"
            aria-label={midi !== null ? 'Currently played note' : 'No note currently detected'}
        />
    );
};

export default LiveNoteStaff;
