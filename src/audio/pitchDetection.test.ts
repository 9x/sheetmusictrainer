import { describe, it, expect } from 'vitest';
import {
    chooseAnalysisWindowSize,
    selectDetector,
    normalizeSignal,
} from './PitchAnalyzer';
import {
    PITCH_BUFFER_SIZE,
    PITCH_MIN_WINDOW,
    PITCH_BELOW_FLOOR_REJECT_FACTOR,
} from '../AppConfig';

/**
 * Regression tests for the pitch detection pipeline.
 *
 * pitchfinder's YIN returns ~20 kHz garbage for low fundamentals (its
 * forced yinBuffer[1] = 1 breaks the absolute-threshold search below
 * ~100 Hz) and for quiet input. The app therefore uses ACF2PLUS for normal
 * instruments, YIN only for high registers, and normalizes the analysis
 * buffer to a constant RMS. These tests synthesize instrument-like signals
 * (fundamental + harmonics + pluck decay, deterministic) and run them
 * through the exact helpers PitchAnalyzer uses.
 */

/** Deterministic instrument-like test signal (no RNG → no flaky tests). */
function synth(freq: number, sampleRate: number, length: number, amp: number): Float32Array {
    const buf = new Float32Array(length);
    for (let i = 0; i < length; i++) {
        const t = i / sampleRate;
        const env = Math.exp(-t * 3); // pluck-like decay
        buf[i] = amp * env * (
            Math.sin(2 * Math.PI * freq * t) +
            0.5 * Math.sin(2 * Math.PI * freq * 2 * t) +
            0.25 * Math.sin(2 * Math.PI * freq * 3 * t) +
            0.1 * Math.sin(2 * Math.PI * freq * 4 * t) +
            0.02 * Math.sin(2 * Math.PI * 7.13 * i / length) // deterministic "noise" dither
        );
    }
    return buf;
}

/** Mirror of PitchAnalyzer.getPitch, minus microphone plumbing. */
function detect(freq: number, sampleRate: number, lowestHz: number, amp = 0.3): number | null {
    const size = chooseAnalysisWindowSize(sampleRate, lowestHz);
    const buffer = synth(freq, sampleRate, size, amp);
    const { detector, normalize } = selectDetector(sampleRate, lowestHz);
    if (normalize) normalizeSignal(buffer);
    const pitch = detector(buffer);
    if (pitch === null || pitch < 25 || pitch > 8000) return null;
    if (pitch < lowestHz * PITCH_BELOW_FLOOR_REJECT_FACTOR) return null;
    return pitch;
}

function expectCloseTo(actual: number | null, expected: number) {
    expect(actual).not.toBeNull();
    expect(Math.abs(actual! - expected) / expected).toBeLessThan(0.03);
}

describe('chooseAnalysisWindowSize', () => {
    it('adapts to the instrument floor', () => {
        // Guitar low E2 (~78 Hz w/ margin) -> half window at 48k
        expect(chooseAnalysisWindowSize(48000, 77.8)).toBe(2048);
        // Bass low E1 (~39 Hz w/ margin) -> full window
        expect(chooseAnalysisWindowSize(48000, 38.9)).toBe(PITCH_BUFFER_SIZE);
        // Whistle register -> minimum window
        expect(chooseAnalysisWindowSize(48000, 622)).toBe(PITCH_MIN_WINDOW);
    });
});

describe('pitch detection across instruments (sample rate 48000)', () => {
    const SR = 48000;

    it('guitar (low E2)', () => {
        const floor = 77.8; // E2 minus one semitone
        expectCloseTo(detect(82.4, SR, floor), 82.4);   // E2 — the regression case
        expectCloseTo(detect(110.0, SR, floor), 110);   // A2
        expectCloseTo(detect(329.6, SR, floor), 329.6); // E4
    });

    it('guitar at low input level (quiet pluck tail)', () => {
        expectCloseTo(detect(82.4, SR, 77.8, 0.05), 82.4);
        expectCloseTo(detect(440, SR, 77.8, 0.05), 440);
    });

    it('bass (low E1)', () => {
        const floor = 38.9;
        expectCloseTo(detect(41.2, SR, floor), 41.2);  // E1 — broken even before the rewrite
        expectCloseTo(detect(55.0, SR, floor), 55);    // A1
    });

    it('piano', () => {
        const floor = 61.7; // C2 minus one semitone
        expectCloseTo(detect(65.4, SR, floor), 65.4);   // C2
        expectCloseTo(detect(261.6, SR, floor), 261.6); // C4
        expectCloseTo(detect(1046.5, SR, floor), 1046.5); // C6
    });

    it('whistle register (uses YIN, small window)', () => {
        const floor = 622; // E5 minus one semitone
        expectCloseTo(detect(659.3, SR, floor), 659.3);   // E5
        expectCloseTo(detect(2093.0, SR, floor), 2093);   // C7
        expectCloseTo(detect(4186.0, SR, floor), 4186);   // C8
    });
});

describe('pitch detection (sample rate 44100)', () => {
    it('still works', () => {
        expectCloseTo(detect(82.4, 44100, 77.8), 82.4);
        expectCloseTo(detect(41.2, 44100, 38.9), 41.2);
        expectCloseTo(detect(440, 44100, 77.8), 440);
    });
});

describe('normalizeSignal', () => {
    it('scales to the target RMS', () => {
        const buf = synth(440, 48000, 2048, 0.02);
        normalizeSignal(buf, 0.3);
        let rms = 0;
        for (const v of buf) rms += v * v;
        rms = Math.sqrt(rms / buf.length);
        expect(rms).toBeGreaterThan(0.2); // ~0.3 modulo decay envelope shape
    });

    it('leaves silence untouched', () => {
        const buf = new Float32Array(1024);
        normalizeSignal(buf);
        expect(buf.every(v => v === 0)).toBe(true);
    });
});

describe('noise-floor rejection (tuner freeze regression)', () => {
    const SR = 48000;

    it('rejects 50 Hz mains hum for guitar (floor ~78 Hz)', () => {
        expect(detect(50, SR, 77.8)).toBeNull();
    });

    it('rejects 60 Hz mains hum for guitar', () => {
        expect(detect(60, SR, 77.8)).toBeNull();
    });

    it('rejects hum for the whistle register too', () => {
        expect(detect(50, SR, 622)).toBeNull();
        expect(detect(120, SR, 622)).toBeNull();
    });

    it('returns null for very quiet decayed signal instead of a confident wrong pitch', () => {
        // Raw RMS ~0.003: below ACF2PLUS's internal unpitched gate.
        // (Normalization must NOT rescue this into a bogus reading.)
        expect(detect(82.4, SR, 77.8, 0.005)).toBeNull();
    });

    it('still detects the string when it rings at moderate level', () => {
        expectCloseTo(detect(82.4, SR, 77.8, 0.05), 82.4);
    });
});
