declare module 'pitchfinder' {
    interface PitchFinderConfig {
        sampleRate: number;
        frequency?: number;
        minFrequency?: number;
        maxFrequency?: number;
    }

    type Detector = (float32Array: Float32Array) => number | null;

    export function YIN(config?: PitchFinderConfig): Detector;
    export function AMDF(config?: PitchFinderConfig): Detector;
    export function MACLEOD(config?: PitchFinderConfig): Detector;
}
