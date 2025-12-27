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

    private sensitivityThreshold = 0.03; // Default

    /**
     * Set sensitivity from 0.0 (least sensitive) to 1.0 (most sensitive).
     * Maps to approximate dB Thresholds:
     * 0.0 -> -20 dB (0.1 RMS) - Requires loud input
     * 1.0 -> -60 dB (0.001 RMS) - Very sensitive, picks up background noise
     */
    setSensitivity(value: number) {
        // Clamp value 0-1
        const v = Math.max(0, Math.min(1, value));

        // Linear map to dB: -20dB to -60dB
        // High sensitivity (1.0) = Lower Threshold (-60dB)
        const db = -20 - (v * 40);

        // Convert dB to RMS amplitude
        this.sensitivityThreshold = Math.pow(10, db / 20);
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

        if (rms < this.sensitivityThreshold) return null;

        const pitch = this.detector(this.buffer);

        // Widen range for Bass (E1 ~41Hz, but A0 is 27.5Hz) and Whistle (C8 ~4186Hz, Harmonics go higher)
        // Range 25Hz - 8000Hz covers Piano A0 to well above highest fundamental
        if (pitch && (pitch < 25 || pitch > 8000)) return null;

        return pitch;
    }
}
