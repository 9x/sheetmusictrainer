import React, { useEffect, useRef } from 'react';
import { Renderer, Stave, StaveNote, Accidental, Voice, Formatter, StaveConnector } from 'vexflow';
import { getNoteInKey } from '../music/NoteUtils';


interface SheetMusicProps {
    targetMidi: number;
    playedMidi?: number | null;
    clef?: 'treble' | 'bass' | 'grand';
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
    height = 250, // Increased default height for Grand Staff
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

        // --- Helper: Decide which clef a note belongs to in Grand Staff ---
        // For Grand Staff: usually Split at Middle C (C4 / Midi 60). 
        // >= 60 -> Treble, < 60 -> Bass.
        const getGrandStaffClef = (midi: number): 'treble' | 'bass' => {
            return midi >= 60 ? 'treble' : 'bass';
        };

        let staves: Record<string, Stave> = {};

        if (clef === 'grand') {
            // Create Treble Stave
            const topStave = new Stave(20, 40, width - 30);
            topStave.addClef('treble').addKeySignature(keySignature);
            topStave.setContext(context).draw();

            // Create Bass Stave
            const bottomStave = new Stave(20, 150, width - 30);
            bottomStave.addClef('bass').addKeySignature(keySignature);
            bottomStave.setContext(context).draw();

            // Connect them
            const brace = new StaveConnector(topStave, bottomStave);
            brace.setType(StaveConnector.type.BRACE);
            brace.setContext(context).draw();

            const leftLine = new StaveConnector(topStave, bottomStave);
            leftLine.setType(StaveConnector.type.SINGLE_LEFT);
            leftLine.setContext(context).draw();

            const rightLine = new StaveConnector(topStave, bottomStave);
            rightLine.setType(StaveConnector.type.SINGLE_RIGHT);
            rightLine.setContext(context).draw();

            staves = { treble: topStave, bass: bottomStave };

        } else {
            // Single Stave
            const stave = new Stave(10, 80, width - 20); // Centered vertically
            stave.addClef(clef).addKeySignature(keySignature);
            stave.setContext(context).draw();
            // Map the single clef to the key matching the 'clef' prop so logic below works
            staves = { [clef]: stave };
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

            if (data.accidental) {
                staveNote.addModifier(new Accidental(data.accidental));
            }

            if (type === 'played') {
                if (midi === targetMidi) {
                    staveNote.setStyle({ fillStyle: "var(--color-success)", strokeStyle: "var(--color-success)" });
                } else {
                    staveNote.setStyle({ fillStyle: "var(--color-error)", strokeStyle: "var(--color-error)" });
                }
            }

            return { note: staveNote, clef: noteClef };
        };

        // --- Create Notes ---
        const targetObj = createStaveNote(targetMidi, "w", 'target');

        const voicesToDraw: { stave: Stave, voice: Voice }[] = [];

        // Helper to push voice
        const addVoice = (stave: Stave, notes: StaveNote[]) => {
            const voice = new Voice({ numBeats: 4, beatValue: 4 });
            voice.addTickables(notes);
            new Formatter().joinVoices([voice]).format([voice], width - 60);
            voicesToDraw.push({ stave, voice });
        };


