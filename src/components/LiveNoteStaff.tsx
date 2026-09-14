/**
 * Tiny always-visible staff showing the currently DETECTED note (the same
 * display pipeline as the single-note "played note" measure): written pitch
 * (sounding + display transpose), active key signature, theme-aware.
 * Renders only when the detected midi changes — not per frame.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Renderer, Stave, StaveNote, Accidental, Voice, Formatter } from 'vexflow';
import { getNoteInKey } from '../music/NoteUtils';

interface LiveNoteStaffProps {
    /** Sounding midi of the live detected pitch, or null when silent. */
    midi: number | null;
    clef: 'treble' | 'bass';
    /** Display transpose applied once (guitar +12 …), as in SheetMusic. */
    transpose: number;
    keySignature: string;
    width?: number;
    theme?: 'light' | 'dark' | 'auto';
}

export const LiveNoteStaff: React.FC<LiveNoteStaffProps> = ({
    midi,
    clef = 'treble',
    transpose = 0,
    keySignature = 'C',
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
        // Match the mic button height (64px) so the staff is vertically
        // aligned with it. The stave is centered in the box; extreme ledger
        // lines (very high/low notes) intentionally OVERFLOW the box
        // (CSS overflow: visible) and may overlap neighboring elements —
        // preferred over reserving large empty headroom.
        renderer.resize(width, 64);
        const context = renderer.getContext();

        const resolvedColor =
            getComputedStyle(document.documentElement)
                .getPropertyValue('--color-text-main')
                .trim() || '#333333';
        context.setFillStyle(resolvedColor);
        context.setStrokeStyle(resolvedColor);

        const stave = new Stave(0, 13, width - 2);
        stave.setDefaultLedgerLineStyle({ strokeStyle: resolvedColor, lineWidth: 2 });
        stave.addClef(clef);
        if (keySignature) stave.addKeySignature(keySignature);
        stave.setContext(context).draw();

        if (midi !== null) {
            const written = midi + transpose;
            const spec = getNoteInKey(written, keySignature);
            const note = new StaveNote({
                keys: spec.keys,
                duration: 'w',
                clef,
            });
            note.setStyle({ fillStyle: resolvedColor, strokeStyle: resolvedColor });
            if (spec.accidental) note.addModifier(new Accidental(spec.accidental));
            const voice = new Voice({ numBeats: 4, beatValue: 4 });
            voice.setMode(Voice.Mode.SOFT);
            voice.addTickable(note);
            new Formatter().joinVoices([voice]).format([voice], width - 40);
            voice.draw(context, stave);
        }
    }, [midi, clef, transpose, keySignature, width, theme, schemeVersion]);

    return (
        <div
            ref={containerRef}
            className="live-note-staff"
            style={{ width }}
            // (height comes from the SVG)
            role="img"
            aria-label={midi !== null ? `Currently played: note` : 'No note currently detected'}
        />
    );
};

export default LiveNoteStaff;
