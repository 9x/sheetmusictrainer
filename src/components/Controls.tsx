import { Settings, Guitar, Music, Gauge } from 'lucide-react';
import { TUNINGS, INSTRUMENT_TUNINGS } from '../music/Tunings';
import { INSTRUMENT_DEFINITIONS } from '../music/InstrumentConfigs';

export type Difficulty = 'all' | 'first_pos' | 'open' | 'e_string';

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
    tuningId: string;
    keySignature: string;
    instrument: string;
    showTuningMeter: boolean;
    rhythm: RhythmSettings;
    zenMode: boolean;
    gameMode: 'sight_reading' | 'ear_training';
}

interface ControlsProps {
    settings: AppSettings;
    onUpdateSettings: (s: AppSettings) => void;
}

export const Controls: React.FC<ControlsProps> = ({ settings, onUpdateSettings }) => {
    const handleDifficultyChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        onUpdateSettings({ ...settings, difficulty: e.target.value as Difficulty });
    };

    const handleTuningChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        onUpdateSettings({ ...settings, tuningId: e.target.value });
    };

    const handleInstrumentChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const newInstrumentId = e.target.value;
        const instDef = INSTRUMENT_DEFINITIONS[newInstrumentId];

        const defaultRange = instDef.ranges[0].id;

        // Reset tuning if applicable, or just keep as is (it won't be shown/used)
        let newTuningId = settings.tuningId;
        if (instDef.showTuning && INSTRUMENT_TUNINGS[newInstrumentId as 'guitar' | 'bass']) {
            newTuningId = INSTRUMENT_TUNINGS[newInstrumentId as 'guitar' | 'bass'][0];
        }

        onUpdateSettings({
            ...settings,
            instrument: newInstrumentId,
            difficulty: defaultRange as Difficulty,
            tuningId: newTuningId
        });
    };

    const updateRhythm = (updates: Partial<RhythmSettings>) => {
        onUpdateSettings({
            ...settings,
            rhythm: { ...settings.rhythm, ...updates }
        });
    };

    // Cast instrument to specific key if needed, or use generic record access
    const availableTunings = INSTRUMENT_TUNINGS[settings.instrument as 'guitar' | 'bass'] || [];
    const currentInstrumentDef = INSTRUMENT_DEFINITIONS[settings.instrument];



    return (
        <div className="controls-container">
            <div className="control-group">
                <label className="control-label">
                    <Music size={18} />
                    <span>Instrument</span>
                </label>
                <select
                    value={settings.instrument}
                    onChange={handleInstrumentChange}
                    className="control-select"
                >
                    {Object.values(INSTRUMENT_DEFINITIONS).map(def => (
                        <option key={def.id} value={def.id}>{def.displayName}</option>
                    ))}
                </select>
            </div>

            {currentInstrumentDef.showTuning && (
                <div className="control-group">
                    <label className="control-label">
                        <Guitar size={18} />
                        <span>Tuning</span>
                    </label>
                    <select
                        value={settings.tuningId}
                        onChange={handleTuningChange}
                        className="control-select"
                    >
                        {availableTunings.map(id => (
                            <option key={id} value={id}>{TUNINGS[id].name}</option>
                        ))}
                    </select>
                </div>
            )}

            <div className="control-group">
                <label className="control-label">
                    <Settings size={18} />
                    <span>Range</span>
                </label>
                <select
                    value={settings.difficulty}
                    onChange={handleDifficultyChange}
                    className="control-select"
                >
                    {currentInstrumentDef.ranges.map(r => (
                        <option key={r.id} value={r.id}>{r.label}</option>
                    ))}
                </select>
            </div>

            <div className="control-group">
                <label className="control-label">
                    <span>Key</span>
                </label>
                <select
                    value={settings.keySignature}
                    onChange={(e) => onUpdateSettings({ ...settings, keySignature: e.target.value })}
                    className="control-select"
                >
                    <optgroup label="Major Keys">
                        <option value="C">C Major</option>
                        <option value="G">G Major</option>
                        <option value="D">D Major</option>
                        <option value="A">A Major</option>
                        <option value="E">E Major</option>
                        <option value="F">F Major</option>
                        <option value="Bb">Bb Major</option>
                        <option value="Eb">Eb Major</option>
                    </optgroup>
                    <optgroup label="Minor Keys">
                        <option value="Am">A Minor</option>
                        <option value="Em">E Minor</option>
                        <option value="Dm">D Minor</option>
                    </optgroup>
                </select>
            </div>

            <div className="control-group" style={{ borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '12px', marginTop: '12px', width: '100%' }}>
                <label className="control-label" style={{ marginBottom: '8px' }}>
                    <span>Game Mode</span>
                </label>
                <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                        className={`control-button ${settings.gameMode === 'sight_reading' ? 'active' : ''}`}
                        onClick={() => onUpdateSettings({ ...settings, gameMode: 'sight_reading' })}
                        style={{ flex: 1 }}
                    >
                        Sight Reading
                    </button>
                    <button
                        className={`control-button ${settings.gameMode === 'ear_training' ? 'active' : ''}`}
                        onClick={() => onUpdateSettings({ ...settings, gameMode: 'ear_training' })}
                        style={{ flex: 1 }}
                    >
                        Ear Training
                    </button>
                </div>
            </div>

            {/* Rhythm Controls */}
            <div className="control-group rhythm-group" style={{ borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '12px', marginTop: '12px', width: '100%' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px', marginBottom: '8px' }}>
                    <label className="control-label" style={{ marginBottom: 0 }}>
                        <span>Metronome / Timer</span>
                    </label>
                    <button
                        className={`switch-button ${settings.rhythm.active ? 'active' : ''}`}
                        onClick={() => updateRhythm({ active: !settings.rhythm.active })}
                        title={settings.rhythm.active ? "Turn Off" : "Turn On"}
                    >
                        <div className="switch-thumb" />
                    </button>
                </div>

                {settings.rhythm.active && (
                    <div className="rhythm-details" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <div style={{ display: 'flex', gap: '8px' }}>
                            <button
                                className={`control-button small ${settings.rhythm.mode === 'bpm' ? 'active' : ''}`}
                                onClick={() => updateRhythm({ mode: 'bpm' })}
                            >BPM</button>
                            <button
                                className={`control-button small ${settings.rhythm.mode === 'seconds' ? 'active' : ''}`}
                                onClick={() => updateRhythm({ mode: 'seconds' })}
                            >Timer</button>
                        </div>

                        {settings.rhythm.mode === 'bpm' ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span style={{ fontSize: '12px', minWidth: '40px' }}>{settings.rhythm.bpm} BPM</span>
                                <input
                                    type="range"
                                    min="30"
                                    max="240"
                                    step="5"
                                    value={settings.rhythm.bpm}
                                    onChange={(e) => updateRhythm({ bpm: Number(e.target.value) })}
                                    style={{ flex: 1 }}
                                />
                            </div>
                        ) : (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span style={{ fontSize: '12px', minWidth: '40px' }}>{settings.rhythm.seconds}s</span>
                                <input
                                    type="range"
                                    min="1"
                                    max="60"
                                    step="1"
                                    value={settings.rhythm.seconds}
                                    onChange={(e) => updateRhythm({ seconds: Number(e.target.value) })}
                                    style={{ flex: 1 }}
                                />
                            </div>
                        )}

                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <label style={{ fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <input
                                    type="checkbox"
                                    checked={settings.rhythm.autoAdvance}
                                    onChange={(e) => updateRhythm({ autoAdvance: e.target.checked })}
                                />
                                Auto-Adv
                            </label>

                            <label style={{ fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <input
                                    type="checkbox"
                                    checked={settings.rhythm.sound}
                                    onChange={(e) => updateRhythm({ sound: e.target.checked })}
                                />
                                Sound
                            </label>
                        </div>
                    </div>
                )}
            </div>
            <div className="control-group" style={{ borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '12px', marginTop: '12px', width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label className="control-label" style={{ marginBottom: 0 }}>
                    <Gauge size={18} />
                    <span>Tuning Meter</span>
                </label>
                <button
                    className={`switch-button ${settings.showTuningMeter ? 'active' : ''}`}
                    onClick={() => onUpdateSettings({ ...settings, showTuningMeter: !settings.showTuningMeter })}
                    title={settings.showTuningMeter ? "Hide Tuner" : "Show Tuner"}
                >
                    <div className="switch-thumb" />
                </button>
            </div>


        </div>
    );
};

