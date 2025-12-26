import { useState, useEffect, useCallback, useMemo } from 'react';
import { SheetMusic } from './components/SheetMusic';
import { Controls, type AppSettings } from './components/Controls';
import { usePitchDetector } from './hooks/usePitchDetector';
import { useMetronome } from './hooks/useMetronome';
import { useAudioPlayer } from './hooks/useAudioPlayer';
import {
  getRandomNote,
  getNoteDetails
} from './music/NoteUtils';
import {
  TUNINGS,
  getFretboardPositions,
  getOpenStringNotes,
  getFirstPositionNotes,
} from './music/Tunings';
import { INSTRUMENT_DEFINITIONS } from './music/InstrumentConfigs';
import { FretboardHint } from './components/FretboardHint';
import { TuningMeter } from './components/TuningMeter';
import { Mic, MicOff, SkipForward, HelpCircle, Volume2, X } from 'lucide-react';
import './App.css';
import './styles/skip-button.css';

const NOTE_MATCH_THRESHOLD_MS = 300; // How long to convert hold note to confirm

function App() {
  const [listening, setListening] = useState(false);
  const { pitchData, error } = usePitchDetector(listening);
  const { playNote } = useAudioPlayer();

  const [targetMidi, setTargetMidi] = useState<number>(60); // Start with C4
  const [settings, setSettings] = useState<AppSettings>({
    difficulty: 'first_pos',
    showHint: false,
    showTuningMeter: false,
    tuningId: 'standard',
    keySignature: 'C',
    instrument: 'guitar',
    rhythm: {
      mode: 'bpm',
      bpm: 60,
      seconds: 5,
      active: false,
      autoAdvance: false,
      sound: true,
      volume: 0.5
    },
    zenMode: false,
    gameMode: 'sight_reading',
    customMinFret: 0,
    customMaxFret: 12
  });

  const [matchStartTime, setMatchStartTime] = useState<number | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState<string>("");
  const [revealed, setRevealed] = useState(false);

  const currentTuning = TUNINGS[settings.tuningId];
  const currentInstrumentDef = INSTRUMENT_DEFINITIONS[settings.instrument];

  // Generate valid notes based on difficulty
  const validNotes = useMemo(() => {
    // Find range config
    const rangeConfig = currentInstrumentDef.ranges.find(r => r.id === settings.difficulty);

    const getNotesFromConfig = (config: typeof rangeConfig) => {
      if (!config) return [];

      // Dynamic logic based on type
      if (config.type === 'open_strings') {
        // Use current tuning if applicable (Guitar/Bass)
        if (currentTuning) {
          return getOpenStringNotes(currentTuning);
        }
        // Fallback for non-fretted if they happen to use this type (unlikely)
        return config.notes || [];
      }

      if (config.type === 'first_position') {
        if (currentTuning) {
          return getFirstPositionNotes(currentTuning);
        }
        return config.notes || [];
      }

      if (config.type === 'custom_fret') {
        if (currentTuning) {
          const minFret = settings.customMinFret ?? config.defaultMinFret ?? 0;
          const maxFret = settings.customMaxFret ?? config.defaultMaxFret ?? 12;

          const notes = new Set<number>();
          currentTuning.strings.forEach(stringMidi => {
            for (let fret = minFret; fret <= maxFret; fret++) {
              notes.add(stringMidi + fret);
            }
          });
          return Array.from(notes).sort((a, b) => a - b);
        }
        return [];
      }

      if (config.type === 'specific_string') {
        if (currentTuning && config.stringIndex !== undefined) {
          const openNote = currentTuning.strings[config.stringIndex];
          if (openNote === undefined) return [];

          // Generate frets 0 to 12 for this string
          const notes = [];
          for (let i = 0; i <= 12; i++) {
            notes.push(openNote + i);
          }
          return notes;
        }
        return [];
      }

      // Static fallback
      if (config.notes) return config.notes;
      if (config.min !== undefined && config.max !== undefined) {
        return Array.from({ length: config.max - config.min + 1 }, (_, i) => config.min! + i);
      }
      return [];
    };

    if (rangeConfig) {
      return getNotesFromConfig(rangeConfig);
    }

    // Fallback if difficulty ID doesn't match current instrument (e.g. after switch)
    // Return first range of current instrument
    const fallbackRange = currentInstrumentDef.ranges[0];
    return getNotesFromConfig(fallbackRange);

  }, [settings.difficulty, currentInstrumentDef, currentTuning, settings.customMinFret, settings.customMaxFret]);

  const generateNewNote = useCallback(() => {
    // Determine min/max based on available notes to avoid infinite loops if validNotes empty
    if (validNotes.length === 0) return;
    const min = validNotes[0];
    const max = validNotes[validNotes.length - 1];

    const newNote = getRandomNote(min, max, validNotes);
    if (newNote === targetMidi && validNotes.length > 1) {
      // Try once to get a different note
      const retry = getRandomNote(min, max, validNotes);
      setTargetMidi(retry);
    } else {
      setTargetMidi(newNote);
    }
    setMatchStartTime(null);
    setFeedbackMessage("");
    setRevealed(false);
  }, [validNotes, targetMidi]);

  // Audio Playback trigger
  useEffect(() => {
    if (settings.gameMode === 'ear_training' && !revealed) {
      // Add a small delay to ensure state settles or allow UI to update
      const timer = setTimeout(() => {
        playNote(targetMidi, 1.0); // Play for 1 second
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [targetMidi, settings.gameMode, revealed, playNote]);

  // Initial note, and whenever difficulty/tuning/gamemode changes
  useEffect(() => {
    generateNewNote();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.difficulty, settings.tuningId, settings.gameMode]);


  // Metronome Logic
  // Calculate effective BPM based on mode
  const effectiveBpm = useMemo(() => {
    if (settings.rhythm.mode === 'bpm') return settings.rhythm.bpm;
    // In seconds mode, BPM = 60 / seconds
    return 60 / settings.rhythm.seconds;
  }, [settings.rhythm.mode, settings.rhythm.bpm, settings.rhythm.seconds]);

  const handleTick = useCallback(() => {
    if (settings.rhythm.autoAdvance && settings.rhythm.active) {
      generateNewNote();
      // Reset feedback message on auto-tick
      setFeedbackMessage("");
    }
  }, [settings.rhythm.autoAdvance, settings.rhythm.active, generateNewNote]);

  const { restart: restartMetronome } = useMetronome({
    bpm: effectiveBpm,
    volume: settings.rhythm.sound ? settings.rhythm.volume : 0,
    playing: settings.rhythm.active,
    onTick: handleTick
  });


  // Match Logic
  useEffect(() => {
    if (!pitchData) {
      setMatchStartTime(null);
      return;
    }

    if (pitchData.midi === targetMidi) {
      // Prevent re-triggering success if we're already in a success state
      if (feedbackMessage === "Good!") return;

      if (matchStartTime === null) {
        setMatchStartTime(Date.now());
      } else {
        const duration = Date.now() - matchStartTime;
        if (duration > NOTE_MATCH_THRESHOLD_MS) {
          // Success!
          setFeedbackMessage("Good!");
          setRevealed(true);
          setMatchStartTime(null);

          const isRhythmActive = settings.rhythm.active && settings.rhythm.autoAdvance;
          const isTimerMode = settings.rhythm.mode === 'seconds';

          if (!isRhythmActive) {
            // Standard or Rhythm-Manual

            setTimeout(() => {
              generateNewNote();
            }, 800);
          } else {
            // Rhythm Active AND Auto-Advance
            if (isTimerMode) {
              // Dynamic Timer Mode: Success triggers advance

              restartMetronome(); // Reset the countdown
              setTimeout(() => {
                generateNewNote();
              }, 200);
              setMatchStartTime(null);
            } else {
              // Strict BPM Mode: Consumed success, but wait for tick.
              if (feedbackMessage !== "Good!") { // Only increment if not already good

              }
            }
          }
        }
      }
    } else {
      setMatchStartTime(null);
    }
  }, [pitchData, targetMidi, matchStartTime, generateNewNote, settings.rhythm, restartMetronome, feedbackMessage]);

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
    if (!settings.showHint) return [];
    if (!currentInstrumentDef.showTuning || !currentTuning) return []; // No fretboard hints for piano/voice

    return getFretboardPositions(targetMidi, currentTuning);
  }, [settings.showHint, targetMidi, currentTuning, currentInstrumentDef]);

  return (
    <div className={`app-container ${settings.zenMode ? 'zen-mode' : ''}`}>
      {!settings.zenMode && (
        <header className="app-header">
          <div className="app-header-left">
            <div className="logo">Sheet music trainer</div>
            <div className="app-subtitle">
              <a href="http://jensmohrmann.de" target="_blank" rel="noopener noreferrer">jensmohrmann.de</a>
            </div>
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
              onClick={() => setShowHelp(true)}
              title="Shortcuts Help"
            >
              <HelpCircle size={24} />
            </button>
          </div>
        </header>
      )}

      <main className="main-stage">
        <div className={`card sheet-music-card ${settings.showHint ? 'has-hint' : ''} ${settings.zenMode ? 'zen-mode' : ''}`}>
          <div className="sheet-music-container">
            <SheetMusic
              targetMidi={targetMidi}
              playedMidi={pitchData?.midi}
              keySignature={settings.keySignature}
              clef={currentInstrumentDef.clefMode}
              transpose={currentInstrumentDef.transpose}
              width={Math.min(window.innerWidth - 40, 500)}
              height={currentInstrumentDef.clefMode === 'grand' ? 260 : 180}
              hideTargetNote={settings.gameMode === 'ear_training' && !revealed}
            />
          </div>

          {!settings.zenMode && (
            <div className="feedback-area">
              {feedbackMessage ? (
                <div className="success-message animate-pop">{feedbackMessage}</div>
              ) : (
                <div className="instruction-text">
                  {settings.gameMode === 'ear_training' ? "Listen and play the note" : "Play the note above"}
                </div>
              )}
            </div>
          )}

          {settings.gameMode === 'ear_training' && !settings.zenMode && (
            <div style={{ display: 'flex', justifyContent: 'center', marginTop: '16px' }}>
              <button
                className="control-button"
                onClick={() => playNote(targetMidi, 1.0)}
                style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 16px' }}
              >
                <Volume2 size={24} />
                Play Note
              </button>
            </div>
          )}

          {settings.showHint && (
            <div className="hint-card">
              <div className="hint-note landscape-hint-note">
                {getNoteDetails(targetMidi + currentInstrumentDef.transpose).scientific}
              </div>
              {currentInstrumentDef.showTuning && currentTuning && (
                <FretboardHint tuning={currentTuning} positions={hintPositions} />
              )}
            </div>
          )}

          {error && <div className="error-message">{error}</div>}

          {!settings.zenMode && (
            <div className="action-row" style={{ marginTop: '24px', display: 'flex', justifyContent: 'center', gap: '16px' }}>
              <button
                className={`hint-button ${settings.showHint ? 'active' : ''}`}
                onClick={() => setSettings(s => ({ ...s, showHint: !s.showHint }))}
                title="Keyboard Shortcut: H"
              >
                <HelpCircle size={18} />
                {settings.showHint ? "Hide Hint" : "Show Hint"}
              </button>
              <button className="skip-button" onClick={generateNewNote} title="Keyboard Shortcut: Space">
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
              >
                {listening ? <Mic size={28} /> : <MicOff size={28} />}
              </button>

              {settings.showTuningMeter && pitchData ? (
                <TuningMeter cents={pitchData.cents} noteName={pitchData.note} />
              ) : (
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
              )}
            </div>
          )
        }
      </main >

      {!settings.zenMode && (
        <footer className="settings-footer">
          <Controls settings={settings} onUpdateSettings={setSettings} />
        </footer>
      )
      }

      {/* Floating Zen Mode Button (Toggle) */}
      <button
        className="exit-zen-button"
        onClick={() => setSettings(s => ({ ...s, zenMode: !s.zenMode }))}
        title="Keyboard Shortcut: Z"
      >
        {settings.zenMode ? "Exit Zen Mode" : "Zen Mode"}
      </button>

      {/* Help Popup */}
      {showHelp && (
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
      )}
    </div >
  );
}

export default App;
