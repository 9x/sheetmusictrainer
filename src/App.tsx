import { useState, useEffect, useLayoutEffect, useCallback, useMemo, useRef } from 'react';
import { Logo } from './components/Logo';
import { LandscapeSuggestion } from './components/LandscapeSuggestion';
import { Controls } from './components/Controls';
import { SettingsModal } from './components/SettingsModal';
import { OpenSourceModal } from './components/OpenSourceModal';
import { SingleNoteTrainer, type SingleNoteHandle } from './components/SingleNoteTrainer';
import { LiveNoteStaff } from './components/LiveNoteStaff';
import { resolveClefTranspose } from './music/InstrumentConfigs';
import { PhraseTrainer, type PhraseHandle } from './components/PhraseTrainer';
import { AssistMode } from './components/AssistMode';
import { usePitchDetector } from './hooks/usePitchDetector';
import { useSettings } from './context/useSettings';
import { audioEngine } from './audio/AudioEngine';
import { midiToFrequency } from './music/NoteUtils';
import { TUNINGS } from './music/Tunings';
import { INSTRUMENT_DEFINITIONS } from './music/InstrumentConfigs';

import { Mic, MicOff, HelpCircle, X, Settings, Maximize, Minimize } from 'lucide-react';
import './App.css';
import './styles/skip-button.css';

