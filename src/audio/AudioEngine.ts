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
interface ActiveNote {
    osc: OscillatorNode;
    gain: GainNode;
    /** Audio-clock time after which this note is no longer sounding. */
    endsAt: number;
    groupId: string;
}

class AudioEngine {
    private ctx: AudioContext | null = null;
    /** ctx.currentTime (seconds) until which output may still be audible, incl. gate tail */
    private audibleUntil = 0;
    /** Currently scheduled/playing notes, for cancellation (preview groups). */
    private active: ActiveNote[] = [];
    /** Mic blanking after non-tonal metronome clicks (seconds, audio clock). */
    private clickBlankUntil = 0;
    private noiseBuffer: AudioBuffer | null = null;

    /** Audio-clock time; 0 when no context exists yet. */
    now(): number {
        return this.ctx ? this.ctx.currentTime : 0;
    }

    /** Create/resume the context (must be called from a user gesture). */
    async ensureRunning(): Promise<void> {
        this.ensureContext();
        if (this.ctx && this.ctx.state === 'suspended') {
            await this.ctx.resume();
        }
    }

    isRunning(): boolean {
        return !!this.ctx && this.ctx.state === 'running';
    }

    private ensureContext(): AudioContext {
        if (!this.ctx) {
            this.ctx = createAudioContext();
        }
        if (this.ctx.state === 'suspended') {
            void this.ctx.resume();
        }
        return this.ctx;
    }

    playNote(midi: number, duration = 0.5, volume = 0.3, groupId = 'oneshot'): void {
        const ctx = this.ensureContext();
        const now = ctx.currentTime;
        this.scheduleNote(midi, now, duration, volume, groupId);
    }

    /**
     * Schedule a pitched note at an absolute audio-clock time (phrase preview).
     * Registers the node so the group can be cancelled; the mic gate covers
     * the whole scheduled span (see isAudible).
     */
    scheduleNote(midi: number, startAt: number, duration: number, volume = 0.3, groupId = 'preview'): void {
        const ctx = this.ensureContext();

        const osc = ctx.createOscillator();
        const gainNode = ctx.createGain();

        osc.frequency.value = midiToFrequency(midi);
        osc.type = 'triangle';

        osc.connect(gainNode);
        gainNode.connect(ctx.destination);

        // Attack
        gainNode.gain.setValueAtTime(0, startAt);
        gainNode.gain.linearRampToValueAtTime(volume, startAt + 0.02);
        // Sustain -> Release
        gainNode.gain.exponentialRampToValueAtTime(0.001, startAt + duration);

        osc.start(startAt);
        osc.stop(startAt + duration + 0.1);

        this.active.push({ osc, gain: gainNode, endsAt: startAt + duration, groupId });
        // The note decays to -60dB at `startAt + duration`; keep the mic gated
        // for an additional tail so room reverb / speaker bleed can't self-trigger.
        this.audibleUntil = Math.max(
            this.audibleUntil,
            startAt + duration + PLAYBACK_GATE_TAIL_MS / 1000
        );
    }

    /**
     * Cancel a playback group (preview, metronome clicks). Stops scheduled
     * nodes, removes them, and recomputes the mic gate from what remains —
     * a cancelled long preview must not keep the mic gated until its former
     * end time.
     */
    cancelGroup(groupId: string): void {
        if (!this.ctx) return;
        const now = this.ctx.currentTime;
        this.active = this.active.filter(n => {
            if (n.groupId !== groupId) return true;
            try {
                n.gain.gain.cancelScheduledValues(now);
                n.gain.gain.setValueAtTime(0, now);
                n.osc.stop(now + 0.01);
            } catch {
                // Already stopped — nothing to do.
            }
            return false;
        });
        this.recomputeGate();
    }

    private recomputeGate(): void {
        this.audibleUntil = this.active.reduce(
            (max, n) => Math.max(max, n.endsAt + PLAYBACK_GATE_TAIL_MS / 1000),
            0
        );
    }

    /**
     * Short NON-TONAL metronome click (~10 ms noise burst). Not registered in
     * the pitched-audio gate; instead the mic is blanked for 30 ms so the
     * click itself can't be scored as a pitch (contract E2).
     * Optional groupId: the click becomes cancellable via cancelGroup (used
     * by preview clicks so stopping a preview also stops its clicks).
     */
    playClickAt(time: number, volume = 0.5, accent = false, groupId?: string): void {
        const ctx = this.ensureContext();
        if (!this.noiseBuffer) {
            const len = Math.floor(ctx.sampleRate * 0.01);
            this.noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
            const data = this.noiseBuffer.getChannelData(0);
            for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
        }
        const src = ctx.createBufferSource();
        src.buffer = this.noiseBuffer;
        const gainNode = ctx.createGain();
        const v = accent ? Math.min(1, volume * 1.6) : volume;
        gainNode.gain.setValueAtTime(v, time);
        gainNode.gain.exponentialRampToValueAtTime(0.001, time + 0.01);
        src.connect(gainNode);
        gainNode.connect(ctx.destination);
        src.start(time);
        src.stop(time + 0.02);
        this.clickBlankUntil = Math.max(this.clickBlankUntil, time + 0.03);
        if (groupId) {
            // Register as a cancellable node (cast: clicks are buffer sources,
            // cancelGroup only calls stop() on them, which BufferSource has).
            this.active.push({ osc: src as unknown as OscillatorNode, gain: gainNode, endsAt: time + 0.02, groupId });
        }
    }

    /** True for ~30 ms after a scheduled click (mic frames should be skipped). */
    isMicBlanked(): boolean {
        return !!this.ctx && this.ctx.state === 'running' && this.ctx.currentTime < this.clickBlankUntil;
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
