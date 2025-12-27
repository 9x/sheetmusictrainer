import React, { useEffect, useRef } from 'react';
import { Renderer, Stave, StaveNote, Accidental, Voice, Formatter, StaveConnector, GhostNote, Annotation } from 'vexflow';
import { getNoteInKey } from '../music/NoteUtils';


interface SheetMusicProps {
    targetMidi: number;
    playedMidi?: number | null;
    clef?: 'treble' | 'bass' | 'grand';
    width?: number;
    height?: number;
    transpose?: number; // Transposition in semitones for visualization (e.g., +12 for guitar)
    keySignature?: string;
    hideTargetNote?: boolean;
}

export const SheetMusic: React.FC<SheetMusicProps> = ({
    targetMidi,
    playedMidi,
    clef = 'treble',
    width = 300,
    height = 250, // Increased default height for Grand Staff
    transpose = 12, // Default to +1 octave (Guitar Notation)
    keySignature = 'C',
    hideTargetNote = false
}) => {
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!containerRef.current) return;

        // Clear previous render
        containerRef.current.innerHTML = '';

        const renderer = new Renderer(containerRef.current, Renderer.Backends.SVG);
        renderer.resize(width, height);
        const context = renderer.getContext();

        // IMPORTANT: Set global styles for the context to ensure everything draws with correct color
        context.setFillStyle("var(--color-text-main)");
        context.setStrokeStyle("var(--color-text-main)");

        // --- Helper: Decide which clef a note belongs to in Grand Staff ---
        const getGrandStaffClef = (midi: number): 'treble' | 'bass' => {
            return midi >= 60 ? 'treble' : 'bass';
        };

        // --- Measure Calculation ---
        const numMeasures = playedMidi ? 2 : 1;
        // If 2 measures, split total width. 
        // We want a bit of padding. width is total width.
        // Let's reserve 10px on Left/Right.
        // Measure 1 Start: 10
        // Measure 1 Width: (width - 20) / numMeasures
        // Measure 2 Start: 10 + Width

        const availableWidth = width - 20;
        const measureWidth = availableWidth / numMeasures;
        const startX = 10;

        let stavesMeasure1: Record<string, Stave> = {};
        let stavesMeasure2: Record<string, Stave> = {};

        // --- Create Staves for Measure 1 ---
        if (clef === 'grand') {
            // Measure 1: Treble
            const m1Treble = new Stave(startX, 20, measureWidth);
            m1Treble.addClef('treble').addKeySignature(keySignature);
            m1Treble.setContext(context).draw();

            // Measure 1: Bass
            const m1Bass = new Stave(startX, 110, measureWidth);
            m1Bass.addClef('bass').addKeySignature(keySignature);
            m1Bass.setContext(context).draw();

            stavesMeasure1 = { treble: m1Treble, bass: m1Bass };

            // Connectors (Start of Measure 1 only)
            const brace = new StaveConnector(m1Treble, m1Bass);
            brace.setType(StaveConnector.type.BRACE);
            brace.setContext(context).draw();

            const leftLine = new StaveConnector(m1Treble, m1Bass);
            leftLine.setType(StaveConnector.type.SINGLE_LEFT);
            leftLine.setContext(context).draw();

            // Right line for Measure 1 if it's the only measure, or end of system
            // Actually, we usually want a barline at end of M1 if M2 exists.
            // VexFlow Stave draws end barline by default or setBegBarType/setEndBarType.
            // By default it draws a single bar line at end.

            if (numMeasures === 2) {
                // Measure 2: Treble
                const m2Treble = new Stave(startX + measureWidth, 20, measureWidth);
                // No clef/key sig repeated typically for just next measure in same system, 
                // UNLESS it's a new system. Here it's same system.
                // But VexFlow might require setting context context.
                m2Treble.setContext(context).draw();

                // Measure 2: Bass
                const m2Bass = new Stave(startX + measureWidth, 110, measureWidth);
                m2Bass.setContext(context).draw();

                stavesMeasure2 = { treble: m2Treble, bass: m2Bass };

                // Connect line between M1 and M2?
                // Visual continuity is handled by them abiding. 
                // We might want a SINGLE_RIGHT connector at the very end of M2?
                const rightLineEnd = new StaveConnector(m2Treble, m2Bass);
                rightLineEnd.setType(StaveConnector.type.SINGLE_RIGHT); // Or BOLD_DOUBLE_RIGHT for end
                rightLineEnd.setContext(context).draw();
            } else {
                const rightLineEnd = new StaveConnector(m1Treble, m1Bass);
                rightLineEnd.setType(StaveConnector.type.SINGLE_RIGHT);
                rightLineEnd.setContext(context).draw();
            }

        } else {
            // Single Stave
            const m1Stave = new Stave(startX, 30, measureWidth);
            m1Stave.addClef(clef).addKeySignature(keySignature);
            m1Stave.setContext(context).draw();

            stavesMeasure1 = { [clef]: m1Stave };

            if (numMeasures === 2) {
                const m2Stave = new Stave(startX + measureWidth, 30, measureWidth);
                m2Stave.setContext(context).draw();
                stavesMeasure2 = { [clef]: m2Stave };
            }
        }


        // --- Helper: Create VexFlow Note ---
        const createStaveNote = (midi: number, duration: string, type: 'target' | 'played') => {
            const visualMidi = midi + transpose;
            const data = getNoteInKey(visualMidi, keySignature);

            // Determine Clef for THIS note
            let noteClef = clef;
            if (clef === 'grand') {
                noteClef = getGrandStaffClef(visualMidi);
            }

            const staveNote = new StaveNote({
                keys: data.keys,
                duration: duration,
                clef: noteClef as 'treble' | 'bass'
            });

            // Set styles
            staveNote.setStyle({ fillStyle: "var(--color-text-main)", strokeStyle: "var(--color-text-main)" });

            if (data.accidental) {
                const accidental = new Accidental(data.accidental);
                staveNote.addModifier(accidental);
            }

            if (type === 'played') {
                // Always use default style (text color), no green/red distinction
                staveNote.setStyle({ fillStyle: "var(--color-text-main)", strokeStyle: "var(--color-text-main)" });
            }

            return { note: staveNote, clef: noteClef };
        };

        const voicesToDraw: { stave: Stave, voice: Voice }[] = [];

        // --- Render Target Note (Measure 1) ---
        // Always Whole Note
        let targetNoteObj: { note: StaveNote | GhostNote, clef: string };

        if (hideTargetNote) {
            const visualMidi = targetMidi + transpose;
            let noteClef = clef;
            if (clef === 'grand') noteClef = getGrandStaffClef(visualMidi);
            const data = getNoteInKey(visualMidi, keySignature);

            const ghost = new GhostNote({
                keys: data.keys,
                duration: "w"
            });
            ghost.addModifier(new Annotation("?").setVerticalJustification(Annotation.VerticalJustify.CENTER));
            targetNoteObj = { note: ghost, clef: noteClef };
        } else {
            targetNoteObj = createStaveNote(targetMidi, "w", 'target');
        }

        // Add Target to Measure 1 Stave
        const m1StaveForKey = stavesMeasure1[targetNoteObj.clef];
        if (m1StaveForKey) {
            const voice = new Voice({ numBeats: 4, beatValue: 4 });
            voice.addTickables([targetNoteObj.note]);
            new Formatter().joinVoices([voice]).format([voice], measureWidth - 50); // Less width for padding
            voicesToDraw.push({ stave: m1StaveForKey, voice });
        }

        // --- Render Played Note (Measure 2) ---
        if (playedMidi && numMeasures === 2) {
            const playedNoteObj = createStaveNote(playedMidi, "w", 'played');

            // Add Played to Measure 2 Stave
            const m2StaveForKey = stavesMeasure2[playedNoteObj.clef];
            if (m2StaveForKey) {
                const voice = new Voice({ numBeats: 4, beatValue: 4 });
                voice.addTickables([playedNoteObj.note]);
                new Formatter().joinVoices([voice]).format([voice], measureWidth - 50);
                voicesToDraw.push({ stave: m2StaveForKey, voice });
            }
        }


        // Draw all voices
        voicesToDraw.forEach(({ stave, voice }) => {
            voice.draw(context, stave);
        });


    }, [targetMidi, playedMidi, clef, width, height, transpose, keySignature, hideTargetNote]);

    return <div ref={containerRef} className="sheet-music-container" />;
};

