import React, { useEffect, useRef } from 'react';
import { Renderer, Stave, StaveNote, Accidental, Voice, Formatter } from 'vexflow';
import { getNoteInKey } from '../music/NoteUtils';


interface SheetMusicProps {
    targetMidi: number;
    playedMidi?: number | null;
    clef?: 'treble' | 'bass';
    width?: number;
    height?: number;
    transpose?: number; // Transposition in semitones for visualization (e.g., +12 for guitar)
    keySignature?: string;
}

export const SheetMusic: React.FC<SheetMusicProps> = ({
    targetMidi,
    playedMidi,
    clef = 'treble',
    width = 300,
    height = 200,
    transpose = 12, // Default to +1 octave (Guitar Notation)
    keySignature = 'C'
}) => {
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!containerRef.current) return;

        // Clear previous render
        containerRef.current.innerHTML = '';

        const renderer = new Renderer(containerRef.current, Renderer.Backends.SVG);

        renderer.resize(width, height);
        const context = renderer.getContext();

        // Create Stave
        const stave = new Stave(10, 40, width - 20);
        stave.addClef(clef);
        stave.addKeySignature(keySignature);
        stave.setContext(context).draw();

        // Helper to create keys for VexFlow using key signature logic
        const getVexFlowKey = (midi: number) => {
            const visualMidi = midi + transpose;
            return getNoteInKey(visualMidi, keySignature);
        };

        // Create Target Note
        const targetData = getVexFlowKey(targetMidi);

        const targetStaveNote = new StaveNote({
            keys: targetData.keys,
            duration: "w",
            clef: clef
        });

        if (targetData.accidental) {
            targetStaveNote.addModifier(new Accidental(targetData.accidental));
        }

        if (playedMidi) {
            const playedData = getVexFlowKey(playedMidi);

            const playedStaveNote = new StaveNote({
                keys: playedData.keys,
                duration: "h",
                clef: clef
            });

            // Target note as half note to match measure
            const targetNoteHalf = new StaveNote({
                keys: targetData.keys,
                duration: "h",
                clef: clef
            });
            if (targetData.accidental) targetNoteHalf.addModifier(new Accidental(targetData.accidental));


            if (playedMidi === targetMidi) {
                playedStaveNote.setStyle({ fillStyle: "var(--color-success)", strokeStyle: "var(--color-success)" });
            } else {
                playedStaveNote.setStyle({ fillStyle: "var(--color-error)", strokeStyle: "var(--color-error)" });
            }

            if (playedData.accidental) {
                playedStaveNote.addModifier(new Accidental(playedData.accidental));
            }

            // Use camelCase properties as fixed previously
            const voiceCombined = new Voice({ numBeats: 4, beatValue: 4 });
            voiceCombined.addTickables([targetNoteHalf, playedStaveNote]);

            new Formatter().joinVoices([voiceCombined]).format([voiceCombined], width - 50);
            voiceCombined.draw(context, stave);

        } else {
            const voice = new Voice({ numBeats: 4, beatValue: 4 });
            voice.addTickables([targetStaveNote]);
            new Formatter().joinVoices([voice]).format([voice], width - 50);
            voice.draw(context, stave);
        }

    }, [targetMidi, playedMidi, clef, width, height, transpose, keySignature]);

    return <div ref={containerRef} className="sheet-music-container" />;
};