        if (playedMidi) {
            const playedObj = createStaveNote(playedMidi, "h", 'played');
            const targetHalfObj = createStaveNote(targetMidi, "h", 'target');

            // If Grand Staff: Notes might be on DIFFERENT staves.
            // We need to group notes by Stave.

            const groupedNotes: Record<string, StaveNote[]> = {};

            // Initialize relevant keys
            if (clef === 'grand') {
                groupedNotes['treble'] = [];
                groupedNotes['bass'] = [];
            } else {
                groupedNotes[clef] = [];
            }

            // Logic:
            // If Single Stave: Both notes go on that stave.
            // If Grand Staff: Target goes on its clef. Played goes on its clef.
            // BUT: If they are on the SAME clef, we render them in one voice (or same stave).
            // VexFlow requires Formatter to format voices.

            // Target Half
            // If clef is grand, use targetHalfObj.clef. If single, use prop clef.
            const targetClefKey = clef === 'grand' ? targetHalfObj.clef : clef;
            // Played
            const playedClefKey = clef === 'grand' ? playedObj.clef : clef;

            // Wait, if we want them to align in time (same measure), we need to put them in the same voice OR separate voices in same Context?
            // VexFlow: To draw notes side-by-side (sequentially), they are in the same Voice.
            // The prompt implies "Target note as half / Played as half".

            // COMPLEXITY: In Grand Staff, if Target is Treble and Played is Bass, they are on different staves.
            // They are distinct events visually.
            // If both are Treble, they are side-by-side.

            // Let's create a map of Voice-per-Stave.

            // We need to fill "rests" or manage timing if they are split across staves? 
            // Simplified: Just draw them. If they are on different staves, they won't align horizontally perfectly unless we coordinate formatters.
            // For this app, simply drawing them on their respective staves is fine.

            // However, to ensure they look like a "measure", we should probably put Rests? 
            // Let's keep it simple: Just draw the notes.

            // Problem: If I play C3 (Bass) and Target is C5 (Treble).
            // Treble Stave: [C5 (h), Rest (h)] ? Or just C5 at pos 0?
            // If we just addtickables, they render at start.

            // To align them:
            // Ideally:
            // Target (h) -> Beat 1
            // Played (h) -> Beat 3
            // So: 
            // Voice 1 (Target's Stave): Note(h) + Rest(h) (if played is elsewhere?) 
            // Actually, existing code did: [Target(h), Played(h)]. Sequence.

            // Scenario 1: Both on same stave.
            if (targetClefKey === playedClefKey) {
                // Same stave. Add both to voice.
                const stv = staves[targetClefKey as string];
                addVoice(stv, [targetHalfObj.note, playedObj.note]);
            } else {
                // Different staves (Grand Staff split).
                // Target on Stave A. Played on Stave B.
                // Stave A: Target(h) + Rest(h) (invisible?)
                // Stave B: Rest(h) + Played(h)

                // Constructing invisible rests is tedious in Vexflow without dedicated Rest classes.
                // Let's try separate Voices?
                // Visual separation might be okay.

                const staveT = staves[targetClefKey as string];
                const staveP = staves[playedClefKey as string];

                // Just draw them.
                // Note: They will both appear at the start (Beat 1) if we don't padding.
                // We want Played to be "next" to Target.

                // Let's stick to the "Sequence": Target then Played.
                // If separate staves, we lose the "sequence" visual left-to-right if we just draw them at beat 1.

                // SOLUTION: Use a "Ghost Note" (Invisible) of Half duration on the other stave?
                // Or proper VexFlow StaveGhostNote?

                // Simpler hack: 
                // Render Target at Beat 1.
                // Render Played at Beat 3.

                // For Stave A (Target): Note(h), Rest(h)
                // For Stave B (Played): Rest(h), Note(h)

                // Vexflow `StaveNote({ keys: ["b/4"], duration: "hqr" })` for rest?

                const createRest = (clefStr: string) => new StaveNote({ keys: ["b/4"], duration: "hr", clef: clefStr });

                // Stave T (Target's stave)
                const voiceT = new Voice({ numBeats: 4, beatValue: 4 });
                voiceT.addTickables([targetHalfObj.note, createRest(targetClefKey as string)]);

                // Stave P (Played's stave)
                const voiceP = new Voice({ numBeats: 4, beatValue: 4 });
                voiceP.addTickables([createRest(playedClefKey as string), playedObj.note]);

                // We need to format them together to align beats?
                // Yes, formatters can take multiple voices to align specific ticks.

                new Formatter().joinVoices([voiceT]).format([voiceT], width - 60);
                new Formatter().joinVoices([voiceP]).format([voiceP], width - 60);

                // But wait, if we format separately, they might not align vertically across staves?
                // Actually they will if width is same.
                // But generally `joinVoices([v1, v2])` is better.

                // But vT and vP are on different staves!
                // VexFlow Formatter doesn't care about staves, just X alignment.
                // So we can format them together!

                new Formatter().joinVoices([voiceT, voiceP]).format([voiceT, voiceP], width - 60);

                voicesToDraw.push({ stave: staveT, voice: voiceT });
                voicesToDraw.push({ stave: staveP, voice: voiceP });
            }

        } else {
            // Target Only (Whole note)
            const stave = staves[targetObj.clef as string];
            addVoice(stave, [targetObj.note]);
        }

        // Draw all voices
        voicesToDraw.forEach(({ stave, voice }) => {
            voice.draw(context, stave);
        });


    }, [targetMidi, playedMidi, clef, width, height, transpose, keySignature]);

    return <div ref={containerRef} className="sheet-music-container" />;
};
