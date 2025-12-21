import React from 'react';
import { Settings, HelpCircle, Guitar, Music } from 'lucide-react';
import { TUNINGS, INSTRUMENT_TUNINGS } from '../music/Tunings';
import { INSTRUMENT_DEFINITIONS } from '../music/InstrumentConfigs';

export type Difficulty = 'all' | 'first_pos' | 'open' | 'e_string';

export interface AppSettings {
    difficulty: Difficulty;
    showHint: boolean;
    tuningId: string;
    keySignature: string;
    instrument: string;
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
        // If instrument has tunings, pick first.
        let newTuningId = settings.tuningId;
        if (instDef.showTuning && INSTRUMENT_TUNINGS[newInstrumentId as 'guitar' | 'bass']) {
            newTuningId = INSTRUMENT_TUNINGS[newInstrumentId as 'guitar' | 'bass'][0];
        }

        onUpdateSettings({
            ...settings,
            instrument: newInstrumentId,
            difficulty: defaultRange as Difficulty, // flexible casting
            tuningId: newTuningId
        });
    };

    // Cast instrument to specific key if needed, or use generic record access
    const availableTunings = INSTRUMENT_TUNINGS[settings.instrument as 'guitar' | 'bass'] || [];
    const currentInstrumentDef = INSTRUMENT_DEFINITIONS[settings.instrument];

    const toggleHint = () => {
        onUpdateSettings({ ...settings, showHint: !settings.showHint });
    };

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
                    <span>Key Signature</span>
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

            <button
                className={`control-button ${settings.showHint ? 'active' : ''}`}
                onClick={toggleHint}
                title="Show Hint"
            >
                <HelpCircle size={20} />
            </button>
        </div>
    );
};

