/**
 * Global application configuration
 */

// How long (in ms) the target note must be detected to count as correct.
// Protects against spurious single-frame detections.
export const NOTE_MATCH_THRESHOLD_MS = 50;

// Grace period (in ms): brief detection dropouts or wrong frames while holding
// a note do NOT reset the match timer. Pitch detectors (YIN) routinely flicker
// for a frame or two during note attacks and decays; a hard reset on every
// flicker makes the threshold above feel broken ("shows green but won't register").
export const NOTE_MATCH_GRACE_MS = 150;

// How long (in ms) after speaker playback ends that mic-based matching stays
// gated, so the app doesn't "hear itself" (ear-training auto-play, Play Note
// button, virtual instruments).
export const PLAYBACK_GATE_TAIL_MS = 400;

// Safety cap for the "wait for silence" option: if the mic never goes quiet
// (continuously detectable sound in the room), the next reference note plays
// anyway after this delay so the app can't stall indefinitely.
export const REFERENCE_QUIET_MAX_WAIT_MS = 8000;

// Display smoothing (exponential moving average factor, 0-1) applied to the
// cents reading and the audio level in the detection loop (~60 fps). Keeps
// the tuner needle and level meter readable without CSS transitions — a
// transition on a value that changes every frame is interrupted 60x per
// second, which Safari/WebKit handles by leaving the element stuck.
// 0.25 ≈ 80ms effective smoothing: damps jitter but stays very responsive.
export const DISPLAY_EMA_FACTOR = 0.25;

// How many consecutive detection frames a different note must persist before
// the displayed note name switches (~50ms at 60fps). Prevents the note name
// from flickering between adjacent notes when playing right at a semitone
// boundary. Matching is unaffected (it uses the raw midi value).
export const NOTE_DISPLAY_STABLE_FRAMES = 3;

// How long (in ms) the last detected pitch is kept on screen after the signal
// disappears, before the readout is cleared. Prevents flicker between frames
// without leaving stale notes hanging forever.
export const PITCH_READING_HOLD_MS = 200;

// Pitch analysis window (samples @ AudioContext rate).
// The analyzer adapts the window down from BUFFER_SIZE based on the lowest
// frequency that must be detected (~2 periods minimum). Smaller window =
// lower latency and 4x less CPU per analysis. 4096 covers bass E1 (~41 Hz).
export const PITCH_BUFFER_SIZE = 4096;
export const PITCH_MIN_WINDOW = 1024;

// Fallback for the lowest detectable frequency before the app configures
// the actual instrument range. ~70 Hz covers guitar low E with margin.
export const PITCH_DEFAULT_LOWEST_HZ = 70;

// Instruments whose lowest note is at/above this frequency use YIN instead of
// ACF2PLUS: ACF2PLUS picks subharmonics above ~2 kHz, while YIN's weakness
// below ~100 Hz is irrelevant for high registers (e.g. whistle).
export const PITCH_HIGH_REGISTER_HZ = 300;

// Target RMS for normalizing the analysis buffer before pitch detection
// (YIN/high-register path only — see selectDetector in PitchAnalyzer).
// pitchfinder's YIN force-sets yinBuffer[1] = 1 before normalization, so at
// low absolute amplitudes its difference function gets dwarfed and it latches
// onto tau=2 (~20 kHz garbage). A constant operating level fixes this.
export const PITCH_NORMALIZE_TARGET_RMS = 0.3;

// Detected pitches below (instrument floor × this factor) are rejected as
// implausible — e.g. 50/60 Hz mains hum showing up as a confident wrong note
// while a guitar (floor ~78 Hz) is not playing. ~4 semitones of margin.
export const PITCH_BELOW_FLOOR_REJECT_FACTOR = 2 ** (-4 / 12); // ≈ 0.794

// Microphone Sensitivity Configuration
// Sensitivity Scale: 0.0 (Low) to 1.0 (High)
// Linear mapping to dB thresholds
export const MIC_SENSITIVITY_DB_RANGE = {
    min: -10,  // 0.0 Sensitivity: Loudest input required (e.g. loud singing/instrument)
    max: -100   // 1.0 Sensitivity: Quietest input accepted (mic floor)
};

export const MIC_DEFAULT_SENSITIVITY = 0.75; // Bias towards high sensitivity for ease of use

// Audio Constraints for getUserMedia
// Disabled processing is generally better for musical pitch detection
export const AUDIO_CONSTRAINTS = {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
};
