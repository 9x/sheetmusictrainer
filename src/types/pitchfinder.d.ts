declare module 'pitchfinder' {
    interface PitchFinderConfig {
        sampleRate: number;
        frequency?: number;
        minFrequency?: number;
        maxFrequency?: number;
        threshold?: number;
        probabilityThreshold?: number;
    }

    type Detector = (float32Array: Float32Array) => number | null;

    export function YIN(config?: PitchFinderConfig): Detector;
    export function AMDF(config?: PitchFinderConfig): Detector;
    export function ACF2PLUS(config?: PitchFinderConfig): Detector;
    export function Macleod(config?: PitchFinderConfig): (buffer: Float32Array) => { frequency: number; probability: number } | null;
}
