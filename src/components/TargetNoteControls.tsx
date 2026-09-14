/**
 * Unified target-note controls, shared by all game modes (v2 controls).
 *
 * - Key filter: restrict target notes to a tonic+mode (independent of the
 *   displayed key signature on the staff).
 * - Fret window: restrict target notes to a fret range (fretted instruments).
 *
 * In Phrase Mode the same controls bind to the shared practice filter
 * (mirrored into phrase settings), so state stays consistent across modes.
 */
import { useMemo } from 'react';
import { Key, Guitar } from 'lucide-react';
import { useSettings } from '../context/useSettings';
import { getPracticeFilter, type PracticeFilter } from '../types/SettingsTypes';
import { MODE_LABELS, TONICS, isMode, type ModeId } from '../music/scales';
import { isFrettedInstrument } from '../music/playableRange';
import { TUNINGS } from '../music/Tunings';

export const TargetNoteControls: React.FC = () => {
    const { settings, updateSettings } = useSettings();
    const pf = getPracticeFilter(settings);

    const setFilter = (updates: Partial<PracticeFilter>) => {
        updateSettings(s => ({ ...s, practice: { ...getPracticeFilter(s), ...updates } }));
    };

    const fretted = useMemo(
        () => isFrettedInstrument(settings.instrument) && !!TUNINGS[settings.tuningId],
        [settings.instrument, settings.tuningId],
    );

    return (
        <div className="practice-filter-grid">
            {/* Key filter */}
            <div className="control-group" style={{ gridColumn: '1 / -1' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <label className="control-label">
                        <Key size={18} />
                        <span>Target key (limits notes)</span>
                    </label>
                    <button
                        className={`switch-button ${pf.keyEnabled ? 'active' : ''}`}
                        onClick={() => setFilter({ keyEnabled: !pf.keyEnabled })}
                        title={pf.keyEnabled ? 'Limit to key: on' : 'Limit to key: off'}
                    >
                        <div className="switch-thumb" />
                    </button>
                </div>
                {pf.keyEnabled && (
                    <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                        <select
                            className="control-select"
                            value={pf.keyTonic}
                            onChange={e => setFilter({ keyTonic: e.target.value })}
                            aria-label="Target key tonic"
                        >
                            {Object.keys(TONICS).filter(t => !['C#', 'Gb', 'D#', 'G#', 'A#'].includes(t)).map(t => (
                                <option key={t} value={t}>{t}</option>
                            ))}
                        </select>
                        <select
                            className="control-select"
                            value={pf.keyMode}
                            onChange={e => setFilter({ keyMode: isMode(e.target.value) ? e.target.value : 'major' })}
                            aria-label="Target key mode"
                        >
                            {(Object.keys(MODE_LABELS) as ModeId[]).map(m => (
                                <option key={m} value={m}>{MODE_LABELS[m]}</option>
                            ))}
                        </select>
                    </div>
                )}
            </div>

            {/* Fret window */}
            {fretted && (
                <div className="control-group" style={{ gridColumn: '1 / -1' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <label className="control-label">
                            <Guitar size={18} />
                            <span>Fret window (limits notes)</span>
                        </label>
                        <button
                            className={`switch-button ${pf.fretWindowEnabled ? 'active' : ''}`}
                            onClick={() => setFilter({ fretWindowEnabled: !pf.fretWindowEnabled })}
                            title={pf.fretWindowEnabled ? 'Fret window: on' : 'Fret window: off'}
                        >
                            <div className="switch-thumb" />
                        </button>
                    </div>
                    {pf.fretWindowEnabled && (
                        <div style={{ display: 'flex', gap: '8px', marginTop: '8px', alignItems: 'center' }}>
                            <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <span style={{ fontSize: '12px', opacity: 0.7 }}>Min</span>
                                <input
                                    type="number" min={0} max={24}
                                    className="control-input"
                                    style={{ width: '100%', padding: '4px' }}
                                    value={pf.fretMin}
                                    onChange={e => setFilter({ fretMin: Math.max(0, Math.min(24, parseInt(e.target.value) || 0)) })}
                                />
                            </div>
                            <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <span style={{ fontSize: '12px', opacity: 0.7 }}>Max</span>
                                <input
                                    type="number" min={0} max={24}
                                    className="control-input"
                                    style={{ width: '100%', padding: '4px' }}
                                    value={pf.fretMax}
                                    onChange={e => setFilter({ fretMax: Math.max(pf.fretMin, Math.min(24, parseInt(e.target.value) || 0)) })}
                                />
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};
