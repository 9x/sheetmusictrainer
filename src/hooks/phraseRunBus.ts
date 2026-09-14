/**
 * Tiny pub/sub for the phrase trainer's running state.
 *
 * Lets the (global) metronome widget gate its pendulum/click on the phrase
 * run: in Phrase Mode the metronome should only be active while the trainer
 * is counting in or playing, not while idle.
 */
type Listener = (running: boolean) => void;

const listeners = new Set<Listener>();
let running = false;

export const phraseRunBus = {
    set(v: boolean): void {
        if (v === running) return;
        running = v;
        listeners.forEach(l => l(v));
    },
    get(): boolean {
        return running;
    },
    subscribe(l: Listener): () => void {
        listeners.add(l);
        return () => { listeners.delete(l); };
    },
};
