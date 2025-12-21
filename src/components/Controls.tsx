import React from 'react';
import { Settings, HelpCircle, Guitar } from 'lucide-react';
import { TUNINGS } from '../music/Tunings';

export type Difficulty = 'all' | 'first_pos' | 'open' | 'e_string';

export interface AppSettings {
    difficulty: Difficulty;
    showHint: boolean;
    tuningId: string;
    keySignature: string;
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

    const toggleHint = () => {
        onUpdateSettings({ ...settings, showHint: !settings.showHint });
    };

    return (
        <div className="controls-container">
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
                    {Object.entries(TUNINGS).map(([id, tuning]) => (
                        <option key={id} value={id}>{tuning.name}</option>
                    ))}
                </select>
            </div>

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
                    <option value="open">Open Strings (Beginner)</option>
                    <option value="first_pos">First Position</option>
                    <option value="e_string">E String Only</option>
                    <option value="all">All Notes</option>
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

