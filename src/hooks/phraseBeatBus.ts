/**
 * Beat clock shared between the phrase trainer's scheduler and the global
 * metronome widget. The phrase run emits every beat (count-in + score beats)
 * here; the metronome widget mirrors them on its pendulum so the visual
 * stays in sync with the audible phrase click. Beats carry an absolute
 * AudioContext timestamp so the widget can schedule the visual swing at the
 * right moment even when callbacks fire ahead of time.
 */
type BeatListener = (beat: number, at: number) => void;

const listeners = new Set<BeatListener>();

export const phraseBeatBus = {
    emit(beat: number, at: number): void {
        listeners.forEach(l => l(beat, at));
    },
    subscribe(l: BeatListener): () => void {
        listeners.add(l);
        return () => { listeners.delete(l); };
    },
};
