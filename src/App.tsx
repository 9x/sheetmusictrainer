import { useState, useEffect, useCallback, useMemo } from 'react';
import { SheetMusic } from './components/SheetMusic';
import { Controls, type AppSettings } from './components/Controls';
import { usePitchDetector } from './hooks/usePitchDetector';
import {
  getRandomNote,
  getNoteDetails
} from './music/NoteUtils';
import {
  TUNINGS,
  getFretboardPositions
} from './music/Tunings';
import { INSTRUMENT_DEFINITIONS } from './music/InstrumentConfigs';
import { Mic, MicOff, SkipForward } from 'lucide-react';
import './App.css';
import './styles/skip-button.css';

const NOTE_MATCH_THRESHOLD_MS = 300; // How long to convert hold note to confirm

function App() {
  const [listening, setListening] = useState(false);
  const { pitchData, error } = usePitchDetector(listening);

  const [targetMidi, setTargetMidi] = useState<number>(60); // Start with C4
  const [settings, setSettings] = useState<AppSettings>({
    difficulty: 'first_pos', // Will be dynamic, but initial default needed
    showHint: false,
    tuningId: 'standard',
    keySignature: 'C',
    instrument: 'guitar'
  });

  const [streak, setStreak] = useState(0);
  const [matchStartTime, setMatchStartTime] = useState<number | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState<string>("");

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
  }, [validNotes, targetMidi]);

  // Initial note
  useEffect(() => {
    generateNewNote();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.difficulty, settings.tuningId]);


  // Match Logic
  useEffect(() => {
    if (!pitchData) {
      setMatchStartTime(null);
      return;
    }

    if (pitchData.midi === targetMidi) {
      if (matchStartTime === null) {
        setMatchStartTime(Date.now());
      } else {
        const duration = Date.now() - matchStartTime;
        if (duration > NOTE_MATCH_THRESHOLD_MS) {
          setStreak(s => s + 1);
          setFeedbackMessage("Good!");

          // Simple flash effect or delay
          setTimeout(() => {
            generateNewNote();
          }, 800);

          setMatchStartTime(null);
        }
      }
    } else {
      setMatchStartTime(null);
    }
  }, [pitchData, targetMidi, matchStartTime, generateNewNote]);



  // Hint text construction
  const hintPositions = useMemo(() => {
    if (!settings.showHint) return [];
    if (!currentInstrumentDef.showTuning || !currentTuning) return []; // No fretboard hints for piano/voice

    return getFretboardPositions(targetMidi, currentTuning);
  }, [settings.showHint, targetMidi, currentTuning, currentInstrumentDef]);

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">Antigravity Guitar</div>
        <div className="streak-badge">Streak: <strong>{streak}</strong></div>
      </header>

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
          />

          <div className="feedback-area">
            {feedbackMessage ? (
              <div className="success-message animate-pop">{feedbackMessage}</div>
            ) : (
              <div className="instruction-text">Play the note above</div>
            )}
          </div>

          {settings.showHint && currentInstrumentDef.showTuning && (
            <div className="hint-card">
              <div className="hint-note">
                {getNoteDetails(targetMidi + currentInstrumentDef.transpose).scientific} (Written)
              </div>
              <div className="hint-positions">
                {hintPositions.map((p, i) => (
                  <span key={i} className="hint-tag">
                    String {p.stringIndex + 1} / Fret {p.fret}
                  </span>
                ))}
              </div>
            </div>
          )}

          {error && <div className="error-message">{error}</div>}

          <div className="action-row" style={{ marginTop: '24px', display: 'flex', justifyContent: 'center' }}>
            <button className="skip-button" onClick={generateNewNote}>
              <SkipForward size={18} />
              Skip Note
            </button>
          </div>
        </div>

        <div className="pitch-monitor-bar">
          <button
            className={`mic-button ${listening ? 'listening' : ''}`}
            onClick={() => setListening(!listening)}
            aria-label={listening ? "Stop Listening" : "Start Listening"}
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
      </main>

      <footer className="settings-footer">
        <Controls settings={settings} onUpdateSettings={setSettings} />
      </footer>
    </div>
  );
}

export default App;
