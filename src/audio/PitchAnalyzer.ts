import { YIN } from "pitchfinder";

export interface MicrophoneDebugInfo {
    audioContextState: AudioContextState | 'inactive';
    sampleRate: number | null;
    inputDeviceLabel: string;
    inputDeviceId: string;
    permissionState: PermissionState | 'unknown';
    currentRmsLevel: number;
    currentRmsDb: number;
    isCapturing: boolean;
}

export class PitchAnalyzer {
    private detector: (buffer: Float32Array) => number | null;
    private audioContext: AudioContext | null = null;
    private analyser: AnalyserNode | null = null;
    private mediaStream: MediaStream | null = null;
    private source: MediaStreamAudioSourceNode | null = null;
    private buffer: Float32Array;

    // Debug info
    private inputDeviceLabel: string = 'Not detected';
    private inputDeviceId: string = '';
    private permissionState: PermissionState | 'unknown' = 'unknown';
    private currentRmsLevel: number = 0;

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

        // Check permission state if available
        try {
            if (navigator.permissions && navigator.permissions.query) {
                const result = await navigator.permissions.query({ name: 'microphone' as PermissionName });
                this.permissionState = result.state;
            }
        } catch {
            // permissions API not available on all browsers
            this.permissionState = 'unknown';
        }

        this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
        this.detector = YIN({ sampleRate: this.audioContext.sampleRate });

        try {
            // Use more explicit audio constraints for better Android compatibility
            const constraints: MediaStreamConstraints = {
                audio: {
                    echoCancellation: false,
                    noiseSuppression: false,
                    autoGainControl: false,
                }
            };

            this.mediaStream = await navigator.mediaDevices.getUserMedia(constraints);

            // Get device info
            const audioTracks = this.mediaStream.getAudioTracks();
            if (audioTracks.length > 0) {
                const track = audioTracks[0];
                const settings = track.getSettings();
                this.inputDeviceId = settings.deviceId || '';
                this.inputDeviceLabel = track.label || 'Unknown Device';

                // If label is empty, try to get it from enumerateDevices
                if (!track.label && settings.deviceId) {
                    try {
                        const devices = await navigator.mediaDevices.enumerateDevices();
                        const matchedDevice = devices.find(d => d.deviceId === settings.deviceId);
                        if (matchedDevice && matchedDevice.label) {
                            this.inputDeviceLabel = matchedDevice.label;
                        }
                    } catch {
                        // enumerateDevices not available
                    }
                }
            }

            this.source = this.audioContext.createMediaStreamSource(this.mediaStream);
            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = 4096; // Higher FFT size for better resolution at low frequencies
            this.buffer = new Float32Array(this.analyser.fftSize);

            this.source.connect(this.analyser);

            // CRITICAL for Android: Resume AudioContext after user interaction
            // Android Chrome suspends AudioContext by default
            if (this.audioContext.state === 'suspended') {
                await this.audioContext.resume();
            }
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
        this.currentRmsLevel = 0;
        this.inputDeviceLabel = 'Not detected';
        this.inputDeviceId = '';
    }

    /**
     * Get current debug/diagnostic information
     */
    getDebugInfo(): MicrophoneDebugInfo {
        const rmsDb = this.currentRmsLevel > 0
            ? 20 * Math.log10(this.currentRmsLevel)
            : -Infinity;

        return {
            audioContextState: this.audioContext?.state || 'inactive',
            sampleRate: this.audioContext?.sampleRate || null,
            inputDeviceLabel: this.inputDeviceLabel,
            inputDeviceId: this.inputDeviceId,
            permissionState: this.permissionState,
            currentRmsLevel: this.currentRmsLevel,
            currentRmsDb: isFinite(rmsDb) ? rmsDb : -100,
            isCapturing: this.analyser !== null && this.audioContext?.state === 'running',
        };
    }

    /**
     * Get current RMS level (0-1 range, useful for level meters)
     */
    getCurrentLevel(): number {
        return this.currentRmsLevel;
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

        // Store RMS for level meter
        this.currentRmsLevel = rms;

        if (rms < this.sensitivityThreshold) return null;

        const pitch = this.detector(this.buffer);

        // Widen range for Bass (E1 ~41Hz, but A0 is 27.5Hz) and Whistle (C8 ~4186Hz, Harmonics go higher)
        // Range 25Hz - 8000Hz covers Piano A0 to well above highest fundamental
        if (pitch && (pitch < 25 || pitch > 8000)) return null;

        return pitch;
    }
}
