export type Difficulty = string;

export interface RhythmSettings {
    mode: 'bpm' | 'seconds';
    bpm: number;
    seconds: number;
    active: boolean;
    autoAdvance: boolean;
    sound: boolean;
    volume: number;
}

export interface AppSettings {
    difficulty: Difficulty;
    showHint: boolean;
    showFretboard: boolean;
    showTuningMeter: boolean;
    tuningId: string;
    keySignature: string;
    instrument: string;
    rhythm: RhythmSettings;
    zenMode: boolean;
    gameMode: 'sight_reading' | 'ear_training';
    customMinFret?: number;
    customMaxFret?: number;
    autoPlaySightReading?: boolean;
    autoPlayVolume?: number;
    /** Length of the played reference note in seconds */
    referenceNoteDuration?: number;
    /** Hold the next reference note until the microphone detects silence,
     *  so a still-ringing instrument doesn't mask it */
    waitForQuiet?: boolean;
    virtualGuitarVolume?: number;
    virtualGuitarMute?: boolean;
    micSensitivity?: number;
    disableAnimation?: boolean;
    theme?: 'light' | 'dark' | 'auto';
}

export const DEFAULT_SETTINGS: AppSettings = {
    difficulty: 'first_pos',
    showHint: false,
    showFretboard: false,
    showTuningMeter: false,
    tuningId: 'standard',
    keySignature: 'C',
    instrument: 'guitar',
    rhythm: {
        mode: 'bpm',
        bpm: 60,
        seconds: 5,
        active: false,
        autoAdvance: false,
        sound: true,
        volume: 0.5
    },
    zenMode: false,
    gameMode: 'sight_reading',
    customMinFret: 0,
    customMaxFret: 12,
    autoPlaySightReading: false,
    autoPlayVolume: 0.5,
    referenceNoteDuration: 1.5,
    waitForQuiet: false,
    virtualGuitarVolume: 0.5,
    virtualGuitarMute: false,
    micSensitivity: 0.5,
    disableAnimation: false,
    theme: 'auto'
};
