import { midiToFrequency } from '../music/NoteUtils';
import { PLAYBACK_GATE_TAIL_MS } from '../AppConfig';

/**
 * Create an AudioContext with a typed webkit fallback (older Safari).
 */
export function createAudioContext(): AudioContext {
    const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    return new Ctor({ latencyHint: 'interactive' });
}

/**
 * Shared audio playback engine (singleton).
 *
 * All speaker output goes through a single AudioContext (previously App and
 * useGameLogic each created their own via separate useAudioPlayer instances).
 * Playback is tracked so pitch detection can ignore the microphone while the
 * app is audible — otherwise the app hears its own reference notes through
 * the speaker and scores them as correct (ear-training feedback loop).
 */
class AudioEngine {
    private ctx: AudioContext | null = null;
    /** ctx.currentTime (seconds) until which output may still be audible, incl. gate tail */
    private audibleUntil = 0;

    private ensureContext(): AudioContext {
        if (!this.ctx) {
            this.ctx = createAudioContext();
        }
        if (this.ctx.state === 'suspended') {
            void this.ctx.resume();
        }
        return this.ctx;
    }

    playNote(midi: number, duration = 0.5, volume = 0.3): void {
        const ctx = this.ensureContext();

        const osc = ctx.createOscillator();
        const gainNode = ctx.createGain();

        osc.frequency.value = midiToFrequency(midi);
        // Triangle wave is often nicer than sine for music training
        osc.type = 'triangle';

        osc.connect(gainNode);
        gainNode.connect(ctx.destination);

        const now = ctx.currentTime;

        // Attack
        gainNode.gain.setValueAtTime(0, now);
        gainNode.gain.linearRampToValueAtTime(volume, now + 0.02);
        // Sustain -> Release
        gainNode.gain.exponentialRampToValueAtTime(0.001, now + duration);

        osc.start(now);
        osc.stop(now + duration + 0.1); // Stop slightly after fade out

        // The note decays to -60dB at `now + duration`; keep the mic gated for
        // an additional tail so room reverb / speaker bleed can't self-trigger.
        this.audibleUntil = Math.max(
            this.audibleUntil,
            now + duration + PLAYBACK_GATE_TAIL_MS / 1000
        );
    }

    /**
     * True while speaker output (plus gate tail) may still be audible at the
     * microphone. Mic-based note matching should be ignored during this time.
     *
     * A suspended AudioContext (autoplay policy, no user gesture yet) reports
     * currentTime = 0 forever — without the state check the gate would be
     * stuck "audible" permanently and matching would never engage.
     */
    isAudible(): boolean {
        if (!this.ctx || this.ctx.state !== 'running') return false;
        return this.ctx.currentTime < this.audibleUntil;
    }
}

export const audioEngine = new AudioEngine();
