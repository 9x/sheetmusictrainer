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
    theme?: 'light' | 'dark' | 'auto';
}

const BOX_H = 64;   // mic button height — vertical centering via the bar
// VexFlow draws the first stave line ~40.5px BELOW the constructor y
// (default space_above_staff_ln = 4 line-spaces). To center a 38px staff in
// the 64px box the constructor y must be negative.
const STAVE_Y = -28;

export const LiveNoteStaff: React.FC<LiveNoteStaffProps> = ({
    midi,
    transpose = 0,
    keySignature = 'C',
    clef: clefOverride,
    width = 130,
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

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;
        container.innerHTML = '';

        const renderer = new Renderer(container, Renderer.Backends.SVG);
        renderer.resize(width, BOX_H);
        const context = renderer.getContext();

        const resolvedColor =
            getComputedStyle(document.documentElement)
                .getPropertyValue('--color-text-main')
                .trim() || '#333333';
        context.setFillStyle(resolvedColor);
        context.setStrokeStyle(resolvedColor);

        const stave = new Stave(0, STAVE_Y, width - 2);
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
            let octaveMark: '8va' | '8vb' | null = null;
            if (clef === 'treble') {
                while (written < 58) { written += 12; octaveMark = '8vb'; }
                while (written > 81) { written -= 12; octaveMark = '8va'; }
            } else {
                while (written < 40) { written += 12; octaveMark = '8vb'; }
                while (written > 61) { written -= 12; octaveMark = '8va'; }
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
    }, [midi, transpose, keySignature, clefOverride, width, theme, schemeVersion]);

    return (
        <div
            ref={containerRef}
            className="live-note-staff"
            style={{ width, height: BOX_H }}
            role="img"
            aria-label={midi !== null ? 'Currently played note' : 'No note currently detected'}
        />
    );
};

export default LiveNoteStaff;
