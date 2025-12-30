import React, { useState } from 'react';
import { X, Volume2, VolumeX, ChevronDown, ChevronUp, Mic, MicOff } from 'lucide-react';
import type { AppSettings } from './Controls';
import type { MicrophoneDebugInfo } from '../hooks/usePitchDetector';

interface SettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
    settings: AppSettings;
    onUpdateSettings: (s: AppSettings) => void;
    audioLevel?: number;
    debugInfo?: MicrophoneDebugInfo | null;
    isListening?: boolean;
    onMicToggle?: () => void;
}

// Level meter component
const LevelMeter: React.FC<{ level: number; isActive: boolean }> = ({ level, isActive }) => {
    // Convert RMS to dB for display, then normalize to 0-100%
    // RMS of 0.001 = -60dB, RMS of 1.0 = 0dB
    const db = level > 0 ? 20 * Math.log10(level) : -100;
    // Map -60dB to 0dB => 0% to 100%
    const percentage = Math.max(0, Math.min(100, ((db + 60) / 60) * 100));

    return (
        <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            opacity: isActive ? 1 : 0.5
        }}>
            <div style={{
                flex: 1,
                height: '12px',
                background: 'rgba(0,0,0,0.3)',
                borderRadius: '6px',
                overflow: 'hidden',
                border: '1px solid rgba(255,255,255,0.1)'
            }}>
                <div style={{
                    height: '100%',
                    width: `${percentage}%`,
                    background: percentage > 80 ? '#ef4444' : percentage > 50 ? '#f59e0b' : '#22c55e',
                    borderRadius: '6px',
                    transition: 'width 0.05s ease-out'
                }} />
            </div>
            <span style={{ fontSize: '11px', opacity: 0.7, minWidth: '45px', textAlign: 'right' }}>
                {isActive ? `${Math.round(db)} dB` : '— dB'}
            </span>
        </div>
    );
};

