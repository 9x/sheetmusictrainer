import { YIN, ACF2PLUS } from "pitchfinder";
import {
    MIC_SENSITIVITY_DB_RANGE,
    AUDIO_CONSTRAINTS,
    PITCH_BUFFER_SIZE,
    PITCH_MIN_WINDOW,
    PITCH_DEFAULT_LOWEST_HZ,
    PITCH_HIGH_REGISTER_HZ,
    PITCH_NORMALIZE_TARGET_RMS,
    PITCH_BELOW_FLOOR_REJECT_FACTOR,
} from "../AppConfig";
import { createAudioContext } from "./AudioEngine";

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

export type PitchDetectorFn = (buffer: Float32Array) => number | null;

export interface DetectorSpec {
    detector: PitchDetectorFn;
    /** Whether the analysis buffer must be RMS-normalized before detection */
    normalize: boolean;
}

/**
 * Smallest power-of-two analysis window that still fits ~2 periods of the
 * lowest required frequency. Smaller window = lower latency and ~4x less CPU
 * per analysis frame. Clamped to [PITCH_MIN_WINDOW, PITCH_BUFFER_SIZE].
 */
export function chooseAnalysisWindowSize(sampleRate: number, lowestHz: number): number {
    const needed = Math.ceil((2 * sampleRate) / lowestHz);
    const pow2 = 2 ** Math.ceil(Math.log2(Math.max(1, needed)));
    return Math.max(PITCH_MIN_WINDOW, Math.min(PITCH_BUFFER_SIZE, pow2));
}

/**
 * Pick a detector for the instrument's range.
 *
 * pitchfinder's YIN force-sets yinBuffer[1] = 1 before cumulative
 * normalization, which makes its absolute-threshold search latch onto tau=2
 * (~20 kHz garbage) for low fundamentals — below ~100 Hz it is unreliable no
 * matter the window size. ACF2PLUS is robust from ~40 Hz up to ~2 kHz, but
 * tends to pick subharmonics above that. So: ACF2PLUS for normal instruments,
 * YIN only for high registers (e.g. whistle) where its low-end weakness is
 * irrelevant.
 *
 * Only the YIN path gets normalized input: ACF2PLUS has an internal
 * "rms < 0.01 -> unpitched" gate that must see the RAW signal — normalizing
 * first would amplify room hum/noise floors into confident wrong pitches
 * (the tuner then appears "stuck" on a note nobody played).
 */
export function selectDetector(sampleRate: number, lowestHz: number): DetectorSpec {
    if (lowestHz >= PITCH_HIGH_REGISTER_HZ) {
        return { detector: YIN({ sampleRate }), normalize: true };
    }
    return { detector: ACF2PLUS({ sampleRate }), normalize: false };
}

/** Kept for backwards compatibility with existing tests. */
export function createPitchDetector(sampleRate: number, lowestHz: number): PitchDetectorFn {
    return selectDetector(sampleRate, lowestHz).detector;
}

/**
 * Scale the buffer in place to a constant RMS operating level (clamped to
 * [-1, 1]). Detectors are sensitive to absolute amplitude; without this,
 * quiet low-frequency input makes YIN return ~20 kHz nonsense.
 */
export function normalizeSignal(buffer: Float32Array, targetRms?: number): void {
    let rms = 0;
    for (let i = 0; i < buffer.length; i++) rms += buffer[i] * buffer[i];
    rms = Math.sqrt(rms / buffer.length);
    if (rms < 1e-6) return;
    const target = targetRms ?? PITCH_NORMALIZE_TARGET_RMS;
    const gain = target / rms;
    for (let i = 0; i < buffer.length; i++) {
        const v = buffer[i] * gain;
        buffer[i] = v > 1 ? 1 : v < -1 ? -1 : v;
    }
}

export class PitchAnalyzer {
    private detector: PitchDetectorFn | null = null;
    private normalizeInput = false;
    private audioContext: AudioContext | null = null;
    private analyser: AnalyserNode | null = null;
    private mediaStream: MediaStream | null = null;
    private source: MediaStreamAudioSourceNode | null = null;

    /** Full-size backing buffer (fftSize samples) */
    private buffer = new Float32Array(PITCH_BUFFER_SIZE);
    /** Tail-view into `buffer`; only the most recent windowSize samples are analyzed */
    private window: Float32Array<ArrayBuffer> = this.buffer;
    private windowSize = PITCH_BUFFER_SIZE;
    private lowestFrequency = PITCH_DEFAULT_LOWEST_HZ;

