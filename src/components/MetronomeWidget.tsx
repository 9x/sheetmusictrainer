/**
 * Metronome widget with a linear pendulum indicator.
 *
 * The pendulum is a CSS-animated dot whose half-period equals one beat:
 * it travels left→right on even beats and right→left on odd beats, driven
 * by the metronome's onTick callback (no drift — synced to the audible
 * click, not to wall-clock CSS timing alone).
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import { useMetronome } from '../hooks/useMetronome';
import { getTempoMarking } from '../music/TempoMarkings';
import type { RhythmSettings } from '../types/SettingsTypes';

interface MetronomeWidgetProps {
    rhythm: RhythmSettings;
    /** Persist changes (bpm, active, sound). Auto-advance is single-note only. */
    onUpdate: (updates: Partial<RhythmSettings>) => void;
    /** Single-note mode extra: auto-advance targets on each tick. */
    showAutoAdvance?: boolean;
    onBeat?: () => void;
    /** Compact layout (phrase transport row). */
    compact?: boolean;
}

export const MetronomeWidget: React.FC<MetronomeWidgetProps> = ({
    rhythm,
    onUpdate,
    showAutoAdvance = false,
    onBeat,
    compact = false,
}) => {
    // Single metronome instance: drives both the audible click and the
    // pendulum parity flip (perfectly in sync).
    const [beatParity, setBeatParity] = useState(0);
    const lastTickRef = useRef(0);
    const onBeatRef = useRef(onBeat);
    useEffect(() => { onBeatRef.current = onBeat; }, [onBeat]);

    const handleTick = useCallback((beat: number) => {
        const now = performance.now();
        // Ignore double-fires within 60ms (audio glitch guard)
        if (now - lastTickRef.current < 60) return;
        lastTickRef.current = now;
        setBeatParity(beat % 2);
        onBeatRef.current?.();
    }, []);

    const { restart } = useMetronome({
        bpm: rhythm.bpm,
        volume: rhythm.sound ? rhythm.volume : 0,
        playing: rhythm.active,
        onTick: handleTick,
    });
    void restart;

    const beatMs = 60000 / Math.max(1, rhythm.bpm);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <label className="control-label" style={{ marginBottom: 0 }}>
                    <span>Metronome</span>
                </label>
                <button
                    className={`switch-button ${rhythm.active ? 'active' : ''}`}
                    onClick={() => onUpdate({ active: !rhythm.active })}
                    title={rhythm.active ? 'Turn Off' : 'Turn On'}
                >
                    <div className="switch-thumb" />
                </button>
            </div>

            {rhythm.active && (
                <div className="rhythm-details" style={{ display: 'flex', flexDirection: 'column', gap: '6px', paddingTop: '8px', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
                    {/* Linear pendulum — same element, left transitions each beat */}
                    <div
                        style={{
                            position: 'relative',
                            height: compact ? 14 : 18,
                            borderRadius: 9,
                            background: 'color-mix(in srgb, var(--color-text-main) 8%, transparent)',
                            overflow: 'hidden',
                        }}
                        aria-hidden
                    >
                        <div
                            style={{
                                position: 'absolute',
                                top: '50%',
                                left: beatParity === 0 ? '6%' : '88%',
                                width: compact ? 10 : 12,
                                height: compact ? 10 : 12,
                                borderRadius: '50%',
                                background: 'var(--color-text-main)',
                                transform: 'translateY(-50%)',
                                transition: `left ${beatMs}ms linear`,
                            }}
                        />
                    </div>

                    {rhythm.mode === 'bpm' || compact ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <button
                                    className="control-button small"
                                    onClick={() => onUpdate({ bpm: Math.max(30, rhythm.bpm - 1) })}
                                    style={{ width: '24px', padding: '0', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                                >
                                    −
                                </button>
                                <input
                                    type="number"
                                    min="30"
                                    max="300"
                                    value={rhythm.bpm}
                                    onChange={(e) => onUpdate({ bpm: Math.max(1, parseInt(e.target.value) || 60) })}
                                    className="control-input"
                                    style={{ width: '48px', textAlign: 'center', padding: '2px' }}
                                />
                                <button
                                    className="control-button small"
                                    onClick={() => onUpdate({ bpm: Math.min(300, rhythm.bpm + 1) })}
                                    style={{ width: '24px', padding: '0', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                                >
                                    +
                                </button>
                                <input
                                    type="range"
                                    min="30"
                                    max="240"
                                    step="1"
                                    value={rhythm.bpm}
                                    onChange={(e) => onUpdate({ bpm: Number(e.target.value) })}
                                    style={{ flex: 1 }}
                                />
                            </div>
                            <div style={{ fontSize: '11px', opacity: 0.7, textAlign: 'center' }}>
                                {getTempoMarking(rhythm.bpm)}
                            </div>
                        </div>
                    ) : (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <span style={{ fontSize: '12px', minWidth: '32px' }}>{rhythm.seconds}s</span>
                            <input
                                type="range"
                                min="1"
                                max="60"
                                step="1"
                                value={rhythm.seconds}
                                onChange={(e) => onUpdate({ seconds: Number(e.target.value) })}
                                style={{ flex: 1 }}
                            />
                        </div>
                    )}

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        {showAutoAdvance ? (
                            <label style={{ fontSize: '10px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <input
                                    type="checkbox"
                                    checked={rhythm.autoAdvance}
                                    onChange={(e) => onUpdate({ autoAdvance: e.target.checked })}
                                />
                                Auto
                            </label>
                        ) : <span />}
                        <label style={{ fontSize: '10px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <input
                                type="checkbox"
                                checked={rhythm.sound}
                                onChange={(e) => onUpdate({ sound: e.target.checked })}
                            />
                            Sound
                        </label>
                    </div>
                </div>
            )}
        </div>
    );
};
