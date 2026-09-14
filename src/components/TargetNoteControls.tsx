/**
 * Unified target-note controls, shared by all game modes (v2 controls).
 *
 * - Key filter: restrict target notes to a tonic+mode (independent of the
 *   displayed key signature on the staff — optional sync checkbox).
 * - Strings: pick which strings contribute target notes (fretted instruments).
 * - Fret window: restrict target notes to a fret range (fretted instruments).
 *
 * In Phrase Mode the same controls bind to the shared practice filter
 * (mirrored into phrase settings), so state stays consistent across modes.
 */
import { useMemo } from 'react';
import { Key, Guitar, Music, SlidersHorizontal } from 'lucide-react';
import { useSettings } from '../context/useSettings';
import { getPracticeFilter, type PracticeFilter } from '../types/SettingsTypes';
import { MODE_LABELS, TONICS, isMode, keyFor, type ModeId } from '../music/scales';
import { isFrettedInstrument } from '../music/playableRange';
import { TUNINGS } from '../music/Tunings';

/** Conventional string names, low→high, for guitar/bass tunings. */
const GUITAR_STRING_NAMES = ['E6', 'A5', 'D4', 'G3', 'B2', 'E1'];
const BASS_STRING_NAMES = ['E4', 'A3', 'D2', 'G1'];

function stringNames(tuningId: string, count: number): string[] {
    const names = tuningId.startsWith('bass') ? BASS_STRING_NAMES : GUITAR_STRING_NAMES;
    // Align from the low end (index 0 = lowest)
    if (count === names.length) return names;
    return Array.from({ length: count }, (_, i) => {
        const midi = TUNINGS[tuningId]?.strings[i] ?? 0;
        const pc = midi % 12;
        const LETTERS = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
        return LETTERS[pc] ?? `S${i + 1}`;
    });
}

/** Display key signature names that correspond to a tonic+mode pair. */
const MAJOR_TONIC_TO_SIGNATURE: Record<string, string> = {
    'C': 'C', 'G': 'G', 'D': 'D', 'A': 'A', 'E': 'E', 'B': 'C#', 'F#': 'C#',
    'Db': 'Db', 'Ab': 'Ab', 'Eb': 'Eb', 'Bb': 'Bb', 'F': 'F',
};
const MINOR_TONIC_TO_SIGNATURE: Record<string, string> = {
    'C': 'Eb', 'G': 'Bb', 'D': 'F', 'A': 'C', 'E': 'G', 'B': 'D', 'F#': 'A',
    'Db': 'Eb', 'Ab': 'Bb', 'Eb': 'Gb', 'Bb': 'Db', 'F': 'Dm',
};