    // Debug info
    private inputDeviceLabel: string = 'Not detected';
    private inputDeviceId: string = '';
    private permissionState: PermissionState | 'unknown' = 'unknown';
    private currentRmsLevel: number = 0;

    private sensitivityThreshold = 0.03; // Default

    /**
     * Set sensitivity from 0.0 (least sensitive) to 1.0 (most sensitive).
     * Maps to approximate dB Thresholds based on AppConfig
     */
    setSensitivity(value: number) {
        // Clamp value 0-1
        const v = Math.max(0, Math.min(1, value));

        // Linear map to dB using Config Range
        const { min, max } = MIC_SENSITIVITY_DB_RANGE;
        const db = min + (v * (max - min));

        // Convert dB to RMS amplitude
        this.sensitivityThreshold = Math.pow(10, db / 20);
    }

    /**
     * Configure the lowest frequency that must be detectable (Hz) and shrink
     * the analysis window accordingly.
     *
     * Pitch detection needs ~2 periods of the target frequency in the window.
     * A fixed 4096-sample window always analyzes ~90ms of audio history, which
     * makes the tuner feel sluggish. Guitar/piano/voice (>= ~65 Hz) only need
     * 2048 samples (~45ms) — half the latency at a quarter of the CPU cost.
     * Bass (E1 ~ 41 Hz) keeps the full 4096 window.
     */
    setLowestFrequency(hz: number) {
        if (hz > 0) {
            this.lowestFrequency = hz;
            this.updateWindowSize();
            this.rebuildDetector();
        }
    }

    private updateWindowSize() {
        if (!this.audioContext) return; // applied on start()
        const size = chooseAnalysisWindowSize(this.audioContext.sampleRate, this.lowestFrequency);
        if (size !== this.windowSize) {
            this.windowSize = size;
            // View over the tail of the backing buffer: getFloatTimeDomainData
            // fills it with the most recent `size` samples.
            const byteOffset = (PITCH_BUFFER_SIZE - size) * Float32Array.BYTES_PER_ELEMENT;
            this.window = new Float32Array(this.buffer.buffer, byteOffset, size);
        }
    }

    private rebuildDetector() {
        if (!this.audioContext) return; // applied on start()
        const spec = selectDetector(this.audioContext.sampleRate, this.lowestFrequency);
        this.detector = spec.detector;
        this.normalizeInput = spec.normalize;
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

        this.audioContext = createAudioContext();
        this.updateWindowSize();
        this.rebuildDetector();

        try {
            // Use configured audio constraints
            const constraints: MediaStreamConstraints = {
                audio: AUDIO_CONSTRAINTS
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
            this.analyser.fftSize = PITCH_BUFFER_SIZE; // Large buffer; analyzed window adapts per instrument

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
        this.detector = null;
        this.analyser = null;
        this.source = null;
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
        if (!this.analyser || !this.detector) return null;
        // Always copy the full fftSize buffer (universally supported usage),
        // then analyze only the tail view = most recent windowSize samples.
        // (Passing an undersized array directly relies on browser-specific
        // behavior of getFloatTimeDomainData.)
        this.analyser.getFloatTimeDomainData(this.buffer);

        // Simple RMS volume check to avoid noise (on the analyzed window)
        let rms = 0;
        for (let i = 0; i < this.window.length; i++) {
            rms += this.window[i] * this.window[i];
        }
        rms = Math.sqrt(rms / this.window.length);

        // Store RMS for level meter
        this.currentRmsLevel = rms;

        if (rms < this.sensitivityThreshold) return null;

        // Normalize only on the YIN/high-register path. ACF2PLUS must see the
        // raw signal so its internal "rms < 0.01 -> unpitched" gate keeps
        // rejecting quiet decayed audio instead of amplifying it into a
        // confident wrong pitch.
        if (this.normalizeInput) {
            normalizeSignal(this.window);
        }

        const pitch = this.detector(this.window);

        // Widen range for Bass (E1 ~41Hz, but A0 is 27.5Hz) and Whistle (C8 ~4186Hz, Harmonics go higher)
        // Range 25Hz - 8000Hz covers Piano A0 to well above highest fundamental
        // (Also filters out the -1 some detectors return for "unpitched".)
        if (pitch === null || pitch < 25 || pitch > 8000) return null;

        // Implausible for the current instrument (e.g. 50/60 Hz mains hum
        // while playing guitar): reject readings far below the configured floor.
        if (pitch < this.lowestFrequency * PITCH_BELOW_FLOOR_REJECT_FACTOR) return null;

        return pitch;
    }
}
