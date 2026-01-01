/**
 * Global application configuration
 */

// How long (in ms) a note must be held to be accepted as correct
// How long (in ms) a note must be held to be accepted as correct
export const NOTE_MATCH_THRESHOLD_MS = 50;

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
