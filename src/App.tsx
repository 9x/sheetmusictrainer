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
  getOpenStringNotes,
  getFirstPositionNotes,
  getFretboardPositions
} from './music/Tunings';
import { Mic, MicOff } from 'lucide-react';
import './App.css';

const NOTE_MATCH_THRESHOLD_MS = 300; // How long to convert hold note to confirm

function App() {
  const [listening, setListening] = useState(false);
  const { pitchData, error } = usePitchDetector(listening);

  const [targetMidi, setTargetMidi] = useState<number>(60); // Start with C4
  const [settings, setSettings] = useState<AppSettings>({
    difficulty: 'first_pos',
    showHint: false,
    tuningId: 'standard'
  });

  const [streak, setStreak] = useState(0);
  const [matchStartTime, setMatchStartTime] = useState<number | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState<string>("");

  const currentTuning = TUNINGS[settings.tuningId];

  // Generate valid notes based on difficulty
  const validNotes = useMemo(() => {
    switch (settings.difficulty) {
      case 'open':
        return getOpenStringNotes(currentTuning);
      case 'first_pos':
        return getFirstPositionNotes(currentTuning);
      case 'e_string':
        // Low E string: 40 to 40+12 (E2 to E3)
        const lowE = currentTuning.strings[0];
        return Array.from({ length: 13 }, (_, i) => lowE + i);
      case 'all':
      default:
        // Range from Low E (40) to High E 12th fret (64+12=76)
        return Array.from({ length: 37 }, (_, i) => 40 + i);
    }
  }, [settings.difficulty, currentTuning]);

  const generateNewNote = useCallback(() => {
    const newNote = getRandomNote(40, 76, validNotes);
    if (newNote === targetMidi && validNotes.length > 1) {
      // Try once to get a different note
      const retry = getRandomNote(40, 76, validNotes);
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

  const targetDetails = getNoteDetails(targetMidi);

  // Hint text construction
  const hintPositions = useMemo(() => {
    if (!settings.showHint) return [];
    return getFretboardPositions(targetMidi, currentTuning);
  }, [settings.showHint, targetMidi, currentTuning]);

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
            width={Math.min(window.innerWidth - 40, 500)}
            height={250}
          />

          <div className="feedback-area">
            {feedbackMessage ? (
              <div className="success-message animate-pop">{feedbackMessage}</div>
            ) : (
              <div className="instruction-text">Play the note above</div>
            )}
          </div>

          {settings.showHint && (
            <div className="hint-card">
              <div className="hint-note">{targetDetails.scientific}</div>
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