export const SettingsModal: React.FC<SettingsModalProps> = ({
    isOpen,
    onClose,
    settings,
    onUpdateSettings,
    audioLevel = 0,
    debugInfo,
    isListening = false,
    onMicToggle
}) => {
    const [showDebugInfo, setShowDebugInfo] = useState(false);

    if (!isOpen) return null;

    return (
        <div className="help-popup-overlay" onClick={onClose}>
            <div className="help-popup" onClick={e => e.stopPropagation()}>
                <button className="help-close" onClick={onClose}><X size={20} /></button>
                <h2 style={{ marginTop: 0, marginBottom: '24px' }}>Settings</h2>

                {/* Animation Settings */}
                <div className="control-group" style={{ marginBottom: '24px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                        <label className="control-label" style={{ marginBottom: 0, fontSize: '16px' }}>
                            <span>Disable success animation</span>
                        </label>
                        <button
                            className={`switch-button ${settings.disableAnimation ? 'active' : ''}`}
                            onClick={() => onUpdateSettings({ ...settings, disableAnimation: !settings.disableAnimation })}
                            title={settings.disableAnimation ? "Enable Animation" : "Disable Animation"}
                        >
                            <div className="switch-thumb" />
                        </button>
                    </div>
                    <p style={{ fontSize: '12px', opacity: 0.7, margin: 0 }}>
                        Removes the "Good!" overlay to allow faster playing.
                    </p>
                </div>

                <hr style={{ borderColor: 'rgba(255,255,255,0.1)', margin: '24px 0' }} />

                <div className="control-group" style={{ marginBottom: '24px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                        <label className="control-label" style={{ marginBottom: 0, fontSize: '16px' }}>
                            <span>Virtual Instrument Sound</span>
                        </label>
                        <button
                            className={`switch-button ${!settings.virtualGuitarMute ? 'active' : ''}`}
                            onClick={() => onUpdateSettings({ ...settings, virtualGuitarMute: !settings.virtualGuitarMute })}
                            title={settings.virtualGuitarMute ? "Unmute" : "Mute"}
                        >
                            <div className="switch-thumb" />
                        </button>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', opacity: settings.virtualGuitarMute ? 0.5 : 1, transition: 'opacity 0.2s' }}>
                        {settings.virtualGuitarMute ? <VolumeX size={20} style={{ opacity: 0.7 }} /> : <Volume2 size={20} style={{ opacity: 0.7 }} />}
                        <input
                            type="range"
                            min="0"
                            max="1"
                            step="0.05"
                            value={settings.virtualGuitarVolume ?? 0.5}
                            onChange={(e) => onUpdateSettings({ ...settings, virtualGuitarVolume: parseFloat(e.target.value) })}
                            style={{ flex: 1 }}
                            disabled={settings.virtualGuitarMute}
                        />
                    </div>
                </div>

                <hr style={{ borderColor: 'rgba(255,255,255,0.1)', margin: '24px 0' }} />

                {/* Auto Play Settings */}
                <div className="control-group">
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                        <label className="control-label" style={{ marginBottom: 0, fontSize: '16px' }}>
                            <span>Auto-play Note</span>
                        </label>
                        <button
                            className={`switch-button ${settings.gameMode === 'ear_training' || settings.autoPlaySightReading ? 'active' : ''}`}
                            onClick={() => {
                                if (settings.gameMode !== 'ear_training') {
                                    onUpdateSettings({ ...settings, autoPlaySightReading: !settings.autoPlaySightReading });
                                }
                            }}
                            disabled={settings.gameMode === 'ear_training'}
                            style={{
                                cursor: settings.gameMode === 'ear_training' ? 'not-allowed' : 'pointer',
                                opacity: settings.gameMode === 'ear_training' ? 0.8 : 1
                            }}
                            title={settings.gameMode === 'ear_training' ? "Forced On in Ear Training" : "Toggle Auto-play"}
                        >
                            <div className="switch-thumb" />
                        </button>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <Volume2 size={20} style={{ opacity: 0.7 }} />
                        <input
                            type="range"
                            min="0"
                            max="1"
                            step="0.05"
                            value={settings.autoPlayVolume ?? 0.5}
                            onChange={(e) => onUpdateSettings({ ...settings, autoPlayVolume: parseFloat(e.target.value) })}
                            style={{ flex: 1 }}
                        />
                    </div>
                </div>
                <p style={{ fontSize: '12px', opacity: 0.7, margin: '8px 0 0 0' }}>
                    {settings.gameMode === 'ear_training'
                        ? "Automatically plays the note audio (Required for Ear Training)."
                        : "Automatically plays the note audio when a new note appears."}
                </p>

                <hr style={{ borderColor: 'rgba(255,255,255,0.1)', margin: '24px 0' }} />

                {/* Microphone Toggle */}
                <div className="control-group" style={{ marginBottom: '16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                        <label className="control-label" style={{ marginBottom: 0, fontSize: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                            {isListening ? <Mic size={18} /> : <MicOff size={18} />}
                            <span>Microphone</span>
                        </label>
                        <button
                            className={`switch-button ${isListening ? 'active' : ''}`}
                            onClick={onMicToggle}
                            title={isListening ? "Turn Off Microphone" : "Turn On Microphone"}
                        >
                            <div className="switch-thumb" />
                        </button>
                    </div>
                    <p style={{ fontSize: '12px', opacity: 0.7, margin: 0 }}>
                        {isListening ? 'Microphone is active and listening for notes.' : 'Enable microphone to detect your playing.'}
                    </p>
                </div>

                {/* Mic Sensitivity */}
                <div className="control-group">
                    <label className="control-label" style={{ marginBottom: '12px', fontSize: '16px' }}>
                        <span>Microphone Sensitivity</span>
                    </label>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', opacity: 0.7 }}>
                            <span>Low (-20dB)</span>
                            <span style={{ color: '#4cc9f0' }}>
                                {Math.round(-20 - ((settings.micSensitivity ?? 0.5) * 40))} dB
                            </span>
                            <span>High (-60dB)</span>
                        </div>
                        <input
                            type="range"
                            min="0"
                            max="1"
                            step="0.05"
                            value={settings.micSensitivity ?? 0.5}
                            onChange={(e) => onUpdateSettings({ ...settings, micSensitivity: parseFloat(e.target.value) })}
                            style={{ width: '100%' }}
                        />
                    </div>
                    <p style={{ fontSize: '12px', opacity: 0.7, margin: '8px 0 0 0' }}>
                        Adjust if notes are not detected (increase/right) or if background noise triggers notes (decrease/left).
                    </p>
                </div>

                {/* Microphone Level Meter */}
                <div className="control-group" style={{ marginTop: '16px' }}>
                    <label className="control-label" style={{ marginBottom: '8px', fontSize: '14px' }}>
                        <span>Microphone Level</span>
                        <span style={{ fontSize: '11px', opacity: 0.6, marginLeft: '8px' }}>
                            {isListening ? '(active)' : '(inactive)'}
                        </span>
                    </label>
                    <LevelMeter level={audioLevel} isActive={isListening} />
                    {!isListening && (
                        <p style={{ fontSize: '11px', opacity: 0.5, margin: '4px 0 0 0' }}>
                            Enable microphone to see audio levels
                        </p>
                    )}
                </div>

                {/* Debug Info Toggle */}
                <button
                    onClick={() => setShowDebugInfo(!showDebugInfo)}
                    style={{
                        marginTop: '16px',
                        background: 'transparent',
                        border: '1px solid rgba(255,255,255,0.2)',
                        borderRadius: '4px',
                        padding: '8px 12px',
                        color: 'inherit',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        fontSize: '12px',
                        opacity: 0.7,
                        width: '100%',
                        justifyContent: 'center'
                    }}
                >
                    {showDebugInfo ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    Microphone Debug Info
                </button>

                {/* Debug Info Panel */}
                {showDebugInfo && (
                    <div style={{
                        marginTop: '12px',
                        padding: '12px',
                        background: 'rgba(0,0,0,0.3)',
                        borderRadius: '8px',
                        fontSize: '11px',
                        fontFamily: 'monospace'
                    }}>
                        <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 12px' }}>
                            <span style={{ opacity: 0.6 }}>Status:</span>
                            <span style={{
                                color: debugInfo?.isCapturing ? '#22c55e' :
                                    debugInfo?.audioContextState === 'suspended' ? '#f59e0b' : '#ef4444'
                            }}>
                                {debugInfo?.isCapturing ? '✓ Capturing' :
                                    debugInfo?.audioContextState === 'suspended' ? '⚠ Suspended' :
                                        isListening ? '✗ Not Capturing' : '○ Inactive'}
                            </span>

                            <span style={{ opacity: 0.6 }}>AudioContext:</span>
                            <span>{debugInfo?.audioContextState || 'N/A'}</span>

                            <span style={{ opacity: 0.6 }}>Sample Rate:</span>
                            <span>{debugInfo?.sampleRate ? `${debugInfo.sampleRate} Hz` : 'N/A'}</span>

                            <span style={{ opacity: 0.6 }}>Input Device:</span>
                            <span style={{ wordBreak: 'break-word' }}>
                                {debugInfo?.inputDeviceLabel || 'N/A'}
                            </span>

                            <span style={{ opacity: 0.6 }}>Permission:</span>
                            <span style={{
                                color: debugInfo?.permissionState === 'granted' ? '#22c55e' :
                                    debugInfo?.permissionState === 'denied' ? '#ef4444' : '#f59e0b'
                            }}>
                                {debugInfo?.permissionState || 'unknown'}
                            </span>

                            <span style={{ opacity: 0.6 }}>RMS Level:</span>
                            <span>
                                {debugInfo?.currentRmsLevel !== undefined
                                    ? `${debugInfo.currentRmsLevel.toFixed(4)} (${Math.round(debugInfo.currentRmsDb)} dB)`
                                    : 'N/A'}
                            </span>

                            <span style={{ opacity: 0.6 }}>Browser:</span>
                            <span style={{ wordBreak: 'break-word', fontSize: '10px' }}>
                                {typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 60) + '...' : 'N/A'}
                            </span>
                        </div>

                        {debugInfo?.audioContextState === 'suspended' && (
                            <div style={{
                                marginTop: '12px',
                                padding: '8px',
                                background: 'rgba(245, 158, 11, 0.2)',
                                borderRadius: '4px',
                                color: '#f59e0b'
                            }}>
                                ⚠ AudioContext is suspended. Try tapping the mic button again or interacting with the page.
                            </div>
                        )}

                        {isListening && !debugInfo?.isCapturing && debugInfo?.audioContextState === 'running' && (
                            <div style={{
                                marginTop: '12px',
                                padding: '8px',
                                background: 'rgba(239, 68, 68, 0.2)',
                                borderRadius: '4px',
                                color: '#ef4444'
                            }}>
                                ✗ AudioContext is running but no audio is being captured. Check if another app is using the microphone.
                            </div>
                        )}
                    </div>
                )}
            </div>

        </div>
    );
};
