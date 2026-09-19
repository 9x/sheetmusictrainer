/**
 * Assist Mode — primitive practice companion for working from paper.
 *
 * No trainer, no scoring: shows the currently played (mic-detected) note
 * large, optionally with a live fretboard of alternative positions for that
 * note. Tuner and Metronome come from the shared footer tools (Controls),
 * so they stay identical across all modes.
 */
import { INSTRUMENT_DEFINITIONS, resolveClefTranspose } from '../music/InstrumentConfigs';
import { useMemo } from 'react';
import { useSettings } from '../context/useSettings';
import { TUNINGS, getFretboardPositions } from '../music/Tunings';
import { isFrettedInstrument } from '../music/playableRange';
import { getPracticeFilter } from '../types/SettingsTypes';
import { Fretboard } from './Fretboard';
import { LiveNoteStaff } from './LiveNoteStaff';
import type { PitchData } from '../hooks/usePitchDetector';

interface AssistModeProps {
    pitchData: PitchData | null;
    /** True while the app's own audio is audible (mic gate) — caller decides. */
    windowWidth: number;
}

export const AssistMode: React.FC<AssistModeProps> = ({ pitchData, windowWidth }) => {
    const { settings } = useSettings();
    const currentTuning = TUNINGS[settings.tuningId];
    const currentInstrumentDef = INSTRUMENT_DEFINITIONS[settings.instrument];

    const fretted = isFrettedInstrument(settings.instrument) && !!currentTuning;
    const pf = getPracticeFilter(settings);

    const { clef, transpose } = useMemo(() =>
        resolveClefTranspose(currentInstrumentDef, settings.difficulty),
    [currentInstrumentDef, settings.difficulty]);

    // Alternative positions for the detected note (respect fret window filter)
    const positions = useMemo(() => {
        if (!fretted || !currentTuning || !pitchData) return [];
        const all = getFretboardPositions(pitchData.midi, currentTuning, 20);
        if (!pf.fretWindowEnabled) return all;
        return all.filter(p => p.fret >= Math.max(0, pf.fretMin) && p.fret <= Math.min(24, pf.fretMax));
    }, [fretted, currentTuning, pitchData, pf.fretWindowEnabled, pf.fretMin, pf.fretMax]);

    // Full written range of the currently configured pool (strings × frets,
    // respecting the same filter as the position markers). The staff box is
    // sized to fit it, so notes render at their TRUE written position with
    // real ledger lines — no 8va/8vb octave shifting.
    const range = useMemo(() => {
        if (!fretted || !currentTuning) return undefined;
        const strings = pf.strings.length > 0
            ? currentTuning.strings.filter((_, i) => pf.strings.includes(i))
            : currentTuning.strings;
        if (strings.length === 0) return undefined;
        const lo = pf.fretWindowEnabled ? Math.max(0, pf.fretMin) : 0;
        const hi = pf.fretWindowEnabled ? Math.min(24, pf.fretMax) : 24;
        return {
            min: Math.min(...strings) + lo + transpose,
            max: Math.max(...strings) + hi + transpose,
        };
    }, [fretted, currentTuning, pf.strings, pf.fretWindowEnabled, pf.fretMin, pf.fretMax, transpose]);

    const staffWidth = Math.min(windowWidth - 40, 860);

    return (
        <div className="card sheet-music-card assist-card">
            <div className="assist-note-area">
                {pitchData ? (
                    <span className="assist-note-name">{pitchData.note}</span>
                ) : (
                    <span className="assist-note-name placeholder">—</span>
                )}
            </div>

            <div className="sheet-music-container">
                <LiveNoteStaff
                    midi={pitchData ? pitchData.midi : null}
                    transpose={transpose}
                    keySignature={settings.keySignature}
                    clef={clef === 'grand' ? undefined : clef}
                    width={Math.min(240, staffWidth)}
                    height={88}
                    range={range}
                    theme={settings.theme}
                />
            </div>

            {fretted && currentTuning && (
                <div className="assist-fretboard">
                    <Fretboard
                        tuning={currentTuning}
                        positions={positions}
                        maxFrets={15}
                        showHints={true}
                        interactive={false}
                        displayTranspose={transpose}
                    />
                </div>
            )}
        </div>
    );
};
