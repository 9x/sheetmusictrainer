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
  getFretboardPositions
} from './music/Tunings';
import { INSTRUMENT_DEFINITIONS } from './music/InstrumentConfigs';
import { FretboardHint } from './components/FretboardHint';
import { TuningMeter } from './components/TuningMeter';
import { Mic, MicOff, SkipForward, HelpCircle, Volume2 } from 'lucide-react';
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
    gameMode: 'sight_reading'
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

    if (rangeConfig) {
      return Array.from({ length: rangeConfig.max - rangeConfig.min + 1 }, (_, i) => rangeConfig.min + i);
    }

    // Fallback if difficulty ID doesn't match current instrument (e.g. after switch)
    // Return first range of current instrument
    const fallbackRange = currentInstrumentDef.ranges[0];
    return Array.from({ length: fallbackRange.max - fallbackRange.min + 1 }, (_, i) => fallbackRange.min + i);

  }, [settings.difficulty, currentInstrumentDef]);

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

  // Initial note
  useEffect(() => {
    generateNewNote();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.difficulty, settings.tuningId]);


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
          <div className="logo">Sheet music trainer</div>
        </header>
      )}

      <main className="main-stage">
        <div className="card sheet-music-card">
          <SheetMusic
            targetMidi={targetMidi}
            playedMidi={pitchData?.midi}
            keySignature={settings.keySignature}
            clef={currentInstrumentDef.clefMode}
            transpose={currentInstrumentDef.transpose}
            width={Math.min(window.innerWidth - 40, 500)}
            height={currentInstrumentDef.clefMode === 'grand' ? 300 : 250}
            hideTargetNote={settings.gameMode === 'ear_training' && !revealed}
          />

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
              <div className="hint-note">
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
              >
                <HelpCircle size={18} />
                {settings.showHint ? "Hide Hint" : "Show Hint"}
              </button>
              <button className="skip-button" onClick={generateNewNote}>
                <SkipForward size={18} />
                Skip Note
              </button>
              <button
                className="zen-button"
                onClick={() => setSettings(s => ({ ...s, zenMode: true }))}
                title="Zen Mode"
              >
                <span>Zen</span>
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

      {
        settings.zenMode && (
          <button
            className="exit-zen-button"
            onClick={() => setSettings(s => ({ ...s, zenMode: false }))}
          >
            Exit Zen Mode
          </button>
        )
      }
    </div >
  );
}

export default App;
