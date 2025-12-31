import { useState, useEffect, useCallback, useMemo } from 'react';
import { Logo } from './components/Logo';
import { LandscapeSuggestion } from './components/LandscapeSuggestion';


import { SheetMusic } from './components/SheetMusic';
import { Controls } from './components/Controls';
import { SettingsModal } from './components/SettingsModal';
import { OpenSourceModal } from './components/OpenSourceModal';
import { usePitchDetector } from './hooks/usePitchDetector';
import { useAudioPlayer } from './hooks/useAudioPlayer';
import { useSettings } from './context/SettingsContext';
import { useGameLogic } from './hooks/useGameLogic';
import { getNoteDetails } from './music/NoteUtils';
import {
  TUNINGS,
  getFretboardPositions,
} from './music/Tunings';
import { INSTRUMENT_DEFINITIONS } from './music/InstrumentConfigs';
import { Fretboard } from './components/Fretboard';
import { PianoKeys } from './components/PianoKeys';

import { Mic, MicOff, SkipForward, HelpCircle, Volume2, X, Guitar, Settings, Maximize, Minimize } from 'lucide-react';
import './App.css';
import './styles/skip-button.css';




function App() {
  const [listening, setListening] = useState(false);
  const { playNote } = useAudioPlayer();

  const { settings, updateSettings } = useSettings();
  // Alias to keep existing code working with minimal changes
  const setSettings = updateSettings;

  const { pitchData, error, audioLevel, debugInfo, isListening } = usePitchDetector(listening, settings.micSensitivity);

  // Game Logic Hook
  const {
    targetMidi,
    feedbackMessage,
    revealed,
    virtualNote,
    generateNewNote,
    handleVirtualInstrumentPlay
  } = useGameLogic(pitchData);

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isOpenSourceModalOpen, setIsOpenSourceModalOpen] = useState(false);
  const [hoveredMidi, setHoveredMidi] = useState<number | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [windowWidth, setWindowWidth] = useState(window.innerWidth);
  const [windowHeight, setWindowHeight] = useState(window.innerHeight);

  useEffect(() => {
    const handleResize = () => {
      setWindowWidth(window.innerWidth);
      setWindowHeight(window.innerHeight);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Theme support
  useEffect(() => {
    const root = document.documentElement;
    const theme = settings.theme || 'auto';
    if (theme === 'auto') {
      root.removeAttribute('data-theme');
    } else {
      root.setAttribute('data-theme', theme);
    }
  }, [settings.theme]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const toggleFullscreen = useCallback(async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch (err) {
      console.error("Error toggling fullscreen:", err);
    }
  }, []);

  const currentTuning = TUNINGS[settings.tuningId];
  const currentInstrumentDef = INSTRUMENT_DEFINITIONS[settings.instrument];

  // Resolve overrides
  const currentRangeDef = useMemo(() => {
    return currentInstrumentDef.ranges.find(r => r.id === settings.difficulty);
  }, [currentInstrumentDef, settings.difficulty]);

  // Determine active clef/transpose for rendering
  const activeClef = currentRangeDef?.clef ?? currentInstrumentDef.clefMode;
  const activeTranspose = currentRangeDef?.transpose ?? currentInstrumentDef.transpose;

  /* Keyboard Shortcuts */
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      // prevent default for space to stop scrolling
      if (e.code === 'Space') {
        e.preventDefault();
      }

      switch (e.key.toLowerCase()) {
        case 'h':
          setSettings(s => ({ ...s, showHint: !s.showHint }));
          break;
        case 'z':
          setSettings(s => ({ ...s, zenMode: !s.zenMode }));
          break;
        case 'r': // Replay
        case 'p': // Play
          playNote(targetMidi, 1.0);
          break;
        case 'm': // Toggle Game Mode
          setSettings(s => ({
            ...s,
            gameMode: s.gameMode === 'sight_reading' ? 'ear_training' : 'sight_reading'
          }));
          break;
        case 'v': // Virtual Instrument
          setSettings(s => ({ ...s, showFretboard: !s.showFretboard }));
          break;
        case 'l': // Listening (Mic)
          setListening(l => !l);
          break;
      }

      // Check non-character keys via code to avoid layout issues for function keys
      if (e.code === 'Space' || e.code === 'Enter') {
        generateNewNote();
      }

      if (e.code === 'Escape') {
        if (showHelp) setShowHelp(false);
        else if (settings.zenMode) setSettings(s => ({ ...s, zenMode: false }));
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [settings.zenMode, showHelp, generateNewNote, playNote, targetMidi]);

  // Hint text construction
  const hintPositions = useMemo(() => {
    // If showing full hint OR detecting via fretboard, we need positions? 
    // Actually, showHint=true renders the red dots.
    // If showFretboard=true but showHint=false, we render empty board (interactive).

    if (!settings.showHint && !settings.showFretboard) return [];
    if (!currentInstrumentDef.showTuning || !currentTuning) return [];

    // If hint is hidden but board is explicit, we still need data if we want to support 'hint-on-hover' or similar later.
    // But for now, if settings.showHint is FALSE, we pass EMPTY positions to Fretboard so it doesn't draw dots,
    // UNLESS we want to decouple 'positions' prop from 'showHint' prop in the component.
    // It's cleaner to pass the positions regardless and let the component decide based on a prop, 
    // OR filter here. 
    // The request says: "If hints are enabled simultaneously, they can be shown on the same fretboard"
    // So if showHint is true -> pass positions. If false -> pass empty.

    if (!settings.showHint) return [];

    return getFretboardPositions(targetMidi, currentTuning);
  }, [settings.showHint, settings.showFretboard, targetMidi, currentTuning, currentInstrumentDef]);

  // Auto-enable mic when tuner is turned on
  useEffect(() => {
    if (settings.showTuningMeter && !listening) {
      setListening(true);
    }
  }, [settings.showTuningMeter, listening]);

  return (
    <div className={`app-container ${settings.zenMode ? 'zen-mode' : ''}`}>
      <LandscapeSuggestion />
      {!settings.zenMode && (
        <header className="app-header">
          <div className="app-header-left">
            <Logo className="logo" />
          </div>

          <div className="header-controls">
            <div className="game-mode-toggle">
              <button
                className={`toggle-option ${settings.gameMode === 'sight_reading' ? 'active' : ''}`}
                onClick={() => setSettings(s => ({ ...s, gameMode: 'sight_reading' }))}
              >
                Sight Reading
              </button>
              <button
                className={`toggle-option ${settings.gameMode === 'ear_training' ? 'active' : ''}`}
                onClick={() => setSettings(s => ({ ...s, gameMode: 'ear_training' }))}
              >
                Ear Training
              </button>
            </div>

            <button
              className="icon-button"
              onClick={toggleFullscreen}
              title="Toggle Fullscreen"
            >
              {isFullscreen ? <Minimize size={24} /> : <Maximize size={24} />}
            </button>
            <button
              className="icon-button"
              onClick={() => setSettings(s => ({ ...s, zenMode: !s.zenMode }))}
              title="Enter Zen Mode (Z)"
            >
              <Maximize size={24} style={{ transform: 'rotate(45deg)' }} />
            </button>
            <button
              className="icon-button help-btn"
              onClick={() => setShowHelp(true)}
              title="Shortcuts Help"
            >
              <HelpCircle size={24} />
            </button>
            <button
              className="icon-button"
              onClick={() => setIsSettingsOpen(true)}
              title="Settings"
            >
              <Settings size={24} />
            </button>
          </div>
        </header>
      )}

      <main className="main-stage">
        <div className={`card sheet-music-card ${(settings.showHint || settings.showFretboard) ? 'has-hint' : ''} ${settings.zenMode ? 'zen-mode' : ''}`}>
          <div className="sheet-music-container">
            <SheetMusic
              targetMidi={targetMidi}
              playedMidi={virtualNote ?? pitchData?.midi}
              keySignature={settings.keySignature}
              clef={activeClef}
              transpose={activeTranspose}
              width={Math.min(windowWidth - 40, 500)}
              height={
                activeClef === 'grand'
                  ? (windowHeight < 500 ? 190 : 260) // Compact Grand Staff if short screen
                  : (windowHeight < 500 ? 120 : 180) // Compact Single Staff
              }
              hideTargetNote={settings.gameMode === 'ear_training' && !revealed}
              hoverMidi={settings.showHint ? hoveredMidi : null}
            />
          </div>

          {!settings.zenMode && (
            <div className="feedback-area">
              {feedbackMessage ? (
                <div key={feedbackMessage} className="success-message animate-pop">
                  {feedbackMessage.startsWith("Good! ") ? (
                    <>
                      <div className="success-prefix">Good!</div>
                      <div className="success-note">{feedbackMessage.replace("Good! ", "")}</div>
                    </>
                  ) : (
                    feedbackMessage
                  )}
                </div>
              ) : (
                <div className="instruction-text">
                  {settings.gameMode === 'ear_training' ? "Listen and play the note" : "Play the note above"}
                </div>
              )}
            </div>
          )}



          {(settings.showHint || settings.showFretboard) && (
            <div className="hint-card">
              {settings.showHint && (
                <div className="hint-note landscape-hint-note">
                  {getNoteDetails(targetMidi + activeTranspose).scientific}
                </div>
              )}

              {/* Virtual Instrument Display */}
              {currentInstrumentDef.showTuning && (
                currentInstrumentDef.id === 'piano' ? (
                  <PianoKeys
                    minMidi={36} // C2
                    maxMidi={84} // C6
                    markedNotes={settings.showHint ? [targetMidi] : []}
                    interactive={settings.showFretboard || settings.showHint}
                    showTooltips={settings.showHint}
                    displayTranspose={activeTranspose}
                    onPlayNote={handleVirtualInstrumentPlay}
                    onHover={setHoveredMidi}
                  />
                ) : (
                  currentTuning && (
                    <Fretboard
                      tuning={currentTuning}
                      positions={hintPositions}
                      interactive={settings.showFretboard || settings.showHint}
                      showTooltips={settings.showHint}
                      displayTranspose={activeTranspose}
                      onPlayNote={handleVirtualInstrumentPlay}
                      onHover={setHoveredMidi}
                      showHints={settings.showHint}
                      maxFrets={15}
                    />
                  )
                )
              )}
            </div>
          )}

          {error && <div className="error-message">{error}</div>}

          {!settings.zenMode && (
            <div className="action-row" style={{ marginTop: '24px', display: 'flex', justifyContent: 'center', gap: '16px' }}>
              {currentInstrumentDef.showTuning && (
                <button
                  className={`hint-button ${settings.showFretboard ? 'active' : ''}`}
                  onClick={() => setSettings(s => ({ ...s, showFretboard: !s.showFretboard }))}
                  title={`Toggle Virtual ${currentInstrumentDef.displayName} (Keyboard Shortcut: V)`}
                >
                  <Guitar size={18} />
                  {currentInstrumentDef.id === 'piano' ? 'Piano' : 'Guitar'}
                </button>
              )}

              <button
                className={`hint-button ${settings.showHint ? 'active' : ''}`}
                onClick={() => setSettings(s => ({ ...s, showHint: !s.showHint }))}
                title="Keyboard Shortcut: H"
              >
                <HelpCircle size={18} />
                {settings.showHint ? "Hide Hint" : "Show Hint"}
              </button>

              <button
                className="hint-button"
                onClick={() => playNote(targetMidi, 1.0)}
                title="Keyboard Shortcut: P or R"
              >
                <Volume2 size={18} />
                Play Note
              </button>

              <button className="skip-button" onClick={() => generateNewNote()} title="Keyboard Shortcut: Space">
                <SkipForward size={18} />
                Skip Note
              </button>
            </div>
          )}
        </div>


        {
          !settings.zenMode && (
            <div className="pitch-monitor-bar">
              <button
                className={`mic-button ${listening ? 'listening' : ''}`}
                onClick={() => setListening(!listening)}
                aria-label={listening ? "Stop Listening" : "Start Listening"}
                title="Toggle Monitor (Keyboard Shortcut: L)"
              >
                {listening ? <Mic size={28} /> : <MicOff size={28} />}
              </button>

              <div className={`pitch-readout ${pitchData ? 'active' : ''}`}>
                {pitchData ? (
                  <>
                    <span className={`detected-note ${pitchData.midi === targetMidi ? 'match' : ''}`}>
                      {pitchData.note}
                    </span>
                    <span className="detected-hz">{Math.round(pitchData.frequency)} Hz</span>
                  </>
                ) : (
                  <span className="placeholder">{listening ? "Listening..." : "Mic Off"}</span>
                )}
              </div>
            </div>
          )
        }
      </main >

      {!settings.zenMode && (
        <footer className="settings-footer">
          <Controls
            currentPitch={pitchData ? { note: pitchData.note, cents: pitchData.cents } : null}
          />
          <div className="app-subtitle">
            <button className="link-button" onClick={() => setIsOpenSourceModalOpen(true)}>Open Source Libraries</button>
            <span className="separator">•</span>
            <a href="https://github.com/9x/sheetmusictrainer" target="_blank" rel="noopener noreferrer">GitHub</a>
            <span className="separator">•</span>
            <a href="http://jensmohrmann.de" target="_blank" rel="noopener noreferrer">JensMohrmann.de</a>
          </div>
        </footer>
      )}


      {/* Exit Zen Mode Button - Only shown in Zen Mode */}
      {settings.zenMode && (
        <button
          className="exit-zen-button"
          onClick={() => setSettings(s => ({ ...s, zenMode: false }))}
          title="Keyboard Shortcut: Z"
        >
          Exit Zen Mode
        </button>
      )}

      {/* Help Popup */}
      {
        showHelp && (
          <div className="help-popup-overlay" onClick={() => setShowHelp(false)}>
            <div className="help-popup" onClick={e => e.stopPropagation()}>
              <button className="help-close" onClick={() => setShowHelp(false)}><X size={20} /></button>
              <h2 style={{ marginTop: 0, marginBottom: '24px' }}>Keyboard Shortcuts</h2>

              <div className="help-item">
                <span>Skip Note</span>
                <span className="shortcut-key">Space</span>
              </div>
              <div className="help-item">
                <span>Toggle Hint</span>
                <span className="shortcut-key">H</span>
              </div>
              <div className="help-item">
                <span>Toggle Virtual Instrument</span>
                <span className="shortcut-key">V</span>
              </div>
              <div className="help-item">
                <span>Toggle Mic</span>
                <span className="shortcut-key">L</span>
              </div>
              <div className="help-item">
                <span>Toggle Zen Mode</span>
                <span className="shortcut-key">Z</span>
              </div>
              <div className="help-item">
                <span>Replay Note</span>
                <span className="shortcut-key">R</span>
              </div>
              <div className="help-item">
                <span>Toggle Game Mode</span>
                <span className="shortcut-key">M</span>
              </div>
              <div className="help-item">
                <span>Close Help / Exit Zen</span>
                <span className="shortcut-key">Esc</span>
              </div>
            </div>
          </div>
        )
      }

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        settings={settings}
        onUpdateSettings={setSettings}
        audioLevel={audioLevel}
        debugInfo={debugInfo}
        isListening={isListening}
        onMicToggle={() => setListening(l => !l)}
      />

      <OpenSourceModal
        isOpen={isOpenSourceModalOpen}
        onClose={() => setIsOpenSourceModalOpen(false)}
      />
    </div >
  );
}

export default App;
