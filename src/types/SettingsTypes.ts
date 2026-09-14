export type Difficulty = string;

/** Unified target-note filter, shared by all game modes (v2 controls). */
export interface PracticeFilter {
    /** Restrict target notes to pitch classes of this key/mode (null = off). */
    keyEnabled: boolean;
    keyTonic: string;
    keyMode: string; // ModeId
    /** Restrict target notes to selected strings (fretted instruments only).
     *  Empty array = no restriction (all strings). Index 0 = lowest string. */
    strings: number[];
    /** Restrict target notes to a fret range (fretted instruments only). */
    fretWindowEnabled: boolean;
    fretMin: number;
    fretMax: number;
}

export const DEFAULT_PRACTICE_FILTER: PracticeFilter = {
    keyEnabled: false,
    keyTonic: 'C',
    keyMode: 'major',
    strings: [],
    fretWindowEnabled: false,
    fretMin: 0,
    fretMax: 4,
};

export function getPracticeFilter(s: AppSettings): PracticeFilter {
    return { ...DEFAULT_PRACTICE_FILTER, ...(s.practice ?? {}) };
}

export interface RhythmSettings {
    mode: 'bpm' | 'seconds';
    bpm: number;
    seconds: number;
    active: boolean;
    autoAdvance: boolean;
    sound: boolean;
    volume: number;
}

export type PhraseMaterial = 'melody' | 'scale' | 'arpeggio' | 'library' | 'import';
export type PhrasePace = 'step' | 'tempo';

export interface PhraseSettings {
    material: PhraseMaterial;
    libraryId: string;
    /** Imported score id (the parsed score lives in component state, session-only). */
    keyTonic: string;
    keyMode: string; // ModeId
    bars: number; // 1–8 (melodies)
    meterNumerator: 3 | 4;
    rhythmLevel: 1 | 2 | 3;
    scaleCoverage: 'one-octave' | 'two-octave' | 'position';
    scaleDirection: 'up' | 'down' | 'updown';
    scaleRhythm: 'quarters' | 'eighths';
    /** Arpeggio settings (material = 'arpeggio'). */
    arpeggioDegree: string; // ArpeggioDegree (single-chord mode / sequence start)
    /** Sequence mode: which degrees may appear (empty = all 7). */
    arpeggioChordSelection: string[];
    arpeggioPattern: 'up' | 'down' | 'updown' | '1235';
    arpeggioCoverage: 'one-octave' | 'two-octave';
    /** Sequence mode: bars per exercise (1 = single chord). */
    arpeggioBars: number;
    arpeggioProgression: 'random' | 'functional' | 'diatonic-cycle';
    arpeggioRhythm: 'quarters' | 'eighths';
    /** Phrase-local fret window (guitar/bass) — overrides the note set. */
    fretWindowEnabled: boolean;
    fretMin: number;
    fretMax: number;
    /** Practice range for library/import material (1-based, inclusive). */
    startBar: number;
    barCount: number;
    pace: PhrasePace;
    bpm: number;
    clickSound: boolean;
    /** When a run finishes, automatically continue (next exercise section /
     *  new melody) after a short pause — keeps practice flowing. */
    autoContinue: boolean;
    inputMode: 'mic' | 'virtual';
    /** Begin the run as soon as the first note is played (no count-in,
     *  step pace only). */
    autoStartOnNote: boolean;
}

export const DEFAULT_PHRASE_SETTINGS: PhraseSettings = {
    material: 'melody',
    libraryId: '',
    keyTonic: 'C',
    keyMode: 'major',
    bars: 2,
    meterNumerator: 4,
    rhythmLevel: 1,
    scaleCoverage: 'one-octave',
    scaleDirection: 'updown',
    scaleRhythm: 'quarters',
    arpeggioDegree: 'I',
    arpeggioChordSelection: [],
    arpeggioPattern: 'up',
    arpeggioCoverage: 'one-octave',
    arpeggioBars: 1,
    arpeggioProgression: 'functional',
    arpeggioRhythm: 'quarters',
    fretWindowEnabled: false,
    fretMin: 0,
    fretMax: 4,
    startBar: 1,
    barCount: 2,
    pace: 'step',
    bpm: 60,
    clickSound: false,
    autoContinue: true,
    inputMode: 'mic',
    autoStartOnNote: false,
};

export function getPhraseSettings(s: AppSettings): PhraseSettings {
    return { ...DEFAULT_PHRASE_SETTINGS, ...(s.phrase ?? {}) };
}

export interface AppSettings {
    phrase?: PhraseSettings;
    /** Unified target-note filter (key + fret window), all modes. */
    practice?: PracticeFilter;
    difficulty: Difficulty;
    showHint: boolean;
    showFretboard: boolean;
    showTuningMeter: boolean;
    tuningId: string;
    keySignature: string;
    /** Keep display key signature in sync with the target-key control. */
    keyFollowsTarget?: boolean;
    instrument: string;
    rhythm: RhythmSettings;
    zenMode: boolean;
    gameMode: 'sight_reading' | 'ear_training' | 'phrase';
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
    keyFollowsTarget: false,
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
    phrase: DEFAULT_PHRASE_SETTINGS,
    practice: DEFAULT_PRACTICE_FILTER,
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