export const TargetNoteControls: React.FC = () => {
    const { settings, updateSettings } = useSettings();
    const pf = getPracticeFilter(settings);

    const setFilter = (updates: Partial<PracticeFilter>) => {
        updateSettings(s => {
            const next: typeof s = { ...s, practice: { ...getPracticeFilter(s), ...updates } };
            // Optional coupling: display key signature follows the target key.
            if (updates.keyTonic !== undefined || updates.keyMode !== undefined) {
                const tonic = updates.keyTonic ?? pf.keyTonic;
                const mode = updates.keyMode ?? pf.keyMode;
                if (s.keyFollowsTarget) {
                    const table = mode === 'minor' ? MINOR_TONIC_TO_SIGNATURE : MAJOR_TONIC_TO_SIGNATURE;
                    const sig = table[tonic];
                    if (sig) next.keySignature = sig;
                }
            }
            return next;
        });
    };

    const fretted = useMemo(
        () => isFrettedInstrument(settings.instrument) && !!TUNINGS[settings.tuningId],
        [settings.instrument, settings.tuningId],
    );

    const stringCount = TUNINGS[settings.tuningId]?.strings.length ?? 0;
    const names = stringNames(settings.tuningId, stringCount);

    const toggleString = (index: number) => {
        const cur = pf.strings.length > 0 ? [...pf.strings] : Array.from({ length: stringCount }, (_, i) => i);
        const next = cur.includes(index) ? cur.filter(i => i !== index) : [...cur, index].sort((a, b) => a - b);
        // Deselecting all = back to "all strings" (empty array)
        setFilter({ strings: next.length === stringCount ? [] : next });
    };

    const allSelected = pf.strings.length === 0;

    const anyActive = pf.keyEnabled || pf.fretWindowEnabled || pf.strings.length > 0;
    return (
        <div className="practice-filter-grid" style={{ display: 'flex', flexDirection: 'column', gap: '8px', border: '1px solid rgba(128,128,128,0.2)', padding: '12px', borderRadius: '8px', gridColumn: '1 / -1' }}>
            {/* Section header: unified with Tuner/Metronome style */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <label className="control-label" style={{ marginBottom: 0 }}>
                    <SlidersHorizontal size={18} />
                    <span>Limit notes</span>
                </label>
                {anyActive && (
                    <button
                        className="link-button"
                        style={{ fontSize: '11px', padding: 0 }}
                        onClick={() => setFilter({ keyEnabled: false, fretWindowEnabled: false, strings: [] })}
                    >
                        Clear all
                    </button>
                )}
            </div>

            {/* Key filter */}
            <div className="control-group">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <label className="control-label">
                        <Key size={18} />
                        <span>Key</span>
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
                    <>
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
                        <label style={{ fontSize: '11px', display: 'flex', alignItems: 'center', gap: '6px', marginTop: '6px', opacity: 0.85 }}>
                            <input
                                type="checkbox"
                                checked={settings.keyFollowsTarget ?? false}
                                onChange={e => updateSettings(s => {
                                    const next = { ...s, keyFollowsTarget: e.target.checked };
                                    // When enabling sync, snap the display signature now.
                                    if (e.target.checked) {
                                        const table = pf.keyMode === 'minor' ? MINOR_TONIC_TO_SIGNATURE : MAJOR_TONIC_TO_SIGNATURE;
                                        const sig = table[pf.keyTonic];
                                        if (sig) next.keySignature = sig;
                                    }
                                    return next;
                                })}
                            />
                            Sync display key signature with target key
                        </label>
                    </>
                )}
            </div>

            {/* Strings (fretted instruments) */}
            {fretted && (
                <div className="control-group" style={{ gridColumn: '1 / -1' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <label className="control-label">
                            <Guitar size={18} />
                            <span>Strings</span>
                        </label>
                        <button
                            className={`switch-button ${!allSelected ? 'active' : ''}`}
                            onClick={() => setFilter({ strings: allSelected ? [0] : [] })}
                            title={allSelected ? 'All strings — toggle on to restrict' : 'Restrict to selected strings'}
                        >
                            <div className="switch-thumb" />
                        </button>
                    </div>
                    {!allSelected && <div style={{ display: 'flex', gap: '6px', marginTop: '8px', flexWrap: 'wrap' }}>
                        {Array.from({ length: stringCount }, (_, i) => {
                            const active = allSelected || pf.strings.includes(i);
                            return (
                                <button
                                    key={i}
                                    className={`control-button small ${active ? 'active' : ''}`}
                                    onClick={() => toggleString(i)}
                                    title={`String ${i + 1} (${names[i]})`}
                                    style={{ flex: '1 1 0', minWidth: '40px', padding: '6px 4px', fontSize: '11px' }}
                                >
                                    {names[i]}
                                </button>
                            );
                        })}
                    </div>}
                    {pf.strings.length > 0 && (
                        <button
                            className="link-button"
                            style={{ fontSize: '11px', marginTop: '6px', padding: 0 }}
                            onClick={() => setFilter({ strings: [] })}
                        >
                            Reset to all strings
                        </button>
                    )}
                </div>
            )}

            {/* Fret window (fretted instruments) */}
            {fretted && (
                <div className="control-group" style={{ gridColumn: '1 / -1' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <label className="control-label">
                            <Music size={18} />
                            <span>Fret window</span>
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

// Re-export keyFor for potential external use (avoids unused-import lint)
void keyFor;
