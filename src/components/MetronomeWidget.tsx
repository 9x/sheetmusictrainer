/**
 * Metronome widget — always-visible tempo controls + pendulum.
 *
 * Modes:
 * - Plain (single-note modes): one on/off toggle arms sound + animation.
 * - Sync option (Phrase Mode): the toggle switches between
 *     * FREE — the metronome runs independently (own clock, starts as soon
 *       as toggled, with or without clicks per the sound checkbox)
 *     * SYNC — the metronome starts with the exercise (count-in included),
 *       is silent while idle, and its pendulum mirrors the run's beats.
 *
 * Exactly ONE sound checkbox exists (here). In sync mode it governs the
 * run's click scheduler too — clicks can never double.
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import { useMetronome } from '../hooks/useMetronome';
import { getTempoMarking } from '../music/TempoMarkings';
import { phraseBeatBus } from '../hooks/phraseBeatBus';
import { audioEngine } from '../audio/AudioEngine';
import type { RhythmSettings } from '../types/SettingsTypes';

interface MetronomeWidgetProps {
    rhythm: RhythmSettings;
    /** Persist changes. */
    onUpdate: (updates: Partial<RhythmSettings>) => void;
    /** Single-note mode extra: auto-advance targets on each tick. */
    showAutoAdvance?: boolean;
    /** Compact layout (phrase transport row). */
    compact?: boolean;
    /** 'option': show the sync/free toggle (Phrase Mode). null: plain on/off. */
    syncMode?: 'option' | null;
    /** External gate (sync mode): true while the exercise runs. */
    gate?: boolean | null;
}

export const MetronomeWidget: React.FC<MetronomeWidgetProps> = ({
    rhythm,
    onUpdate,
    showAutoAdvance = false,
    compact = false,
    syncMode = null,
    gate = null,
}) => {
    const [beatParity, setBeatParity] = useState(0);
    const lastTickRef = useRef(0);
    const handleTick = useCallback((beat: number) => {
        const now = performance.now();
        if (now - lastTickRef.current < 60) return; // glitch guard
        lastTickRef.current = now;
        setBeatParity(beat % 2);
    }, []);

    const isSync = syncMode === 'option' && !!rhythm.syncToExercise;
    const runActive = gate === true;
    // Sync: pendulum/click only while the run is active (the run's scheduler
    // is the click source; the widget's own scheduler stays off).
    // Free/plain: the widget's own scheduler runs whenever armed.
    const running = isSync ? runActive : rhythm.active;

    const { restart } = useMetronome({
        bpm: rhythm.bpm,
        volume: rhythm.sound ? rhythm.volume : 0,
        playing: running && !isSync,
        onTick: handleTick,
    });
    void restart;

    // Sync: pendulum mirrors the phrase run's beats (audio-time scheduled).
    useEffect(() => {
        if (!isSync || !runActive) return;
        return phraseBeatBus.subscribe((_beat, at) => {
            const delay = Math.max(0, (at - audioEngine.now()) * 1000);
            window.setTimeout(() => setBeatParity(p => (p + 1) % 2), delay);
        });
    }, [isSync, runActive]);

    const beatMs = 60000 / Math.max(1, rhythm.bpm);
    const armed = rhythm.active;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {/* Header: label + mode toggle */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <label className="control-label" style={{ marginBottom: 0 }}>
                    <span>Metronome</span>
                </label>
                {syncMode === 'option' ? (
                    <button
                        className={`switch-button ${rhythm.syncToExercise ? 'active' : ''}`}
                        onClick={() => onUpdate({
                            syncToExercise: !rhythm.syncToExercise,
                            active: true, // armed in either mode; the mode decides behavior
                        })}
                        title={rhythm.syncToExercise
                            ? 'Sync: starts with the exercise (count-in). Click while idle: off.'
                            : 'Free: runs independently — start/stop it yourself.'}
                    >
                        <div className="switch-thumb" />
                    </button>
                ) : (
                    <button
                        className={`switch-button ${rhythm.active ? 'active' : ''}`}
                        onClick={() => onUpdate({ active: !rhythm.active })}
                        title={rhythm.active ? 'Turn Off' : 'Turn On (sound + pendulum)'}
                    >
                        <div className="switch-thumb" />
                    </button>
                )}
            </div>

            {/* Always visible body; dimmed when disarmed */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', paddingTop: '8px', borderTop: '1px solid rgba(255,255,255,0.1)', opacity: armed ? 1 : 0.5 }}>
                {/* Pendulum */}
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
                            display: armed && running ? 'block' : 'none',
                        }}
                    />
                </div>

                {/* BPM / Timer controls */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    {!compact && (
                        <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
                            <button
                                className={`control-button small ${rhythm.mode === 'bpm' ? 'active' : ''}`}
                                onClick={() => onUpdate({ mode: 'bpm' })}
                                style={{ fontSize: '10px' }}
                            >BPM</button>
                            <button
                                className={`control-button small ${rhythm.mode === 'seconds' ? 'active' : ''}`}
                                onClick={() => onUpdate({ mode: 'seconds' })}
                                style={{ fontSize: '10px' }}
                            >Timer</button>
                        </div>
                    )}
                    {rhythm.mode === 'bpm' ? (
                        <>
                            <button
                                className="control-button small"
                                onClick={() => onUpdate({ bpm: Math.max(30, rhythm.bpm - 1) })}
                                style={{ width: '24px', padding: '0', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                            >−</button>
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
                            >+</button>
                            <input
                                type="range"
                                min="30"
                                max="240"
                                step="1"
                                value={rhythm.bpm}
                                onChange={(e) => onUpdate({ bpm: Number(e.target.value) })}
                                style={{ flex: 1 }}
                            />
                        </>
                    ) : (
                        <>
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
                        </>
                    )}
                </div>
                {rhythm.mode === 'bpm' && (
                    <div style={{ fontSize: '11px', opacity: 0.7, textAlign: 'center' }}>
                        {getTempoMarking(rhythm.bpm)}
                    </div>
                )}

                {/* Options row */}
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
                        Click sound
                    </label>
                </div>
            </div>
        </div>
    );
};
