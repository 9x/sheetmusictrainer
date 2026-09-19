import React, { useEffect, useState } from 'react';
import { Gauge, SlidersHorizontal } from 'lucide-react';
import { TuningMeter } from './TuningMeter';
import { TargetNoteControls } from './TargetNoteControls';
import { MetronomeWidget } from './MetronomeWidget';
import { phraseRunBus } from '../hooks/phraseRunBus';
import { useSettings } from '../context/useSettings';
import { getPracticeFilter, type RhythmSettings } from '../types/SettingsTypes';



interface ControlsProps {
    currentPitch: { note: string; cents: number } | null;
}

export const Controls: React.FC<ControlsProps> = ({ currentPitch }) => {
    const { settings, updateSettings } = useSettings();
    const onUpdateSettings = updateSettings;
    // Phrase run gate: the metronome only ticks while the phrase trainer is
    // counting in / playing (armed by the user toggle, fired by the run).
    const [phraseRunActive, setPhraseRunActive] = useState(false);
    useEffect(() => phraseRunBus.subscribe(setPhraseRunActive), []);
    // Note-filter panel: hidden by default (minimal UI), toggled here.
    const [filtersOpen, setFiltersOpen] = useState(false);

    const updateRhythm = (updates: Partial<RhythmSettings>) => {
        onUpdateSettings({
            ...settings,
            rhythm: { ...settings.rhythm, ...updates }
        });
    };

    const inPhraseMode = settings.gameMode === 'phrase';

    const pf = getPracticeFilter(settings);
    const activeFilterCount =
        (pf.keyEnabled ? 1 : 0) +
        (pf.strings.length > 0 ? 1 : 0) +
        (pf.fretWindowEnabled ? 1 : 0);

    // Phrase Mode hosts the filter inside its Setup panel (above the
    // notation) — no footer filter button there.
    const showFilterButton = !inPhraseMode;
    const shouldShowFilters = showFilterButton && filtersOpen;

    return (
        <div className="controls-container">
            {/* Note filter: collapsed behind a button — visible only when needed */}
            {showFilterButton && (
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '8px' }}>
                <button
                    className={`hint-button ${filtersOpen ? 'active' : ''}`}
                    onClick={() => setFiltersOpen(o => !o)}
                    title="Limit the notes used for exercises (key, strings, fret window)"
                >
                    <SlidersHorizontal size={16} />
                    Filter
                    {activeFilterCount > 0 && (
                        <span style={{
                            display: 'inline-block', minWidth: '18px', padding: '1px 5px',
                            marginLeft: '4px', borderRadius: '9px', fontSize: '11px',
                            background: 'var(--color-primary)', color: 'var(--color-surface)',
                            fontWeight: 600, textAlign: 'center'
                        }}>{activeFilterCount}</span>
                    )}
                </button>
            </div>
            )}
            {shouldShowFilters && <TargetNoteControls />}

            {/* Bottom Section: Tools Grid (stacked in all modes) */}
            <div className="tools-grid" style={{ gridTemplateColumns: '1fr' }}>
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
                    {settings.showTuningMeter && (
                        <div style={{ paddingTop: '8px', borderTop: '1px solid color-mix(in srgb, var(--color-text-main) 10%, transparent)' }}>
                            <TuningMeter
                                cents={currentPitch ? currentPitch.cents : null}
                                noteName={currentPitch ? currentPitch.note : null}
                            />
                        </div>
                    )}
                </div>

                {/* Tool 2: Metronome (all modes) */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', border: '1px solid rgba(128,128,128,0.2)', padding: '12px', borderRadius: '8px' }}>
                    <MetronomeWidget
                        rhythm={settings.rhythm}
                        onUpdate={updateRhythm}
                        showAutoAdvance={!inPhraseMode}
                        syncMode={inPhraseMode ? 'option' : null}
                        gate={inPhraseMode ? phraseRunActive : null}
                    />
                </div>

            </div>
        </div>
    );
};

