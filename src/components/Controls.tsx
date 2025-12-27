import { Settings, Guitar, Music, Gauge } from 'lucide-react';
import { TUNINGS, INSTRUMENT_TUNINGS } from '../music/Tunings';
import { INSTRUMENT_DEFINITIONS } from '../music/InstrumentConfigs';
import { getTempoMarking } from '../music/TempoMarkings';
import { TuningMeter } from './TuningMeter';

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
    tuningId: string;
    keySignature: string;
    instrument: string;
    showTuningMeter: boolean;
    rhythm: RhythmSettings;
    zenMode: boolean;
    gameMode: 'sight_reading' | 'ear_training';
    customMinFret?: number;
    customMaxFret?: number;
    autoPlaySightReading?: boolean;
    autoPlayVolume?: number;
    disableAnimation?: boolean;
}

interface ControlsProps {
    settings: AppSettings;
    onUpdateSettings: (s: AppSettings) => void;
    currentPitch: { note: string; cents: number } | null;
}

export const Controls: React.FC<ControlsProps> = ({ settings, onUpdateSettings, currentPitch }) => {
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
            {/* Top Section: Settings Grid (2 Columns) */}
            <div className="settings-grid">
                {/* Row 1, Col 1 */}
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

                {/* Row 1, Col 2 (Conditional) */}
                {currentInstrumentDef.showTuning ? (
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
                ) : <div />} {/* Spacer to maintain grid flow if needed, or omit to let items flow. User asked for specific rows. 
                             If I omit, Note Set goes here. Let's omit for "Dense" feel, or keep empty div for strict rows? 
                             The request "Top row: instrument and tuning" implies if tuning is missing, maybe just 1 item? 
                             I'll output an empty div if I want to FORCE strict placement, but generally flow is better. 
                             However, "Second row: note set..." suggests structure. 
                             I will use an empty div if tuning is hidden to push Note Set to next row? 
                             Actually, grid-template-columns: 1fr 1fr. 
                             If Tuning is hidden, Note Set becomes Item 2. 
                             I'll forgo complexity and just render what's available. */}

                {/* Row 2, Col 1 */}
                <div className="control-group">
                    <label className="control-label">
                        <Settings size={18} />
                        <span>Note Set</span>
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

                {/* Row 2, Col 2 */}
                <div className="control-group">
                    <label className="control-label">
                        <span>Key signature</span>
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

                {/* Row 3: Fret Range (Full Width) */}
                {currentInstrumentDef.ranges.find(r => r.id === settings.difficulty)?.type === 'custom_fret' && (
                    <div className="control-group" style={{ gridColumn: '1 / -1' }}>
                        <label className="control-label">
                            <span>Fret Range</span>
                        </label>
                        <div style={{ display: 'flex', gap: '8px', width: '100%' }}>
                            <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <span style={{ fontSize: '12px', opacity: 0.7 }}>Min</span>
                                <input
                                    type="number"
                                    min="0"
                                    max="24"
                                    value={settings.customMinFret ?? 0}
                                    onChange={(e) => onUpdateSettings({ ...settings, customMinFret: parseInt(e.target.value) || 0 })}
                                    className="control-input"
                                    style={{ width: '100%', padding: '4px', borderRadius: '4px', border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(0,0,0,0.2)', color: 'white' }}
                                />
                            </div>
                            <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <span style={{ fontSize: '12px', opacity: 0.7 }}>Max</span>
                                <input
                                    type="number"
                                    min="0"
                                    max="24"
                                    value={settings.customMaxFret ?? 12}
                                    onChange={(e) => onUpdateSettings({ ...settings, customMaxFret: parseInt(e.target.value) || 0 })}
                                    className="control-input"
                                    style={{ width: '100%', padding: '4px', borderRadius: '4px', border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(0,0,0,0.2)', color: 'white' }}
                                />
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Bottom Section: Tools Grid (2 Columns now) */}
            <div className="tools-grid">
                {/* Tool 1: Tuner */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', border: '1px solid rgba(128,128,128,0.2)', padding: '12px', borderRadius: '8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <label className="control-label" style={{ marginBottom: 0 }}>
                            <Gauge size={18} />
                            <span>Tuner</span>
                        </label>
                        <button
                            className={`switch-button ${settings.showTuningMeter ? 'active' : ''}`}
                            onClick={() => onUpdateSettings({ ...settings, showTuningMeter: !settings.showTuningMeter })}
                            title={settings.showTuningMeter ? "Hide Tuner" : "Show Tuner"}
                        >
                            <div className="switch-thumb" />
                        </button>
                    </div>
                    {settings.showTuningMeter && currentPitch && (
                        <div style={{ paddingTop: '8px', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
                            <TuningMeter cents={currentPitch.cents} noteName={currentPitch.note} />
                        </div>
                    )}
                    {settings.showTuningMeter && !currentPitch && (
                        <div style={{ paddingTop: '8px', borderTop: '1px solid rgba(255,255,255,0.1)', fontSize: '11px', opacity: 0.5, textAlign: 'center' }}>
                            Listening...
                        </div>
                    )}
                </div>

                {/* Tool 2: Metronome */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', border: '1px solid rgba(128,128,128,0.2)', padding: '12px', borderRadius: '8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <label className="control-label" style={{ marginBottom: 0 }}>
                            <span>Metronome</span>
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
                        <div className="rhythm-details" style={{ display: 'flex', flexDirection: 'column', gap: '6px', paddingTop: '8px', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
                            <div style={{ display: 'flex', gap: '4px' }}>
                                <button
                                    className={`control-button small ${settings.rhythm.mode === 'bpm' ? 'active' : ''}`}
                                    onClick={() => updateRhythm({ mode: 'bpm' })}
                                    style={{ flex: 1, fontSize: '10px' }}
                                >BPM</button>
                                <button
                                    className={`control-button small ${settings.rhythm.mode === 'seconds' ? 'active' : ''}`}
                                    onClick={() => updateRhythm({ mode: 'seconds' })}
                                    style={{ flex: 1, fontSize: '10px' }}
                                >Timer</button>
                            </div>

                            {settings.rhythm.mode === 'bpm' ? (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                        <button
                                            className="control-button small"
                                            onClick={() => updateRhythm({ bpm: Math.max(30, settings.rhythm.bpm - 1) })}
                                            style={{ width: '24px', padding: '0', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                                        >
                                            -
                                        </button>
                                        <input
                                            type="number"
                                            min="30"
                                            max="300"
                                            value={settings.rhythm.bpm}
                                            onChange={(e) => updateRhythm({ bpm: Math.max(1, parseInt(e.target.value) || 60) })}
                                            className="control-input"
                                            style={{
                                                width: '48px',
                                                textAlign: 'center',
                                                padding: '2px',
                                                borderRadius: '4px',
                                                border: '1px solid rgba(255,255,255,0.2)',
                                                background: 'rgba(0,0,0,0.2)',
                                                color: 'white'
                                            }}
                                        />
                                        <button
                                            className="control-button small"
                                            onClick={() => updateRhythm({ bpm: Math.min(300, settings.rhythm.bpm + 1) })}
                                            style={{ width: '24px', padding: '0', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                                        >
                                            +
                                        </button>
                                        <input
                                            type="range"
                                            min="30"
                                            max="240"
                                            step="1"
                                            value={settings.rhythm.bpm}
                                            onChange={(e) => updateRhythm({ bpm: Number(e.target.value) })}
                                            style={{ flex: 1 }}
                                        />
                                    </div>
                                    <div style={{ fontSize: '11px', opacity: 0.7, textAlign: 'center' }}>
                                        {getTempoMarking(settings.rhythm.bpm)}
                                    </div>
                                </div>
                            ) : (
                                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                    <span style={{ fontSize: '12px', minWidth: '32px' }}>{settings.rhythm.seconds}s</span>
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
                                <label style={{ fontSize: '10px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                    <input
                                        type="checkbox"
                                        checked={settings.rhythm.autoAdvance}
                                        onChange={(e) => updateRhythm({ autoAdvance: e.target.checked })}
                                    />
                                    Auto
                                </label>

                                <label style={{ fontSize: '10px', display: 'flex', alignItems: 'center', gap: '4px' }}>
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

                {/* Tool 3: Auto-play */}

            </div>
        </div>
    );
};

