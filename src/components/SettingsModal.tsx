import React from 'react';
import { X, Volume2, VolumeX } from 'lucide-react';
import type { AppSettings } from './Controls';

interface SettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
    settings: AppSettings;
    onUpdateSettings: (s: AppSettings) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose, settings, onUpdateSettings }) => {
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
                            <span>Virtual Guitar Sound</span>
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
            </div>

        </div>
    );
};