function App() {
  const [listening, setListening] = useState(false);

  const { settings, updateSettings } = useSettings();
  const setSettings = updateSettings;

  const isPhrase = settings.gameMode === 'phrase';
  const isAssist = settings.gameMode === 'assist';

  const currentTuning = TUNINGS[settings.tuningId];
  const currentInstrumentDef = INSTRUMENT_DEFINITIONS[settings.instrument];

  // Lowest note the instrument can produce: the pitch analysis window adapts
  // to it (shorter window = lower latency for instruments without deep bass)
  const instrumentMinMidi = useMemo(() => {
    let min = Infinity;
    for (const r of currentInstrumentDef.ranges) {
      if (r.min !== undefined) min = Math.min(min, r.min);
    }
    if (currentTuning) {
      for (const stringMidi of currentTuning.strings) min = Math.min(min, stringMidi);
    }
    return min === Infinity ? 40 : min; // Fallback: guitar low E
  }, [currentInstrumentDef, currentTuning]);

  // One semitone of margin below the lowest note (detuned strings, flat playing)
  const { pitchData, error, audioLevel, debugInfo, isListening } = usePitchDetector(
    listening,
    settings.micSensitivity,
    midiToFrequency(instrumentMinMidi - 1)
  );

  // Live feedback shows only what the USER plays, gated while the app's own
  // speaker output is audible (see SingleNoteTrainer / PhraseTrainer).
  const displayedPitch = audioEngine.isAudible() ? null : pitchData;

  const singleNoteRef = useRef<SingleNoteHandle>(null);
  const phraseRef = useRef<PhraseHandle>(null);

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isOpenSourceModalOpen, setIsOpenSourceModalOpen] = useState(false);
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

  // Theme support — MUST be a layout effect: children read the resolved theme
  // colors from getComputedStyle inside their own passive effects.
  useLayoutEffect(() => {
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

  /* Keyboard Shortcuts */
  const [showHelp, setShowHelp] = useState(false);

  // Opening dialogs pauses a running phrase run (contract E1/lifecycle).
  const openSettings = useCallback(() => {
    phraseRef.current?.pause();
    setIsSettingsOpen(true);
  }, []);

  const openHelp = useCallback(() => {
    phraseRef.current?.pause();
    setShowHelp(true);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      // Text inputs / selects keep their native keys — shortcuts must not
      // fire while typing. FOCUSED BUTTONS however stay eligible: after a
      // click the button keeps focus, and gating there made N/R/P/L
      // silently dead until the user clicked elsewhere. Space/Enter on a
      // focused button activate it natively (guarded below), so no
      // double-fire.
      const onTextEntry =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        !!target?.isContentEditable;
      if (onTextEntry) return;

      if (e.code === 'Escape') {
        if (showHelp) setShowHelp(false);
        else if (settings.zenMode) setSettings(s => ({ ...s, zenMode: false }));
        return;
      }
      // Prevent default for space to stop scrolling (Space on a focused
      // button activates it natively — preventDefault only applies when the
      // focus is on the body, where the shortcut below takes over).
      if (e.code === 'Space' && !(target instanceof HTMLButtonElement)) {
        e.preventDefault();
      }

      if (isPhrase) {
        switch (e.key.toLowerCase()) {
          case 'h':
            setSettings(s => ({ ...s, showHint: !s.showHint }));
            break;
          case 'z':
            setSettings(s => ({ ...s, zenMode: !s.zenMode }));
            break;
          case 'r':
            phraseRef.current?.retry();
            break;
          case 'p':
            phraseRef.current?.previewToggle();
            break;
          case 'n':
            phraseRef.current?.next();
            break;
          case 's':
            phraseRef.current?.skip();
            break;
          case 'v':
            setSettings(s => ({ ...s, showFretboard: !s.showFretboard }));
            break;
          case 'l':
            setListening(l => !l);
            break;
        }
        // Space/Enter on a focused button natively activate that button
        // (e.g. Start); only treat them as pause-toggle when NOT on a button.
        if ((e.code === 'Space' || e.code === 'Enter') && !(e.target instanceof HTMLButtonElement)) {
          phraseRef.current?.pauseToggle();
        }
        return;
      }

      if (isAssist) {
        // Assist mode: only display shortcuts — no trainer actions.
        switch (e.key.toLowerCase()) {
          case 'h':
            setSettings(s => ({ ...s, showHint: !s.showHint }));
            break;
          case 'z':
            setSettings(s => ({ ...s, zenMode: !s.zenMode }));
            break;
          case 'v':
            setSettings(s => ({ ...s, showFretboard: !s.showFretboard }));
            break;
          case 'l':
            setListening(l => !l);
            break;
        }
        return;
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
          singleNoteRef.current?.playCurrent();
          break;
        case 'm': // Cycle game mode
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

      if ((e.code === 'Space' || e.code === 'Enter') && !(e.target instanceof HTMLButtonElement)) {
        singleNoteRef.current?.skipNote();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [settings, showHelp, isPhrase, isAssist, setSettings]);

  // 'm' cycles back to sight reading from phrase/assist modes.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'm') return;
      const target = e.target as HTMLElement | null;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement ||
        target instanceof HTMLButtonElement || target instanceof HTMLSelectElement || target?.isContentEditable) return;
      if (settings.gameMode === 'phrase' || settings.gameMode === 'assist') {
        setSettings(s => ({ ...s, gameMode: 'sight_reading' }));
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [settings.gameMode, setSettings]);

  // Auto-enable mic when the tuner is turned on (rAF defers the state update
  // out of the effect phase to avoid cascading renders)
  useEffect(() => {
    if (settings.showTuningMeter && !listening) {
      const id = requestAnimationFrame(() => setListening(true));
      return () => cancelAnimationFrame(id);
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
              <button
                className={`toggle-option ${settings.gameMode === 'phrase' ? 'active' : ''}`}
                onClick={() => setSettings(s => ({ ...s, gameMode: 'phrase' }))}
                title="Play short phrases and melodies"
              >
                Phrases
              </button>
              <button
                className={`toggle-option ${settings.gameMode === 'assist' ? 'active' : ''}`}
                onClick={() => setSettings(s => ({ ...s, gameMode: 'assist' }))}
                title="Practice companion: shows played notes while you work from paper"
              >
                Assist
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
              onClick={openHelp}
              title="Shortcuts Help"
            >
              <HelpCircle size={24} />
            </button>
            <button
              className="icon-button"
              onClick={openSettings}
              title="Settings"
            >
              <Settings size={24} />
            </button>
          </div>
        </header>
      )}

      <main className="main-stage">
        {isPhrase ? (
          <PhraseTrainer
            ref={phraseRef}
            listening={listening}
            micError={error}
            windowWidth={windowWidth}
          />
        ) : isAssist ? (
          <AssistMode
            pitchData={displayedPitch}
            windowWidth={windowWidth}
          />
        ) : (
          <SingleNoteTrainer
            ref={singleNoteRef}
            pitchData={pitchData}
            windowWidth={windowWidth}
            windowHeight={windowHeight}
          />
        )}

        {error && <div className="error-message">{error}</div>}

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

              <LiveNoteStaff
                midi={displayedPitch ? displayedPitch.midi : null}
                transpose={resolveClefTranspose(currentInstrumentDef, settings.difficulty).transpose}
                keySignature={settings.keySignature}
                clef={currentInstrumentDef.clefMode === 'treble' ? 'treble' : currentInstrumentDef.clefMode === 'bass' ? 'bass' : undefined}
                theme={settings.theme}
              />
              <div className={`pitch-readout ${displayedPitch ? 'active' : ''}`}>
                {displayedPitch ? (
                  <>
                    <span className="detected-note">
                      {displayedPitch.note}
                    </span>
                    <span className="detected-hz">{Math.round(displayedPitch.frequency)} Hz</span>
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
            currentPitch={displayedPitch ? { note: displayedPitch.note, cents: displayedPitch.cents } : null}
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

              {isPhrase ? (
                <>
                  <div className="help-item"><span>Start / Pause / Resume</span><span className="shortcut-key">Space</span></div>
                  <div className="help-item"><span>Preview phrase (Play / Stop)</span><span className="shortcut-key">P</span></div>
                  <div className="help-item"><span>Retry phrase</span><span className="shortcut-key">R</span></div>
                  <div className="help-item"><span>New melody / next bars</span><span className="shortcut-key">N</span></div>
                  <div className="help-item"><span>Skip note (at your pace)</span><span className="shortcut-key">S</span></div>
                </>
              ) : (
                <>
                  <div className="help-item"><span>Skip Note</span><span className="shortcut-key">Space</span></div>
                  <div className="help-item"><span>Replay Note</span><span className="shortcut-key">R</span></div>
                  <div className="help-item"><span>Toggle Game Mode</span><span className="shortcut-key">M</span></div>
                </>
              )}
              <div className="help-item"><span>Toggle Hint</span><span className="shortcut-key">H</span></div>
              <div className="help-item"><span>Toggle Virtual Instrument</span><span className="shortcut-key">V</span></div>
              <div className="help-item"><span>Toggle Mic</span><span className="shortcut-key">L</span></div>
              <div className="help-item"><span>Toggle Zen Mode</span><span className="shortcut-key">Z</span></div>
              <div className="help-item"><span>Close Help / Exit Zen</span><span className="shortcut-key">Esc</span></div>
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
