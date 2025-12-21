import { YIN } from "pitchfinder";

export class PitchAnalyzer {
    private detector: (buffer: Float32Array) => number | null;
    private audioContext: AudioContext | null = null;
    private analyser: AnalyserNode | null = null;
    private mediaStream: MediaStream | null = null;
    private source: MediaStreamAudioSourceNode | null = null;
    private buffer: Float32Array;

    constructor() {
        this.detector = YIN({ sampleRate: 44100 }); // Default, will update on start
        this.buffer = new Float32Array(2048); // Standard size
    }

    async start(): Promise<void> {
        if (this.audioContext) return;

        this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
        this.detector = YIN({ sampleRate: this.audioContext.sampleRate });

        try {
            this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            this.source = this.audioContext.createMediaStreamSource(this.mediaStream);
            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = 4096; // Higher FFT size for better resolution at low frequencies
            this.buffer = new Float32Array(this.analyser.fftSize);

            this.source.connect(this.analyser);
        } catch (e) {
            console.error("Error accessing microphone:", e);
            throw e;
        }
    }

    stop() {
        if (this.mediaStream) {
            this.mediaStream.getTracks().forEach(track => track.stop());
            this.mediaStream = null;
        }
        if (this.audioContext) {
            this.audioContext.close();
            this.audioContext = null;
        }
    }

    /**
     * getPitch returns the detected frequency in Hz, or null if no pitch detected
     */
    getPitch(): number | null {
        if (!this.analyser) return null;
        this.analyser.getFloatTimeDomainData(this.buffer as any);

        // Simple RMS volume check to avoid noise
        let rms = 0;
        for (let i = 0; i < this.buffer.length; i++) {
            rms += this.buffer[i] * this.buffer[i];
        }
        rms = Math.sqrt(rms / this.buffer.length);

        if (rms < 0.05) return null; // Silence threshold increased to 0.05 for robustness because 0.01 picked up noise

        const pitch = this.detector(this.buffer);

        // Guitar range filtering:
        // Low E (E2) is ~82Hz. Drop D is ~73Hz.
        // High E (E4) is ~330Hz. 12th fret E5 is ~660Hz.
        // Harmonics can go higher, but unlikely above 1500Hz for fundamental training.
        // 19kHz (user reported D#10) is definitely noise.
        if (pitch && (pitch < 70 || pitch > 1500)) return null;

        return pitch;
    }
}
