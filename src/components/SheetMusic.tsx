import React, { useEffect, useRef } from 'react';
import { Renderer, Stave, StaveNote, Accidental, Voice, Formatter } from 'vexflow';
import { getNoteDetails } from '../music/NoteUtils';

interface SheetMusicProps {
    targetMidi: number;
    playedMidi?: number | null;
    clef?: 'treble' | 'bass';
    width?: number;
    height?: number;
}

export const SheetMusic: React.FC<SheetMusicProps> = ({
    targetMidi,
    playedMidi,
    clef = 'treble',
    width = 300,
    height = 200
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
        stave.setContext(context).draw();

        // Create Target Note
        const targetDetails = getNoteDetails(targetMidi);
        const targetKey = `${targetDetails.name.toLowerCase()}/${targetDetails.octave}`;

        const targetStaveNote = new StaveNote({
            keys: [targetKey],
            duration: "w",
            clef: clef
        });

        if (targetDetails.name.includes("#")) {
            targetStaveNote.addModifier(new Accidental("#"));
        }

        if (playedMidi) {
            const playedDetails = getNoteDetails(playedMidi);
            const playedKey = `${playedDetails.name.toLowerCase()}/${playedDetails.octave}`;

            const playedStaveNote = new StaveNote({
                keys: [playedKey],
                duration: "h",
                clef: clef,
            });

            // Target note as half note to match measure
            const targetNoteHalf = new StaveNote({
                keys: [targetKey],
                duration: "h",
                clef: clef
            });
            if (targetDetails.name.includes("#")) targetNoteHalf.addModifier(new Accidental("#"));


            if (playedMidi === targetMidi) {
                playedStaveNote.setStyle({ fillStyle: "var(--color-success)", strokeStyle: "var(--color-success)" });
            } else {
                playedStaveNote.setStyle({ fillStyle: "var(--color-error)", strokeStyle: "var(--color-error)" });
            }

            if (playedDetails.name.includes("#")) {
                playedStaveNote.addModifier(new Accidental("#"));
            }

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

    }, [targetMidi, playedMidi, clef, width, height]);

    return <div ref={containerRef} className="sheet-music-container" />;
};
